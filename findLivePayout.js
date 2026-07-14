const PayoutTransaction = require('./models/PayoutTransaction');
const User = require('./models/User');

async function main() {
  try {
    const ref = 'BXP-1784013300481-B79B7855';
    console.log(`Searching for payout reference: ${ref}...`);
    const row = await PayoutTransaction.findOne({
      where: {
        reference_id: ref
      }
    });
    if (!row) {
      console.log(`No transaction found with reference ID: ${ref}`);
      
      console.log("Searching by amount 100000...");
      const rowByAmount = await PayoutTransaction.findOne({
        where: {
          amount: 100000
        }
      });
      if (!rowByAmount) {
        console.log("No transaction found with amount 100000");
        return;
      }
      await displayInfo(rowByAmount);
      return;
    }
    await displayInfo(row);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

async function displayInfo(row) {
  console.log("\n================ TRANSACTION FOUND ================");
  console.log(`ID: ${row.id}`);
  console.log(`Amount: ${row.amount}`);
  console.log(`Reference ID: ${row.reference_id}`);
  console.log(`Provider: ${row.payout_provider}`);
  console.log(`Status: ${row.status}`);
  console.log(`Created At: ${row.createdAt}`);
  
  const user = await User.findByPk(row.merchant_id);
  if (user) {
    console.log("\n================ MERCHANT DETAILS ================");
    console.log(`ID: ${user.id}`);
    console.log(`Name: ${user.name}`);
    console.log(`Username: ${user.username}`);
    console.log(`Mobile: ${user.mobile_number || user.mobile}`);
    console.log(`Role: ${user.role}`);
  } else {
    console.log(`\nNo user found with ID: ${row.merchant_id}`);
  }
}

main();
