const express = require("express");
const {onBoardUser, getUsers, getUserById, updateUserStatus, listMerchantTransactionCharges, setIpayOutletId}  = require("../controllers/merchantController");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");

router.use(validateToken)


router.post("/:id/onboard", onBoardUser)
// router.route("/:id/onboard").post( upload.fields([
//     { name: 'pan_photo', maxCount: 1 },
//     { name: 'aadhar_photo', maxCount: 1 },
//     { name: 'shop_photo', maxCount: 1 }
//     ]),
//     onBoardUser
// );
router.get('/', getUsers); // List users
router.get('/transaction-charges', listMerchantTransactionCharges); // List merchant transaction charges (deducted amounts)
router.get('/:id', getUserById); // Get single user
router.put('/:id/status', updateUserStatus); // Update user status
router.put('/:id/ipay-outlet', setIpayOutletId); // Set InstantPay outlet ID for merchant


module.exports = router;