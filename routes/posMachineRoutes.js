const express = require("express")
const router = express.Router();
const { getAllPosMachine,createPosMachine, getPosMachine, activatePosMachine, deactivatePosMachine, deletePosMachine, markAsDelivered, markAsReturnInitiated } = require("../controllers/posMachineController");
const validateToken = require("../middleware/validateTokenHandler");

// router.use(validateToken)
router.route("/").get( getAllPosMachine );

router.route("/").post( createPosMachine );

router.route("/activate/:id").put( activatePosMachine );
router.route("/de-activate/:id").put( deactivatePosMachine );

router.route("/:id").get( getPosMachine );

router.route("/:id").delete( deletePosMachine );

router.route("/delivered/:id").put( markAsDelivered );

router.route("/returned-initiated/:id").put( markAsReturnInitiated );

module.exports = router;
