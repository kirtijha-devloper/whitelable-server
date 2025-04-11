
const express = require("express");
const router = express.Router();
const {  generateTpin } = require("../controllers/tpinControllers");
// const validateToken = require("../middleware/validateTokenHandler");

router.route("/").post( generateTpin ); // generate tpin



module.exports = router;