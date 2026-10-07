const express = require("express");
const router = express.Router();
const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
const {
  getSuperFranchises,
  getSuperFranchiseById,
  getSuperFranchiseFranchises,
  assignFranchiseToSuperFranchise
} = require("../controllers/superFranchiseController");

router.use(validateToken);
router.use(validateWhitelabelDomain);

router.get("/", getSuperFranchises);
router.get("/:id", getSuperFranchiseById);
router.get("/:id/franchises", getSuperFranchiseFranchises);
router.put("/assign-franchise", assignFranchiseToSuperFranchise);

module.exports = router;
