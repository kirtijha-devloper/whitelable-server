# 🔑 YANA / NDIA5 Token Fetch & Caching Architecture Guide

This document details the exact token fetching, 3-layer caching, DB persistence, and 401 auto-healing retry flow used for the **YANA / NDIA5 Payout Integration** in `POS-SERVER`. 

You can replicate this exact flow step-by-step or copy the modular helper functions into any other service or gateway implementation.

---

## 📌 Architecture Overview

```
                          ┌──────────────────────────┐
                          │  API Request Trigger     │
                          │ (e.g. Balance/Payout)    │
                          └────────────┬─────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │  Layer 1: RAM Cache      │
                          │ (tokenCache in Memory)   │
                          └────────────┬─────────────┘
                                       │
                      ┌────────────────┴────────────────┐
                      │ Valid & !forceRefresh?          │
             YES ◄────┤                                 ├───► NO
             │        └─────────────────────────────────┘      │
             ▼                                                 ▼
┌──────────────────────────┐                      ┌──────────────────────────┐
│ Return Cached RAM Token  │                      │  Layer 2: Local DB Cache │
└──────────────────────────┘                      │  (SharedTokenCache table)│
                                                  └────────────┬─────────────┘
                                                               │
                                              ┌────────────────┴────────────────┐
                                              │ Valid & !forceRefresh?          │
                                     YES ◄────┤                                 ├───► NO
                                     │        └─────────────────────────────────┘      │
                                     ▼                                                 ▼
                        ┌──────────────────────────┐                      ┌──────────────────────────┐
                        │ Save to RAM & Return     │                      │ Layer 3: Proxy API       │
                        └──────────────────────────┘                      │ (Central Token Service)  │
                                                                          └────────────┬─────────────┘
                                                                                       │
                                                                                       ▼
                                                                          ┌──────────────────────────┐
                                                                          │ Update RAM & DB Cache    │
                                                                          │ Return Fresh Token       │
                                                                          └──────────────────────────┘
```

---

## 🏗️ Core Components of the Flow

### 1. **3-Layer Token Retrieval Strategy**
1. **Layer 1 (RAM In-Memory)**: Checks global variable `tokenCache`. Zero I/O overhead.
2. **Layer 2 (Database Persistence)**: Checks `SharedTokenCache` table (`service_key: 'ndia5'`). Persists across server restarts or PM2 cluster processes.
3. **Layer 3 (Central Proxy API)**: Calls central proxy `https://api.abheepay.com/api/shared/ndia5-token` with API key headers. Can force fresh token generation using `?force=true`.

---

### 2. **DB Schema (`SharedTokenCache` model)**

```javascript
const Sequelize = require('sequelize');
const db = require('../config/database');

const SharedTokenCache = db.define('SharedTokenCache', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  service_key: {
    type: Sequelize.STRING(50),
    allowNull: false,
    unique: true,
  },
  token: {
    type: Sequelize.TEXT,
    allowNull: false,
  },
  expires_at: {
    type: Sequelize.DATE,
    allowNull: false,
  },
  fetched_at: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
  },
  source: {
    type: Sequelize.STRING(20),
    allowNull: true,
  },
}, {
  tableName: 'shared_token_cache',
  timestamps: true,
});

module.exports = SharedTokenCache;
```

---

### 3. **Exact Token Fetch Function (`login(forceRefresh)`)**

