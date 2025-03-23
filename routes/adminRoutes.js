const express = require("express");
const router = express.Router();
const {  getAdminDashboard} = require("../controllers/adminController");
// const validateToken = require("../middleware/validateTokenHandler");

router.route("/").get( getAdminDashboard );



module.exports = router;