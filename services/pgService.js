const axios = require('axios');

const CONFIG = {
  pg_1: {
    apiUrl: process.env.PG1_API_URL || 'https://cognatehealthservices.in/api/create-order/',
    clientId: process.env.PG1_CLIENT_ID || 'COGNATE_CLIENT_ID',
    secretKey: process.env.PG1_SECRET_KEY || 'COGNATE_SECRET_KEY',
    providerName: 'cognate',
    displayName: 'PG 1 (Cognate)'
  },
  pg_2: {
    apiUrl: process.env.PG2_API_URL || 'https://bharatgrain.com/api/create-order/',
    clientId: process.env.PG2_CLIENT_ID || 'BHARATGRAIN_CLIENT_ID',
    secretKey: process.env.PG2_SECRET_KEY || 'BHARATGRAIN_SECRET_KEY',
    providerName: 'bharatgrain',
    displayName: 'PG 2 (BharatGrain)'
  }
};

function getGatewayConfig(gatewayKey) {
  const normalized = String(gatewayKey || '').trim().toLowerCase();
  if (normalized === 'pg1' || normalized === 'pg_1' || normalized === 'cognate') {
    return { key: 'pg_1', ...CONFIG.pg_1 };
  }
  if (normalized === 'pg2' || normalized === 'pg_2' || normalized === 'pg3' || normalized === 'pg_3' || normalized === 'bharatgrain') {
    return { key: 'pg_2', ...CONFIG.pg_2 };
  }
  return null;
}

/**
 * Step 1: Create Order on the Payment Gateway
 */
async function createOrder({ gateway, amount, returnUrl }) {
  const config = getGatewayConfig(gateway);
  if (!config) {
    throw new Error(`Unsupported gateway: ${gateway}`);
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount < 10) {
    throw new Error('Minimum transaction amount is ₹10.00');
  }

  const params = new URLSearchParams();
  params.append('amount', numAmount.toFixed(2));
  params.append('return_url', returnUrl);
  params.append('allowed_method', 'card');

  try {
    const response = await axios.post(config.apiUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    });

    const data = response.data || {};
    if (!data.payment_url) {
      throw new Error(data.error || data.message || 'Payment Gateway did not return a payment URL');
    }

    return {
      success: true,
      order_id: data.order_id,
      payment_url: data.payment_url,
      gateway: config.key,
      raw: data
    };
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message;
    throw new Error(`Payment Gateway Error (${config.displayName}): ${errorMsg}`);
  }
}

/**
 * Step 2: Verify Webhook Request Headers
 */
function verifyWebhookHeaders({ gateway, headers }) {
  const config = getGatewayConfig(gateway);
  if (!config) return false;

  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    normalized[key.toLowerCase()] = value;
  }

  let clientId = '';
  let secretKey = '';

  if (config.key === 'pg_1') {
    clientId = normalized['x-cognate-client-id'] || '';
    secretKey = normalized['x-cognate-secret-key'] || '';
  } else if (config.key === 'pg_2') {
    clientId = normalized['x-pg3-client-id'] || normalized['x-bharatgrain-client-id'] || normalized['x-cognate-client-id'] || '';
    secretKey = normalized['x-pg3-secret-key'] || normalized['x-bharatgrain-secret-key'] || normalized['x-cognate-secret-key'] || '';
  }

  // If secret is set in env, validate strictly
  const expectedClientId = config.clientId;
  const expectedSecretKey = config.secretKey;

  // If env not explicitly set, log in dev
  if (process.env.NODE_ENV !== 'production' && (expectedClientId === 'COGNATE_CLIENT_ID' || expectedClientId === 'BHARATGRAIN_CLIENT_ID')) {
    return true;
  }

  return clientId === expectedClientId && secretKey === expectedSecretKey;
}

module.exports = {
  createOrder,
  verifyWebhookHeaders,
  getGatewayConfig,
  CONFIG
};
