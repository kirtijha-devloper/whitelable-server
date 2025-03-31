const express = require("express");

const router = express.Router();

const {registerUser, loginUser, currentUser, getUsers, getUserByID}  = require("../controllers/userController");
const validateToken = require("../middleware/validateTokenHandler");

// @public access

router.get('/', validateToken, getUsers)
router.get("/current", validateToken, currentUser);
router.get('/:id', validateToken, getUserByID)
router.post("/register", validateToken, registerUser);
router.post("/login", loginUser);


// @private access




module.exports = router;