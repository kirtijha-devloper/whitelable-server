const asyncHandler = require("express-async-handler");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");

    const listStatement = asyncHandler(async (req, res) => {
  try {
    const status = req.query.status;
    const searchedRole = req.query.searched_role || null;
    const userRole = req.user.role;
    const userId = req.user.id;

    const where = {
      status: status || "completed",
    };

    console.log("Role Check:", searchedRole, userRole);

    if (userRole === "admin") {
      const userFilter = {
        status: "active",
      };

      if (searchedRole) {
        userFilter.role = searchedRole;
      }

      const users = await User.findAll({
        where: userFilter,
        attributes: ["id"],
      });

      const userIds = users.map((u) => u.id);
      where.requested_by = userIds;
    }

    if (userRole === "franchaise") {
      if (searchedRole === "merchant") {
        const users = await User.findAll({
          where: { franchaise_id: userId, status: "active" },
          attributes: ["id"],
        });
        const userIds = users.map((u) => u.id);
        where.requested_by = userIds;
      } else {
        where.requested_by = userId;
      }
    }

    if (userRole === "merchant") {
      where.requested_by = userId;
    }

    const transactions = await WalletTransaction.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      count: transactions.length,
      transactions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = {listStatement}