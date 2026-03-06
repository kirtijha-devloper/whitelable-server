const asyncHandler = require('express-async-handler');
const CompanyName = require('../models/CompanyName');
const { Op } = require('sequelize');

// Admin-only write operations, read available to any authenticated user

// Create a new company name
const createCompanyName = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied: only admin can create company names');
  }

  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400);
    throw new Error('Name is required');
  }

  // prevent duplicates
  const existing = await CompanyName.findOne({ where: { name: name.trim() } });
  if (existing) {
    res.status(400);
    throw new Error('Company name already exists');
  }

  const record = await CompanyName.create({
    name: name.trim(),
    created_by: req.user.id
  });

  res.status(201).json({ message: 'Company name created', record });
});

// List all company names
const getCompanyNames = asyncHandler(async (req, res) => {
  const records = await CompanyName.findAll({ order: [['createdAt', 'DESC']] });
  res.status(200).json(records);
});

// Update existing company name
const updateCompanyName = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied: only admin can update company names');
  }

  const rec = await CompanyName.findByPk(req.params.id);
  if (!rec) {
    res.status(404);
    throw new Error('Company name not found');
  }

  const { name } = req.body;
  if (name && name.trim() !== rec.name) {
    // check duplicate
    const dup = await CompanyName.findOne({
      where: {
        name: name.trim(),
        id: { [Op.ne]: rec.id }
      }
    });
    if (dup) {
      res.status(400);
      throw new Error('Another record with this name already exists');
    }
    rec.name = name.trim();
  }

  rec.updated_by = req.user.id;
  await rec.save();

  res.status(200).json({ message: 'Company name updated', record: rec });
});

// Delete a company name
const deleteCompanyName = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied: only admin can delete company names');
  }

  const rec = await CompanyName.findByPk(req.params.id);
  if (!rec) {
    res.status(404);
    throw new Error('Company name not found');
  }

  await rec.destroy();
  res.status(200).json({ message: 'Company name deleted' });
});

module.exports = {
  createCompanyName,
  getCompanyNames,
  updateCompanyName,
  deleteCompanyName
};
