const Queue = require("bull");
const EventEmitter = require("events");

// Allow disabling queues in local/dev to avoid Redis connection errors
// Auto-disable queues in development when no Redis config is present
const queuesDisabled = 
  process.env.DISABLE_QUEUES === 'true' ||
  (process.env.NODE_ENV === 'development' && !process.env.REDIS_HOST && !process.env.REDIS_URL);
if (queuesDisabled) {
  console.warn('[Wallet Queue] Queues are disabled (no Redis config detected). Set REDIS_URL or DISABLE_QUEUES=false to enable.');
  const stub = new EventEmitter();
  stub.add = async (data) => {
    console.warn('[Wallet Queue] add() called while queues disabled — job skipped.');
    return { id: `stub-${Date.now()}` };
  };
  stub.process = () => {};
  stub.on = stub.addListener.bind(stub);
  module.exports = stub;
  return;
}

// Environment-aware Redis configuration
// Supports both local development and production
const redisConfig = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: process.env.REDIS_PORT || 6379,
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
      ...(process.env.REDIS_DB && { db: parseInt(process.env.REDIS_DB) }),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    };

const walletQueue = new Queue("wallet-processing", {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});

module.exports = walletQueue;
