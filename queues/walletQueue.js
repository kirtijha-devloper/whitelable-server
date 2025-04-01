const Queue = require("bull");

const walletQueue = new Queue("wallet-processing", {
  redis: {
    host: "127.0.0.1",
    port: 6379,
  },
});

module.exports = walletQueue;
