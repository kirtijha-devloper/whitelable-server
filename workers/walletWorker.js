const walletQueue = require("../queues/walletQueue");
const User = require("../models/User");
const WalletTransaction = require("../models/walletTransaction");

walletQueue.process(async (job) => {
  const { transactions } = job.data;

  const walletRequests = [];

  for (const tx of transactions) {
    const user = await User.findOne({ where: { mid_number: tx.mid_number } });
    if (!user) continue;

    const exists = await WalletTransaction.findOne({
      where: { reason: `Razorpay transaction ID: ${tx.ID}` },
    });
    if (exists) continue;

    walletRequests.push({
      type: "razorpay",
      amount: tx.Amount,
      status: "pending",
      reason: `Razorpay transaction ID: ${tx.ID}`,
      requested_by: user.id,
      settlement_type: user.settlement_type
    });
  }

  if (walletRequests.length) {
    await WalletTransaction.bulkCreate(walletRequests);
    console.log(`[Queue ✅] Wallet requests created: ${walletRequests.length}`);
  } else {
    console.log(`[Queue ✅] No new wallet entries to process.`);
  }
});
