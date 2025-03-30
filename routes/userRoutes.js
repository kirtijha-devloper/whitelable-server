const express = require("express");

const router = express.Router();

const {registerUser, loginUser, currentUser}  = require("../controllers/userController");
const validateToken = require("../middleware/validateTokenHandler");

// @public access
router.post("/register", registerUser);

// @public access
router.post("/login" ,loginUser);

// @private access
router.get("/current" , validateToken, currentUser);

module.exports = router;