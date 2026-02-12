const Queue = require("bull");
const EventEmitter = require("events");

// Allow disabling queues in local/dev to avoid Redis connection errors
// Auto-disable queues in development when no Redis config is present
const queuesDisabled = 
  process.env.DISABLE_QUEUES === 'true' ||
  (process.env.NODE_ENV === 'development' && !process.env.REDIS_HOST && !process.env.REDIS_URL);
if (queuesDisabled) {
  console.warn('[Razorpay Webhook Queue] Queues are disabled (no Redis config detected). Set REDIS_URL or DISABLE_QUEUES=false to enable.');
  const stub = new EventEmitter();
  stub.add = async (data) => {
    console.warn('[Razorpay Webhook Queue] add() called while queues disabled — job skipped.');
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
      // Retry configuration for production resilience
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    };

// Create queue with production-ready settings
const razorpayWebhookQueue = new Queue("razorpay-webhook-processing", {
  redis: redisConfig,
  defaultJobOptions: {
    // Retry failed jobs up to 3 times with exponential backoff
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000, // Start with 2 seconds, then 4s, 8s
    },
    // Remove completed jobs after 24 hours
    removeOnComplete: {
      age: 24 * 3600, // 24 hours in seconds
      count: 1000, // Keep last 1000 completed jobs
    },
    // Remove failed jobs after 7 days
    removeOnFail: {
      age: 7 * 24 * 3600, // 7 days in seconds
    },
  },
  settings: {
    // Stalled job check interval (milliseconds)
    stalledInterval: 30000, // 30 seconds
    // Max number of stalled jobs to recover per iteration
    maxStalledCount: 1,
  },
});

// Event listeners for monitoring (useful for production debugging)
razorpayWebhookQueue.on("error", (error) => {
  console.error("[Razorpay Webhook Queue] Error:", error);
});

razorpayWebhookQueue.on("waiting", (jobId) => {
  console.log(`[Razorpay Webhook Queue] Job ${jobId} is waiting`);
});

razorpayWebhookQueue.on("active", (job) => {
  console.log(`[Razorpay Webhook Queue] Processing job ${job.id} for txn: ${job.data.txnId}`);
});

razorpayWebhookQueue.on("completed", (job, result) => {
  console.log(`[Razorpay Webhook Queue] Job ${job.id} completed for txn: ${job.data.txnId}`);
});

razorpayWebhookQueue.on("failed", (job, err) => {
  console.error(`[Razorpay Webhook Queue] Job ${job.id} failed for txn: ${job.data.txnId}`, err.message);
});

razorpayWebhookQueue.on("stalled", (job) => {
  console.warn(`[Razorpay Webhook Queue] Job ${job.id} stalled for txn: ${job.data.txnId}`);
});

module.exports = razorpayWebhookQueue;

