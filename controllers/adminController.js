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
  //   const { start, end } = getTodayRange();
  // try {
  //     const activeMachineCount = await PosMachine.count({ where: { status: 'active' } });
  //     const deactiveMachineCount = await PosMachine.count({ where: { status: 'in_active' } });
  //     const activeMerchant = await User.findAll({ where: { is_merchant: true, status: 'active' } });
  //     const activeFranchaiset = await User.findAll({ where: { is_merchant: true, status: 'active' } });
      
  //     // const todayPosTransactions = await Transaction.sum('amount', {
  //     //     where: {
  //     //     type: 'POS',
  //     //     createdAt: { [Op.between]: [start, end] },
  //     //     },
  //     // });
      
  //     res.status(200).json({
  //       message: 'Admin Dashboard Data Fetched Successfully',
  //       data: {
  //         posMachines: {
  //           active: activeMachineCount,
  //           inactive: deactiveMachineCount,
  //         },
  //         merchants: {
  //           count: activeMerchant.length,
  //           list: activeMerchant, // You can limit fields if needed
  //         },
  //         franchaises: {
  //           count: activeFranchaiset.length,
  //           list: activeFranchaiset,
  //         }}
  // });
  // } catch (error) {
  //     console.error('Error fetching admin dashboard data:', error);
  //     res.status(500).json({ message: 'Internal Server Error' });
  //   }
});
    


module.exports = {getAdminDashboard}

