/**
 * GET /api/shared/ndia5-token
 *
 * Shared proxy endpoint that returns a valid NDIA5 bearer token.
 * Secured by x-ndia5-client-id + x-ndia5-api-key headers (no user JWT required).
 *
 * CACHING BEHAVIOUR:
 *   - Token is cached in-memory for 23 hours.
 *   - If cached token is still valid  → returns cached token (_source: "cache")
 *   - If cached token is expired/missing → calls NDIA5 fresh → caches & returns (_source: "live")
 *   - Pass query param ?force=true to bypass cache and always hit NDIA5 fresh
 *     (use this when you receive a 401 from NDIA5 to force a hard refresh)
 *
 * Called internally by ndia5Payout.service.js — mirrors the 7pay-token shared proxy pattern.
 */

const axios = require('axios');

// Credentials - read from env, fallback to hardcoded values (can be updated later)
const NDIA5_CLIENT_ID = process.env.NDIA5_CLIENT_ID || 'bf9bdf8c7e0491b788b7d3d375f3b1c24f3e76667297b1980bec4133073299c8';
const NDIA5_API_KEY   = process.env.NDIA5_API_KEY   || '13e6ad2663174b62c2a8536774cd89189877cbd29de1935b84accad586710191c9f35a07a247764f83d3ed8b8bea40c691cc7c5f125bdd5235fb13871585da39';

// In-memory token cache (shared across all callers on this process)
const _cache = {
  token: null,
  expiresAt: 0, // epoch ms
};

/**
 * GET /api/shared/ndia5-token
 *
 * Query params:
 *   ?force=true   → Bypass cache, force a fresh login call to NDIA5
 *
 * Headers required:
 *   x-ndia5-client-id
 *   x-ndia5-api-key
 */
async function getNdia5Token(req, res) {
  const clientId = req.headers['x-ndia5-client-id'];
  const apiKey   = req.headers['x-ndia5-api-key'];

  // Validate credentials
  if (!clientId || !apiKey) {
    return res.status(401).json({
      success: false,
      message: 'Missing x-ndia5-client-id or x-ndia5-api-key headers.',
    });
  }

  if (clientId !== NDIA5_CLIENT_ID || apiKey !== NDIA5_API_KEY) {
    return res.status(401).json({
      success: false,
      message: 'Invalid NDIA5 client credentials.',
    });
  }

  // ?force=true → bypass cache (caller received 401 from NDIA5, needs a hard refresh)
  const forceRefresh = req.query.force === 'true' || req.query.force === '1';

  // Return cached token if still valid and no force refresh requested
  if (!forceRefresh && _cache.token && Date.now() < _cache.expiresAt) {
    return res.json({
      success: true,
      meta: { response_code: 'ND_000', message: 'SUCCESS' },
      token: _cache.token,
      _source: 'cache',
      expiresAt: new Date(_cache.expiresAt).toISOString(),
    });
  }

  // Cache miss or force refresh → call NDIA5 login fresh
  const baseURL       = (process.env.NDIA5_BASE_URL || 'https://api.uat.ndia5.com').replace(/\/+$/, '');
  const username      = process.env.NDIA5_USERNAME || 'ND0144';
  const password      = process.env.NDIA5_PASSWORD || 'C5gBq@IcEO';
  const loginEndpoint = `${baseURL}/auth/merchant/login`;

  try {
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
      return res.status(502).json({
        success: false,
        message: data?.meta?.message || 'NDIA5 did not return a token.',
        rawResponse: data,
      });
    }

    // Update in-memory cache (23 hour TTL)
    const expiresAt = Date.now() + 23 * 60 * 60 * 1000;
    _cache.token     = token;
    _cache.expiresAt = expiresAt;

    return res.json({
      success: true,
      meta: { response_code: 'ND_000', message: 'SUCCESS' },
      token,
      _source: forceRefresh ? 'force_refresh' : 'live',
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (error) {
    const status = error.response?.status || 502;
    return res.status(status).json({
      success: false,
      message: `NDIA5 login failed: ${error.message}`,
      errorData: error.response?.data || null,
    });
  }
}

module.exports = { getNdia5Token };
