// ============================================================
//  VELOX Worker — velox-worker.ikoromichael592.workers.dev
//  Handles: TMDB proxy + User auth + Watchlist + History
// ============================================================

const TMDB = 'https://api.themoviedb.org/3';
const TMDB_KEY_HARD = 'e163a6d9093c546e3d455197c051c687';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── TMDB PROXY ─────────────────────────────────────────
      // GET /tmdb?path=/movie/popular&page=1
      if (path === '/tmdb' || path === '/') {
        return handleTMDB(url, env);
      }

      // ── AUTH ────────────────────────────────────────────────
      // POST /auth/register   { username }
      // POST /auth/login      { username, token }
      if (path === '/auth/register') return handleRegister(request, env);
      if (path === '/auth/login')    return handleLogin(request, env);

      // ── WATCHLIST ───────────────────────────────────────────
      // GET    /watchlist          (requires token header)
      // POST   /watchlist          { tmdb_id, media_type, title, poster, year, rating }
      // DELETE /watchlist/:tmdb_id
      if (path === '/watchlist') {
        if (request.method === 'GET')    return handleWLGet(request, env);
        if (request.method === 'POST')   return handleWLAdd(request, env);
      }
      if (path.startsWith('/watchlist/') && request.method === 'DELETE') {
        return handleWLRemove(request, env, path);
      }

      // ── HISTORY ─────────────────────────────────────────────
      // GET  /history
      // POST /history   { tmdb_id, media_type, title, poster }
      if (path === '/history') {
        if (request.method === 'GET')  return handleHistGet(request, env);
        if (request.method === 'POST') return handleHistAdd(request, env);
      }

      // ── EPISODE PROGRESS ────────────────────────────────────
      // GET  /progress/:tmdb_id
      // POST /progress  { tmdb_id, season, episode, watched }
      if (path.startsWith('/progress/') && request.method === 'GET') {
        return handleEpGet(request, env, path);
      }
      if (path === '/progress' && request.method === 'POST') {
        return handleEpSet(request, env);
      }

      return json({ error: 'Not found' }, 404);

    } catch (e) {
      console.error(e);
      return json({ error: 'Server error', detail: e.message }, 500);
    }
  }
};

// ── TMDB PROXY ────────────────────────────────────────────────
async function handleTMDB(url, env) {
  const tmdbPath = url.searchParams.get('path');
  if (!tmdbPath) return json({ error: 'Missing path' }, 400);

  // Forward all query params except 'path'
  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (k !== 'path') params.set(k, v);
  }
  params.set('api_key', env.TMDB_KEY || TMDB_KEY_HARD);

  const tmdbUrl = `${TMDB}${tmdbPath}?${params}`;
  const res = await fetch(tmdbUrl);
  const data = await res.json();
  return json(data);
}

// ── REGISTER ──────────────────────────────────────────────────
// Creates a new user. Returns token to store in browser.
// If username already taken → error.
async function handleRegister(request, env) {
  const { username } = await request.json();
  if (!username || username.length < 2) {
    return json({ error: 'Username too short' }, 400);
  }

  // Check if username taken
  const existing = await env.velox_db.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(username.trim()).first();

  if (existing) {
    return json({ error: 'Username already taken — try a different one' }, 409);
  }

  // Generate a random token
  const token = crypto.randomUUID() + '-' + crypto.randomUUID();

  await env.velox_db.prepare(
    'INSERT INTO users (username, token) VALUES (?, ?)'
  ).bind(username.trim(), token).run();

  const user = await env.velox_db.prepare(
    'SELECT id, username, avatar_color, created_at FROM users WHERE token = ?'
  ).bind(token).first();

  return json({ success: true, token, user });
}

// ── LOGIN ─────────────────────────────────────────────────────
// Verifies token. Used on page load to restore session.
async function handleLogin(request, env) {
  const { token } = await request.json();
  if (!token) return json({ error: 'No token' }, 400);

  const user = await env.velox_db.prepare(
    'SELECT id, username, avatar_color, created_at FROM users WHERE token = ?'
  ).bind(token).first();

  if (!user) return json({ error: 'Invalid token' }, 401);
  return json({ success: true, user });
}

