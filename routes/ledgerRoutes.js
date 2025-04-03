const express = require("express");
const upload = require("../utils/mutlerSetup")

const { listStatement} = require("../controllers/ledgerController");

const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
router.use(validateToken)

router.get("/statement/list", listStatement);





module.exports = router;