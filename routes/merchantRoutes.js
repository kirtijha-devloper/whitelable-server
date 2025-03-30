const express = require("express");
const {onBoardUser, getUsers, getUserById, updateUserStatus}  = require("../controllers/merchantController");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");

router.use(validateToken)



router.route("/").post( onBoardUser );
router.get('/', getUsers); // List users
router.get('/:id', getUserById); // Get single user
router.put('/:id/status', updateUserStatus); // Update user status


module.exports = router;