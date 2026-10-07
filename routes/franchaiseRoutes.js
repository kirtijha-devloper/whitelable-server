const express = require("express");
// const validateToken = require("../middleware/validateTokenHandler");
const {onBoardUser, getUsers, getUserById, updateUserStatus}  = require("../controllers/franchaiseController");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
// const upload = require("../utils/mutlerSetup")

router.use(validateToken);
router.use(validateWhitelabelDomain);
router.post('/:id/onboard', onBoardUser);

// router.route("/:id/onboard").post( upload.fields([
//     { name: 'pan_photo', maxCount: 1 },
//     { name: 'aadhar_photo', maxCount: 1 },
//     { name: 'shop_photo', maxCount: 1 }
//     ]),
//     onBoardUser
// );
router.get('/', getUsers); // List users
router.get('/:id', getUserById); // Get single user
router.put('/:id/status', updateUserStatus); // Update user status


module.exports = router;