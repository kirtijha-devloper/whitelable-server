const express = require("express");
const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");
const {
  createSuperAdmin,
  getSuperAdminData,
  getSuperAdminPosInventory,
} = require("../controllers/superAdminController");

const routes = express.Router();

routes.get("/getAllAdmins", validateToken, validateWhitelabelDomain, getSuperAdminData);
routes.post("/createAdmin", validateToken, validateWhitelabelDomain, createSuperAdmin);
routes.get("/getPosInventory", validateToken, validateWhitelabelDomain, getSuperAdminPosInventory);

module.exports = routes;