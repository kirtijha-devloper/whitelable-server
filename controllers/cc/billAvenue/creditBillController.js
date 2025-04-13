const asyncHandler = require('express-async-handler');
const creditBillService = require('../../../services/cc/billAvenue/creditBillService');

const creditBillPayment = asyncHandler(async (req, res) => {
  try {
    const paymentPayload = req.body;

    // Validate request (Optional: Add a Joi validation or manual validation)
    if (!paymentPayload.customerMobile || !paymentPayload.amount) {
      return res.status(400).json({ message: 'Missing required fields: customerMobile or amount' });
    }

    const result = await creditBillService.processCreditBillPayment(paymentPayload);

    res.status(200).json({
      message: 'Credit bill payment processed successfully',
      data: result
    });
  } catch (error) {
    console.error('Error in creditBillPayment controller:', error);
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});

module.exports = {
  creditBillPayment
};