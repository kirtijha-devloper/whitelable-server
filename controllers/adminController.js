const asyncHandler = require("express-async-handler");
const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');



const getTodayRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const getAdminDashboard = asyncHandler( async (req, res) => {
    const { start, end } = getTodayRange();
  try {
      const activeMachineCount = await PosMachine.count({ where: { status: 'active' } });
      const deactiveMachineCount = await PosMachine.count({ where: { status: 'in_active' } });
      const activeMerchantCount = await User.count({ where: { role: "merchant", status: 'active' } });
      const activeFranchaiseCount = await User.count({ where: { role: "franchaise", status: 'active' } });
      
      // const todayPosTransactions = await Transaction.sum('amount', {
      //     where: {
      //     type: 'POS',
      //     createdAt: { [Op.between]: [start, end] },
      //     },
      // });
      
      res.status(200).json({
        message: 'Admin Dashboard Data Fetched Successfully',
        data: {
          posMachines: {
            active: activeMachineCount,
            inactive: deactiveMachineCount,
          },
          merchants: {
            count: activeMerchantCount
          },
          franchaises: {
            count:activeFranchaiseCount
          }}
  });
  } catch (error) {
      console.error('Error fetching admin dashboard data:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
});
    


module.exports = {getAdminDashboard}

