/**
 * GET /api/shared/ndia5-token
 *
 * Shared proxy endpoint that returns a valid NDIA5 bearer token.
 * Secured by x-ndia5-client-id + x-ndia5-api-key headers (no user JWT required).
 *
 * TOKEN CACHING (TWO LAYERS):
 *   Layer 1 — In-memory (_cache): Fastest. Avoids DB hit on every request.
 *   Layer 2 — DB (shared_token_cache): Survives server restarts & shared across instances.
 *
 * FLOW:
 *   1. Check in-memory cache → if valid, return (_source: "memory")
 *   2. Check DB cache → if valid, warm memory + return (_source: "db_cache")
 *   3. Fetch from NDIA5 → save to DB + memory → return (_source: "live")
 *
 * FORCE REFRESH (?force=true):
 *   Skips both caches, hits NDIA5 directly, replaces old token in DB & memory.
 *   Use this when downstream API returns 401 (expired token).
 */

const axios = require('axios');
const SharedTokenCache = require('../../models/SharedTokenCache');

// Credentials
const NDIA5_CLIENT_ID = process.env.NDIA5_CLIENT_ID || 'bf9bdf8c7e0491b788b7d3d375f3b1c24f3e76667297b1980bec4133073299c8';
const NDIA5_API_KEY   = process.env.NDIA5_API_KEY   || '13e6ad2663174b62c2a8536774cd89189877cbd29de1935b84accad586710191c9f35a07a247764f83d3ed8b8bea40c691cc7c5f125bdd5235fb13871585da39';

const SERVICE_KEY = 'ndia5';

// Layer 1: In-memory cache (reset on server restart)
const _mem = {
  token: null,
  expiresAt: 0,
};

/**
 * Fetch fresh token from NDIA5 login endpoint
 */
async function fetchFromNdia5() {
  const baseURL       = (process.env.NDIA5_BASE_URL || 'https://api.uat.ndia5.com').replace(/\/+$/, '');
  const loginEndpoint = `${baseURL}/auth/merchant/login`;
  const username      = process.env.NDIA5_USERNAME || 'ND0144';
  const password      = process.env.NDIA5_PASSWORD || 'C5gBq@IcEO';

  const response = await axios.post(
    loginEndpoint,
    { username, password },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: Number(process.env.NDIA5_TIMEOUT_MS || 30000),
    }
  );

  const data  = response.data;
  const token = data?.data?.token || data?.token;

  if (!token) {
    const err = new Error(data?.meta?.message || 'NDIA5 did not return a token.');
    err.rawResponse = data;
    throw err;
  }

  return token;
}

/**
 * Save token to DB (UPSERT — replaces old token for service_key)
 */
async function saveToDb(token, source) {
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000); // 23hr TTL
  await SharedTokenCache.upsert({
    service_key: SERVICE_KEY,
    token,
    expires_at: expiresAt,
    fetched_at: new Date(),
    source,
  });
  return expiresAt;
}

/**
 * GET /api/shared/ndia5-token
 * Query params: ?force=true  → bypass all caches, force hard refresh
 */
async function getNdia5Token(req, res) {
  const clientId = req.headers['x-ndia5-client-id'];
  const apiKey   = req.headers['x-ndia5-api-key'];

  if (!clientId || !apiKey) {
    return res.status(401).json({ success: false, message: 'Missing x-ndia5-client-id or x-ndia5-api-key headers.' });
  }
  if (clientId !== NDIA5_CLIENT_ID || apiKey !== NDIA5_API_KEY) {
    return res.status(401).json({ success: false, message: 'Invalid NDIA5 client credentials.' });
  }

  const forceRefresh = req.query.force === 'true' || req.query.force === '1';

  // ─── LAYER 1: In-memory ───────────────────────────────────────────────────
  if (!forceRefresh && _mem.token && Date.now() < _mem.expiresAt) {
    return res.json({
      success: true,
      meta: { response_code: 'ND_000', message: 'SUCCESS' },
      token: _mem.token,
      _source: 'memory',
      expiresAt: new Date(_mem.expiresAt).toISOString(),
    });
  }

  // ─── LAYER 2: DB cache ────────────────────────────────────────────────────
  if (!forceRefresh) {
    try {
      const row = await SharedTokenCache.findOne({ where: { service_key: SERVICE_KEY } });
      if (row && row.token && new Date(row.expires_at) > new Date()) {
        // Warm in-memory cache
        _mem.token     = row.token;
        _mem.expiresAt = new Date(row.expires_at).getTime();
        return res.json({
          success: true,
          meta: { response_code: 'ND_000', message: 'SUCCESS' },
          token: row.token,
          _source: 'db_cache',
          expiresAt: new Date(row.expires_at).toISOString(),
        });
      }
    } catch (dbErr) {
      // DB read failure → fall through to live fetch (don't break the flow)
      console.error('[NDIA5 Token Proxy] DB cache read failed, falling through to live fetch:', dbErr.message);
    }
  }

  // ─── LAYER 3: Live fetch from NDIA5 ───────────────────────────────────────
  try {
    const token  = await fetchFromNdia5();
    const source = forceRefresh ? 'force_refresh' : 'live';

    // Save to DB (UPSERT — old token replaced)
    let expiresAt;
    try {
      expiresAt = await saveToDb(token, source);
    } catch (dbSaveErr) {
      console.error('[NDIA5 Token Proxy] DB save failed (returning token anyway):', dbSaveErr.message);
      expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000);
    }

    // Warm in-memory cache
    _mem.token     = token;
    _mem.expiresAt = expiresAt.getTime();

    return res.json({
      success: true,
      meta: { response_code: 'ND_000', message: 'SUCCESS' },
      token,
      _source: source,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    const status = error.response?.status || 502;
    return res.status(status).json({
      success: false,
      message: `NDIA5 login failed: ${error.message}`,
      errorData: error.response?.data || error.rawResponse || null,
    });
  }
}

module.exports = { getNdia5Token };