// ── AUTH HELPER ───────────────────────────────────────────────
// Reads Authorization: Bearer <token> header, returns user row
async function getUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  return env.velox_db.prepare(
    'SELECT id, username FROM users WHERE token = ?'
  ).bind(token).first();
}

// ── WATCHLIST GET ─────────────────────────────────────────────
async function handleWLGet(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { results } = await env.velox_db.prepare(
    'SELECT tmdb_id, media_type, title, poster, year, rating, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC'
  ).bind(user.id).all();

  return json({ watchlist: results });
}

// ── WATCHLIST ADD ─────────────────────────────────────────────
async function handleWLAdd(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { tmdb_id, media_type, title, poster, year, rating } = await request.json();
  if (!tmdb_id || !media_type || !title) return json({ error: 'Missing fields' }, 400);

  await env.velox_db.prepare(
    `INSERT INTO watchlist (user_id, tmdb_id, media_type, title, poster, year, rating)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, tmdb_id, media_type) DO NOTHING`
  ).bind(user.id, tmdb_id, media_type, title, poster || '', year || '', rating || '').run();

  return json({ success: true });
}

// ── WATCHLIST REMOVE ──────────────────────────────────────────
async function handleWLRemove(request, env, path) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // path = /watchlist/12345 or /watchlist/12345?type=tv
  const tmdb_id = parseInt(path.split('/')[2]);
  const url = new URL(request.url);
  const media_type = url.searchParams.get('type') || 'movie';

  await env.velox_db.prepare(
    'DELETE FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = ?'
  ).bind(user.id, tmdb_id, media_type).run();

  return json({ success: true });
}

// ── HISTORY GET ───────────────────────────────────────────────
async function handleHistGet(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { results } = await env.velox_db.prepare(
    'SELECT tmdb_id, media_type, title, poster, watched_at FROM history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 100'
  ).bind(user.id).all();

  return json({ history: results });
}

// ── HISTORY ADD ───────────────────────────────────────────────
async function handleHistAdd(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { tmdb_id, media_type, title, poster } = await request.json();
  if (!tmdb_id || !media_type || !title) return json({ error: 'Missing fields' }, 400);

  await env.velox_db.prepare(
    `INSERT INTO history (user_id, tmdb_id, media_type, title, poster)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, tmdb_id, media_type) DO UPDATE SET watched_at = unixepoch()`
  ).bind(user.id, tmdb_id, media_type, title, poster || '').run();

  return json({ success: true });
}

// ── EPISODE PROGRESS GET ──────────────────────────────────────
async function handleEpGet(request, env, path) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const tmdb_id = parseInt(path.split('/')[2]);
  const { results } = await env.velox_db.prepare(
    'SELECT season, episode FROM ep_progress WHERE user_id = ? AND tmdb_id = ?'
  ).bind(user.id, tmdb_id).all();

  // Return as { "1": { "3": true, "4": true }, "2": { "1": true } }
  const progress = {};
  for (const row of results) {
    if (!progress[row.season]) progress[row.season] = {};
    progress[row.season][row.episode] = true;
  }
  return json({ progress });
}

// ── EPISODE PROGRESS SET ──────────────────────────────────────
async function handleEpSet(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { tmdb_id, season, episode, watched } = await request.json();

  if (watched) {
    await env.velox_db.prepare(
      `INSERT INTO ep_progress (user_id, tmdb_id, season, episode)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, tmdb_id, season, episode) DO NOTHING`
    ).bind(user.id, tmdb_id, season, episode).run();
  } else {
    await env.velox_db.prepare(
      'DELETE FROM ep_progress WHERE user_id = ? AND tmdb_id = ? AND season = ? AND episode = ?'
    ).bind(user.id, tmdb_id, season, episode).run();
  }

  return json({ success: true });
}

// ── HELPER ────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}