const express = require("express");

const router = express.Router();

const {registerUser, loginUser, currentUser, getUsers}  = require("../controllers/userController");
const validateToken = require("../middleware/validateTokenHandler");

// @public access

router.get('/', validateToken, getUsers)
router.post("/register",validateToken,  registerUser);

// @public access
router.post("/login" ,loginUser);

// @private access
router.get("/current" , validateToken, currentUser);



module.exports = router;