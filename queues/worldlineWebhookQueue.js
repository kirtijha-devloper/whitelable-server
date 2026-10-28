const Queue = require("bull");
const EventEmitter = require("events");

// Allow disabling queues in local/dev to avoid Redis connection errors
const queuesDisabled = 
  process.env.DISABLE_QUEUES === 'true' ||
  (process.env.NODE_ENV === 'development' && !process.env.REDIS_HOST && !process.env.REDIS_URL);

if (queuesDisabled) {
  console.warn('[Worldline Webhook Queue] Queues are disabled (no Redis config detected or DISABLE_QUEUES=true). Running jobs inline via setImmediate.');
  const stub = new EventEmitter();
  let workerHandler = null;
  stub.process = (handler) => {
    workerHandler = handler;
  };
  stub.add = async (data, opts) => {
    const jobId = (opts && opts.jobId) || `inline-${Date.now()}`;
    console.log(`[Worldline Webhook Queue] Inline execution triggered for txn: ${data?.txnId} (jobId: ${jobId})`);
    if (workerHandler) {
      setImmediate(async () => {
        try {
          await workerHandler({
            id: jobId,
            data
          });
        } catch (err) {
          console.error('[Worldline Webhook Queue] Inline job execution error:', err);
        }
      });
    } else {
      console.warn('[Worldline Webhook Queue] add() called but no process handler registered yet.');
    }
    return { id: jobId };
  };
  stub.on = stub.addListener.bind(stub);
  module.exports = stub;
  return;
}

// Environment-aware Redis configuration
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

// Create queue for Worldline webhook processing
const worldlineWebhookQueue = new Queue("worldline-webhook-processing", {
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
  settings: {
    stalledInterval: 30000,
    maxStalledCount: 1,
  },
});

worldlineWebhookQueue.on("error", (error) => {
  console.error("[Worldline Webhook Queue] Error:", error.message || error);
});

worldlineWebhookQueue.on("active", (job) => {
  console.log(`[Worldline Webhook Queue] Processing job ${job.id} for txn: ${job.data?.txnId}`);
});

worldlineWebhookQueue.on("completed", (job, result) => {
  console.log(`[Worldline Webhook Queue] Job ${job.id} completed for txn: ${job.data?.txnId}`);
});

worldlineWebhookQueue.on("failed", (job, err) => {
  console.error(`[Worldline Webhook Queue] Job ${job.id} failed for txn: ${job.data?.txnId}`, err.message);
});

module.exports = worldlineWebhookQueue;