```javascript
const axios = require('axios');
const SharedTokenCache = require('../models/SharedTokenCache');

// In-memory token cache to reuse Bearer token during application runtime
const tokenCache = {
  token: null,
  expiresAt: 0,
};

/**
 * API AUTHENTICATION (TOKEN CONSUMPTION VIA PROXY)
 *
 * @param {boolean} forceRefresh - If true, bypasses caches and requests fresh token from proxy with ?force=true
 * @returns {Promise<string>} Bearer JWT Token
 */
async function login(forceRefresh = false) {
  // Layer 1: Memory RAM cache check
  if (!forceRefresh && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  // Layer 2: Local DB Cache check
  if (!forceRefresh) {
    try {
      const cached = await SharedTokenCache.findOne({ where: { service_key: 'ndia5' } });
      if (cached && cached.token && cached.expires_at && new Date(cached.expires_at).getTime() > Date.now()) {
        tokenCache.token = cached.token;
        tokenCache.expiresAt = new Date(cached.expires_at).getTime();
        return cached.token;
      }
    } catch (dbErr) {
      console.warn('[NDIA5 Service] Local DB cache lookup failed:', dbErr.message);
    }
  }

  // Layer 3: Fetch from Central Proxy API Portal
  const baseProxyUrl = process.env.NDIA5_TOKEN_PROXY_URL || 'https://api.abheepay.com/api/shared/ndia5-token';
  const proxyUrl = forceRefresh ? `${baseProxyUrl}?force=true` : baseProxyUrl;

  const clientId = process.env.NDIA5_CLIENT_ID || 'bf9bdf8c7e0491b788b7d3d375f3b1c24f3e76667297b1980bec4133073299c8';
  const apiKey   = process.env.NDIA5_API_KEY   || '13e6ad2663174b62c2a8536774cd89189877cbd29de1935b84accad586710191c9f35a07a247764f83d3ed8b8bea40c691cc7c5f125bdd5235fb13871585da39';

  try {
    const response = await axios.get(proxyUrl, {
      headers: {
        'x-ndia5-client-id': clientId,
        'x-ndia5-api-key': apiKey,
      },
      timeout: Number(process.env.NDIA5_TIMEOUT_MS || 30000),
    });

    const data  = response.data;
    const token = data?.token || data?.data?.token;

    if (token) {
      // 23 hours TTL
      const expiresAtMs = Date.now() + 23 * 60 * 60 * 1000;
      tokenCache.token = token;
      tokenCache.expiresAt = expiresAtMs;

      // Save to local DB for persistence across restarts
      try {
        await SharedTokenCache.upsert({
          service_key: 'ndia5',
          token,
          expires_at: new Date(expiresAtMs),
          fetched_at: new Date(),
          source: forceRefresh ? 'proxy_force' : (data?._source || 'proxy_live'),
        });
      } catch (dbSaveErr) {
        console.error('[NDIA5 Service] Failed to save token to local DB:', dbSaveErr.message);
      }

      return token;
    } else {
      throw new Error(data?.message || data?.meta?.message || 'NDIA5 proxy did not return a token');
    }
  } catch (error) {
    throw new Error(`NDIA5 Proxy Token Fetch Failed: ${error.message}`);
  }
}
```

---

### 4. **Self-Healing 401 Retry Loop (Usage in API Calls)**

When making standard API calls (e.g. Get Balance, Initiate Payout, Check Status), use a `while (attempts < 3)` retry loop that automatically handles token expiry (`401 Unauthorized`):

```javascript
async function callApiExample(params) {
  let token = await login(false);
  let attempts = 0;

  while (attempts < 3) {
    try {
      const response = await axios.post('https://api.uat.ndia5.com/endpoint', params, {
        headers: {
          Authorization: `Bearer ${token}`,
          timestamp: getIstTimestamp(),
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error) {
      const errorStatus = error.response ? error.response.status : null;

      if (errorStatus === 401) {
        if (attempts === 0) {
          // Attempt 1: Fetch active cached token from proxy (normal)
          attempts++;
          token = await login(false);
          continue;
        } else if (attempts === 1) {
          // Attempt 2: Force fresh token from proxy (?force=true)
          attempts++;
          token = await login(true);
          continue;
        }
      }

      throw error;
    }
  }
}
```

---

### 5. **IST Timestamp Helper (`getIstTimestamp`)**

NDIA5 API headers require an Indian Standard Time (IST, UTC+05:30) timestamp string:

```javascript
function getIstTimestamp() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  const hours = String(istTime.getUTCHours()).padStart(2, '0');
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;
}
```

---

## ⚙️ Environment Variables Required

Add these environment variables to your `.env` file:

```env
NDIA5_TOKEN_PROXY_URL=https://api.abheepay.com/api/shared/ndia5-token
NDIA5_CLIENT_ID=bf9bdf8c7e0491b788b7d3d375f3b1c24f3e76667297b1980bec4133073299c8
NDIA5_API_KEY=13e6ad2663174b62c2a8536774cd89189877cbd29de1935b84accad586710191c9f35a07a247764f83d3ed8b8bea40c691cc7c5f125bdd5235fb13871585da39
NDIA5_TIMEOUT_MS=30000
```
