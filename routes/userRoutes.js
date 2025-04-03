const express = require("express");

const router = express.Router();

const {registerUser, loginUser, currentUser, getUsers, getUserByID, updatePassword}  = require("../controllers/userController");
const validateToken = require("../middleware/validateTokenHandler");

// @public access

router.get('/', validateToken, getUsers)
router.get("/current", validateToken, currentUser);
router.get('/:id', validateToken, getUserByID)
router.post("/register", validateToken, registerUser);
router.post("/login", loginUser);
router.put("/update-password", validateToken, updatePassword);


// @private access




module.exports = router;