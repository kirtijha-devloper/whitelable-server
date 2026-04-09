const express = require('express');

const router = express.Router();

const validateToken = require('../middleware/validateTokenHandler');
const {
  createEmployeeAccessRole,
  deleteEmployeeAccessRole,
  getEmployeeAccessRoleById,
  getEmployeeAccessRoleMeta,
  listEmployeeAccessRoles,
  updateEmployeeAccessRole,
} = require('../controllers/employeeAccessRoleController');

router.use(validateToken);

router.get('/meta', getEmployeeAccessRoleMeta);
router.get('/', listEmployeeAccessRoles);
router.post('/', createEmployeeAccessRole);
router.get('/:id', getEmployeeAccessRoleById);
router.put('/:id', updateEmployeeAccessRole);
router.delete('/:id', deleteEmployeeAccessRole);

module.exports = router;
