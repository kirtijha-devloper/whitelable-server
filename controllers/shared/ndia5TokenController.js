/**
 * GET /api/shared/ndia5-token
 *
 * Shared proxy endpoint that authenticates with NDIA5 and returns a fresh bearer token.
 * Secured by x-ndia5-client-id + x-ndia5-api-key headers (no user JWT required).
 *
 * This endpoint is called internally by ndia5Payout.service.js (login function)
 * instead of hitting NDIA5 directly — mirrors the 7pay-token shared proxy pattern.
 */

const axios = require('axios');

// Credentials - read from env, fallback to hardcoded values (can be updated later)
const NDIA5_CLIENT_ID = process.env.NDIA5_CLIENT_ID || 'bf9bdf8c7e0491b788b7d3d375f3b1c24f3e76667297b1980bec4133073299c8';
const NDIA5_API_KEY   = process.env.NDIA5_API_KEY   || '13e6ad2663174b62c2a8536774cd89189877cbd29de1935b84accad586710191c9f35a07a247764f83d3ed8b8bea40c691cc7c5f125bdd5235fb13871585da39';

/**
 * GET /api/shared/ndia5-token
 * Headers required: x-ndia5-client-id, x-ndia5-api-key
 */
async function getNdia5Token(req, res) {
  const clientId = req.headers['x-ndia5-client-id'];
  const apiKey   = req.headers['x-ndia5-api-key'];

  // Validate credentials against configured values
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

  // Pull NDIA5 config from env / fallback
  const baseURL  = (process.env.NDIA5_BASE_URL || 'https://api.uat.ndia5.com').replace(/\/+$/, '');
  const username = process.env.NDIA5_USERNAME || 'ND0144';
  const password = process.env.NDIA5_PASSWORD || 'C5gBq@IcEO';
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

    return res.json({
      success: true,
      meta: { response_code: 'ND_000', message: 'SUCCESS' },
      token,
      _source: 'live',
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
