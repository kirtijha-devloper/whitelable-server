const express = require("express");
const router = express.Router();
const {  getDashboard} = require("../controllers/dashboardController");
const validateToken = require("../middleware/validateTokenHandler");
router.use(validateToken);

router.route("/").get( getDashboard );



module.exports = router;