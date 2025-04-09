const express = require("express");
const router = express.Router();
const {  getDashboard, getTodayPayoutList} = require("../controllers/dashboardController");
const validateToken = require("../middleware/validateTokenHandler");
router.use(validateToken);

router.get("/today-payouts", getTodayPayoutList);
router.route("/").get( getDashboard );




module.exports = router;