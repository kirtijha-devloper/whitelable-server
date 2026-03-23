const asyncHandler = require("express-async-handler")
// @desc Get all Pos Machine
// @route GET /api/pos_machine

const { Op } = require('sequelize');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const PosMachineAssignmentLog = require('../models/PosMachineAssignmentLog');
const { response } = require("express");
const { parse } = require('csv-parse/sync');
const fs = require('fs');

const getAllPosMachine = asyncHandler(async (req, res) => {
  const { 
    status, 
    tid_number, 
    mid_number, 
    device_serial_number, 
    razorpay_id, 
    company_name,
    bank_name,
    is_pos_asigned,
    page = 1,
    limit = 10
  } = req.query;
  const userRole = req.user.role;
  const userId = req.user.id;

  try {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    // Filters from query
    if (tid_number) where.tid_number = tid_number;
    if (mid_number) where.mid_number = mid_number;
    if (device_serial_number) where.device_serial_number = device_serial_number;
    if (razorpay_id) where.razorpay_id = razorpay_id;
    if (company_name) where.company_name = company_name;
    if (bank_name) where.bank_name = bank_name;

    if (status) where.status = status;
    if (is_pos_asigned !== undefined) where.is_pos_asigned = is_pos_asigned;

    // Role-based access - filter by logged-in user
    if (userRole === "franchaise") {
      where.franchaise_id = userId;
    } else if (userRole === "merchant") {
      where.assigned_user_id = userId;
    }
    // Admin can see all (no additional filter)

    // Get total count and paginated results
    const { count, rows: posMachines } = await PosMachine.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
    });

    const formattedPosMachines = await Promise.all(posMachines.map(async (posMachine) => {
      let assignedUser = null;
      let franchaiseDetails = null;
      
      if (posMachine.assigned_user_id) {
        assignedUser = await User.findByPk(posMachine.assigned_user_id, {
          attributes: ['id', 'name', 'email', 'abheepay_id'], // Select the required attributes
        });
      }

      if (posMachine.franchaise_id) {
        franchaiseDetails = await User.findByPk(posMachine.franchaise_id, {
          attributes: ['id', 'name', 'email', 'abheepay_id'], // Select the required attributes
        });
      }
         return {
        id: posMachine.id,
        tid_number: posMachine.tid_number,
        mid_number: posMachine.mid_number,
        device_serial_number: posMachine.device_serial_number,
        razorpay_id: posMachine.razorpay_id,
        status: posMachine.status,
        remarks: posMachine.remarks,
        company_name: posMachine.company_name,
        bank_name: posMachine.bank_name,
        assigned_user: assignedUser ? {
          id: assignedUser.id,
          name: assignedUser.name,
          email: assignedUser.email,
        } : null, // Include user details if assigned
        franchaise_id: posMachine.franchaise_id,
        franchaise_detail: franchaiseDetails ? {
          id: franchaiseDetails.id,
          name: franchaiseDetails.name,
          email: franchaiseDetails.email,
        } : null,
        createdAt: posMachine.createdAt,
        updatedAt: posMachine.updatedAt,
      };
    }));
    
    res.status(200).json({
      success: true,
      message: 'POS machines retrieved successfully',
      list: formattedPosMachines,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});


// @desc Create  Pos Machine
// @route POST /api/pos_machine

const createPosMachine = asyncHandler(async (req, res ) => {
    try {
    console.log("create params:", req.body)
    const { tid_number, mid_number, device_serial_number, company_name, bank_name } = req.body;
    const userRole = req.user.role
    if (!tid_number || !mid_number || !device_serial_number) {
        res.status(400);
            throw new Error ("All fields are mandatory !")
    };

    let franchaiseId = null
    if (userRole === "franchaise") {
      franchaiseId = req.user.id
    }

    const razorpayId = req.body.razorpayid || req.body.razorpay_id || null;
    const remarks = req.body.remarks || "added";

    const companyName = company_name ? company_name.toString().trim() : null;
    const bankName = bank_name ? bank_name.toString().trim() : null;

    // Prevent creating POS machine if TID/MID/Serial already exists for this company
    const existingDuplicate = await PosMachine.findOne({
      where: {
        company_name: companyName,
        [Op.or]: [
          { tid_number },
          { mid_number },
          { device_serial_number }
        ]
      }
    });

    if (existingDuplicate) {
      res.status(400);
      const duplicateField =
        existingDuplicate.tid_number === tid_number
          ? 'tid_number'
          : existingDuplicate.mid_number === mid_number
          ? 'mid_number'
          : 'device_serial_number';
      throw new Error(`A POS machine with the same ${duplicateField} already exists for this company.`);
    }

    // Create new record
    const posMachine = await PosMachine.create({
      tid_number: tid_number,
      mid_number: mid_number,
      device_serial_number: device_serial_number,
      company_name: companyName,
      bank_name: bankName,
      razorpay_id: razorpayId,
      remarks: remarks,
      status: "added",
      franchaise_id: franchaiseId
    });

    res.status(201).json({
      success: true,
      created: true,
      message: "POS machine created successfully",
      data: posMachine
    });
    } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
};
});

const getPosMachine = asyncHandler( async (req, res) => {
    const id = req.params.id;
    const posMachineById = await PosMachine.findByPk(id)
    if (posMachineById) {
        res.status(200).json(posMachineById)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };
    
});

const activatePosMachine = asyncHandler( async (req, res) => {
    const id = req.params.id;
    const posMachineById = await PosMachine.findByPk(id)
    if (posMachineById) {
        posMachineById.status = "active";
        await posMachineById.save();
        res.status(200).json(posMachineById)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };
});

const deactivatePosMachine = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const posMachineById = await PosMachine.findByPk(id);

  if (!posMachineById) {
    res.status(404);
    throw new Error("Not Found!");
  }

  // Save the assigned user ID before clearing it
  const assignedUserId = posMachineById.assigned_user_id;

  posMachineById.status = "in_active";
  posMachineById.assigned_user_id = null;
  posMachineById.franchaise_id = null;
  await posMachineById.save();

  if (assignedUserId) {
    const user = await User.findByPk(assignedUserId);
    if (user) {
      // Only clear the flag if the user no longer has any assigned machines
      const remaining = await PosMachine.count({ where: { assigned_user_id: assignedUserId } });
      if (remaining === 0) {
        user.is_pos_asigned = false;
        await user.save();
      }
    }
  }

  res.status(200).json(posMachineById);
});

const unassignPosMachine = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const posMachine = await PosMachine.findByPk(id);

  if (!posMachine) {
    res.status(404);
    throw new Error("Not Found!");
  }

  const previousAssignee = posMachine.assigned_user_id;
  const previousFranchise = posMachine.franchaise_id;

  // clear both merchant and franchise assignment
  posMachine.assigned_user_id = null;
  posMachine.franchaise_id = null;
  posMachine.status = "active"; // keep it available as inventory
  await posMachine.save();

  // When unassigning, update any user flags that indicate they have a POS machine
  if (previousAssignee) {
    const user = await User.findByPk(previousAssignee);
    if (user) {
      const remaining = await PosMachine.count({ where: { assigned_user_id: previousAssignee } });
      if (remaining === 0) {
        user.is_pos_asigned = false;
        await user.save();
      }
    }
  }

  if (previousFranchise) {
    const franchaiseUser = await User.findByPk(previousFranchise);
    if (franchaiseUser) {
      const remaining = await PosMachine.count({ where: { franchaise_id: previousFranchise } });
      if (remaining === 0) {
        franchaiseUser.is_pos_asigned = false;
        await franchaiseUser.save();
      }
    }
  }

  // audit log
  await PosMachineAssignmentLog.create({
    pos_machine_id: posMachine.id,
    action: 'unassign',
    assigned_from_user_id: previousAssignee,
    assigned_to_user_id: null,
    performed_by_user_id: req.user.id,
    details: {
      previous_franchaise_id: previousFranchise
    }
  });

  res.status(200).json(posMachine);
});


const deletePosMachine = asyncHandler( async (req, res) => {
    const id = req.params.id;
    const posMachineById = await PosMachine.findByPk(id)
    if (posMachineById) {
        posMachineById.status = "in_active";
        await posMachineById.destroy();
        res.status(200).json(posMachineById)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };
});

const markAsDelivered = asyncHandler( async (req, res) => {
    const id = req.params.id;
    const posMachineById = await PosMachine.findByPk(id)
    if (posMachineById) {
        posMachineById.status = "delivered"
         await posMachineById.save();
        res.status(200).json(posMachineById)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };
});

const markAsReturnInitiated = asyncHandler( async (req, res) => {
    const id = req.params.id;
    const remarks = req.body.remarks;
    const posMachineById = await PosMachine.findByPk(id)
    if (posMachineById) {
        posMachineById.status = "return_initiated";
        posMachineById.remarks = remarks;
         await posMachineById.save();
        res.status(200).json(posMachineById)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };
});


const assignPosMachineToUserID = asyncHandler ( async (req, res) => {
    const ids = req.body.ids
    const userId = req.body.user_id
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400);
        throw new Error ("POS machine IDs are required!")
    }

     if (!userId) {
        res.status(400);
        throw new Error("Target user_id is required");
    }

    if (req.user.role === 'merchant') {
        res.status(403);
        throw new Error("Merchants cannot assign POS machines");
    }

    const  user = await User.findByPk(userId)
     if (!user) {
        res.status(404);
        throw new Error("User Not Found!");
    }

    // allow merchants to have multiple POS machines (is_pos_asigned now indicates "has at least one")

    const assigneeRole = user.role

    // Capture current assignment state for audit logging
    const posMachines = await PosMachine.findAll({
      where: { id: ids }
    });

    const updated = await PosMachine.update(
        { status: "active",
        ...(assigneeRole === "franchaise" && { franchaise_id: userId }),
        ...(assigneeRole === "merchant" && { assigned_user_id: userId })
        },
        {
        where: {
            id: ids
        }
        }
    );

    // Create audit log entries for each machine updated
    await Promise.all(posMachines.map(async (posMachine) => {
      const action = posMachine.assigned_user_id ? 'reassign' : 'assign';
      await PosMachineAssignmentLog.create({
        pos_machine_id: posMachine.id,
        action,
        assigned_from_user_id: posMachine.assigned_user_id,
        assigned_to_user_id: userId,
        performed_by_user_id: req.user.id,
        details: {
          previous_franchaise_id: posMachine.franchaise_id,
          new_franchaise_id: assigneeRole === 'franchaise' ? userId : posMachine.franchaise_id
        }
      });
    }));

    if (assigneeRole === "merchant"){
      user.is_pos_asigned = true
      await user.save()
    }

    res.status(200).json({
        message: `POS Machines assigned `,
        updatedCount: updated[0]
    });
});

const assignPosMachineToMerchant = asyncHandler(async (req, res) => {
    // body should contain pos machine id and merchant user id
    const posMachineId = req.body.id;
    const merchantId = req.body.user_id;

    if (!posMachineId || !merchantId) {
        res.status(400);
        throw new Error("All fields are mandatory !");
    }

    // only admin or franchisee can perform this
    if (req.user.role === "merchant") {
        res.status(403);
        throw new Error("You are not allowed to assign.");
    }

    const merchantUser = await User.findByPk(merchantId);
    if (!merchantUser) {
        res.status(404);
        throw new Error("Merchant not found.");
    }

    if (merchantUser.role !== "merchant") {
        res.status(400);
        throw new Error("Please select correct merchant.");
    }

    // Franchise can only reassign machines that belong to them
    const posMachine = await PosMachine.findByPk(posMachineId);
    if (!posMachine) {
        res.status(404);
        throw new Error("POS machine not found.");
    }

    if (req.user.role === "franchaise") {
        if (!merchantUser.franchaise_id || merchantUser.franchaise_id !== req.user.id) {
            res.status(400);
            throw new Error("Please select correct merchant.");
        }
        if (!posMachine.franchaise_id || posMachine.franchaise_id !== req.user.id) {
            res.status(400);
            throw new Error("Cannot reassign a POS machine that does not belong to you.");
        }
    }

    // assign the POS machine
    const previousAssignedUserId = posMachine.assigned_user_id;
    const [updatedCount] = await PosMachine.update(
        { assigned_user_id: merchantId, status: "active" },
        { where: { id: posMachineId } }
    );

    if (updatedCount === 0) {
        res.status(404);
        throw new Error("POS machine not found or could not be updated.");
    }

    // mark merchant as having a POS assigned
    merchantUser.is_pos_asigned = true;
    await merchantUser.save();

    // audit log
    await PosMachineAssignmentLog.create({
      pos_machine_id: posMachineId,
      action: previousAssignedUserId ? 'reassign' : 'assign',
      assigned_from_user_id: previousAssignedUserId,
      assigned_to_user_id: merchantId,
      performed_by_user_id: req.user.id,
      details: {
        previous_franchaise_id: posMachine.franchaise_id,
        new_franchaise_id: posMachine.franchaise_id
      }
    });

    res.status(200).json({
        message: `POS Machine ${posMachineId} assigned to merchant ${merchantId}`,
        updatedCount
    });
});

const getPosMachineList = asyncHandler(async (req, res) => {
    try {
    console.log("user", req.user.role)
    const { status, company_name, bank_name, page = 1, limit = 10 } = req.query;
    const role = req.user.role; 
    const id = req.user.id;

    const offset = (page - 1) * limit;
    const where = {};

    if (status) where.status = status;
    if (company_name) where.company_name = company_name;
    if (bank_name) where.bank_name = bank_name;

    // Role-based scoping
    if (role === 'franchaise') {
      where.franchaise_id = id;
    } else if (role === 'merchant') {
      where.assigned_user_id = id;
    }

    const { count, rows: machines } = await PosMachine.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    const formattedPosMachines = await Promise.all(machines.map(async (posMachine) => {
      let assignedUser = null;
      
      if (posMachine.assigned_user_id) {
        assignedUser = await User.findByPk(posMachine.assigned_user_id, {
          attributes: ['id', 'name', 'email'], // Select the required attributes
        });
      }
         return {
        id: posMachine.id,
        tid_number: posMachine.tid_number,
        status: posMachine.status,
        remarks: posMachine.remarks,
        company_name: posMachine.company_name,
        bank_name: posMachine.bank_name,
        assigned_user: assignedUser ? {
          id: assignedUser.id,
          name: assignedUser.name,
          email: assignedUser.email,
        } : null, // Include user details if assigned
        franchaise_id: posMachine.franchaise_id,
        createdAt: posMachine.createdAt,
        updatedAt: posMachine.updatedAt,
      };
    }));

    res.status(200).json({
      totalItems: count,
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      data: formattedPosMachines
    });
    } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
};
  });

// Get assigned POS machines by user id (admin-only)
const getPosMachinesByUserId = asyncHandler(async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admin can access this endpoint' });
    }

    const { userId } = req.params;
    const { status, page = 1, limit = 50 } = req.query;

    const offset = (page - 1) * limit;
    const where = { assigned_user_id: userId };
    if (status) where.status = status;

    const { count, rows } = await PosMachine.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      success: true,
      totalItems: count,
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      data: rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});


const updatePosMachine = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params; // Assuming the ID is passed as a route param
    const {
      tid_number,
      mid_number,
      device_serial_number,
      razorpayid,
      remarks,
      status,
      company_name,
      bank_name
    } = req.body;

    // Validate if all required fields are present
    

    // Find the POS machine by ID
    const posMachine = await PosMachine.findByPk(id);
    if (!posMachine) {
      res.status(404);
      throw new Error("POS Machine not found");
    }

    // Update fields
    posMachine.tid_number = tid_number || posMachine.tid_number;
    posMachine.mid_number = mid_number || posMachine.mid_number;
    posMachine.device_serial_number = device_serial_number || posMachine.device_serial_number;
    posMachine.company_name = company_name !== undefined ? company_name : posMachine.company_name;
    posMachine.bank_name = bank_name !== undefined ? bank_name : posMachine.bank_name;
    posMachine.razorpay_id = razorpayid || posMachine.razorpay_id;
    posMachine.remarks = remarks || posMachine.remarks;
    posMachine.status = status || posMachine.status;

    if (!posMachine.tid_number || !posMachine.mid_number || !posMachine.device_serial_number) {
      res.status(400);
      throw new Error("All fields are mandatory!");
    }

    const updatedPosMachine = await posMachine.save();

    res.status(200).json(updatedPosMachine);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});

const bulkCreatePosMachines = asyncHandler(async (req, res) => {
  try {
    console.log("Request received:", req.file);
    
    if (!req.file) {
      res.status(400);
      throw new Error("Please upload a CSV file");
    }

    const userRole = req.user.role;
    let franchaiseId = null;
    if (userRole === "franchaise") {
      franchaiseId = req.user.id;
    }

    const results = [];
    const errors = [];

    // Read file content
    const fileContent = fs.readFileSync(req.file.path, 'utf-8');
    console.log("File content:", fileContent);

    // Parse CSV content using csv-parse library
    // Try parsing with headers first, fallback to column mapping if needed
    let records;
    try {
      records = parse(fileContent, {
        columns: true, // Use first line as column names
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true, // Allow inconsistent column counts
        cast: true // Auto-cast values
      });
    } catch (parseError) {
      // If parsing with headers fails, try without headers and map columns
      records = parse(fileContent, {
        columns: ['tid_number', 'mid_number', 'device_serial_number', 'razorpay_id', 'remarks', 'company_name'],
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        cast: true
      });
    }

    // Normalize column names (handle case variations and spaces)
    records = records.map(record => {
      const normalized = {};
      // Handle various column name formats - check multiple possible column names
      normalized.tid_number = (record.tid_number || record['TID Number'] || record['tid number'] || record['TID'] || record.tid || '').toString().trim();
      normalized.mid_number = (record.mid_number || record['MID Number'] || record['mid number'] || record['MID'] || record.mid || '').toString().trim();
      normalized.device_serial_number = (record.device_serial_number || record['Device Serial Number'] || record['device serial number'] || record['serial_number'] || record['Serial Number'] || record.serial_number || '').toString().trim();
      
      // company_name is optional
      normalized.company_name = (record.company_name || record['Company Name'] || record['company name'] || '').toString().trim() || null;
      // bank_name is optional
      normalized.bank_name = (record.bank_name || record['Bank Name'] || record['bank name'] || '').toString().trim() || null;
      
      // razorpay_id is optional - convert empty strings to null
      const razorpayIdValue = (record.razorpay_id || record['Razorpay ID'] || record['razorpay id'] || record['razorpayid'] || record.razorpayid || '').toString().trim();
      normalized.razorpay_id = razorpayIdValue && razorpayIdValue.length > 0 ? razorpayIdValue : null;
      
      // remarks is optional - default to 'added' if empty
      const remarksValue = (record.remarks || record['Remarks'] || '').toString().trim();
      normalized.remarks = remarksValue && remarksValue.length > 0 ? remarksValue : 'added';
      
      return normalized;
    }).filter(record => record.tid_number && record.mid_number && record.device_serial_number); // Filter out empty records

    console.log("Parsed records:", records);

    // Preload existing values from database (filtered by company_name) to avoid inserting duplicates
    const companyNames = [...new Set(records.map(r => r.company_name || null))];
    const nonNullCompanyNames = companyNames.filter(c => c !== null);
    const tids = [...new Set(records.map(r => r.tid_number).filter(Boolean))];
    const mids = [...new Set(records.map(r => r.mid_number).filter(Boolean))];
    const serials = [...new Set(records.map(r => r.device_serial_number).filter(Boolean))];

    const companyCondition = nonNullCompanyNames.length > 0
      ? { [Op.or]: [{ company_name: null }, { company_name: nonNullCompanyNames }] }
      : { company_name: null };

    const existingPosMachines = await PosMachine.findAll({
      where: {
        ...companyCondition,
        [Op.or]: [
          { tid_number: tids },
          { mid_number: mids },
          { device_serial_number: serials }
        ]
      },
      attributes: ['company_name', 'tid_number', 'mid_number', 'device_serial_number']
    });

    const makeKey = (company, field, value) => `${company ?? '<NULL>'}||${field}||${value}`;

    const existingKeys = new Set();
    existingPosMachines.forEach(p => {
      const companyKey = p.company_name || null;
      if (p.tid_number) existingKeys.add(makeKey(companyKey, 'tid_number', p.tid_number));
      if (p.mid_number) existingKeys.add(makeKey(companyKey, 'mid_number', p.mid_number));
      if (p.device_serial_number) existingKeys.add(makeKey(companyKey, 'device_serial_number', p.device_serial_number));
    });

    const createdKeys = new Set();

    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      const rowNumber = index + 2; // +2 because index is 0-based and we skip header row
      
      try {
        // Validate required fields
        if (!record.tid_number || !record.mid_number || !record.device_serial_number) {
          errors.push({
            row: rowNumber,
            data: record,
            error: "Missing required fields (tid_number, mid_number, device_serial_number)"
          });
          continue;
        }

        const companyName = record.company_name || null;
        const tidKey = makeKey(companyName, 'tid_number', record.tid_number);
        const midKey = makeKey(companyName, 'mid_number', record.mid_number);
        const serialKey = makeKey(companyName, 'device_serial_number', record.device_serial_number);

        // Check for duplicates against existing database records (same company)
        if (existingKeys.has(tidKey) || existingKeys.has(midKey) || existingKeys.has(serialKey)) {
          errors.push({
            row: rowNumber,
            data: record,
            error: `Duplicate TID/MID/Serial already exists for company "${companyName || 'NULL'}" (TID: ${record.tid_number}, MID: ${record.mid_number}, Serial: ${record.device_serial_number})`
          });
          continue;
        }

        // Prevent duplicates within the same upload (same company)
        if (createdKeys.has(tidKey) || createdKeys.has(midKey) || createdKeys.has(serialKey)) {
          errors.push({
            row: rowNumber,
            data: record,
            error: `Duplicate TID/MID/Serial in uploaded data for company "${companyName || 'NULL'}" (TID: ${record.tid_number}, MID: ${record.mid_number}, Serial: ${record.device_serial_number})`
          });
          continue;
        }

        // Create the POS machine
        const posMachine = await PosMachine.create({
          tid_number: record.tid_number,
          mid_number: record.mid_number,
          device_serial_number: record.device_serial_number,
          company_name: record.company_name || null,
          bank_name: record.bank_name || null,
          razorpay_id: record.razorpay_id || null,
          remarks: record.remarks || "added",
          status: "added",
          franchaise_id: franchaiseId
        });

        results.push(posMachine);
        createdKeys.add(tidKey);
        createdKeys.add(midKey);
        createdKeys.add(serialKey);
      } catch (error) {
        console.error(`Error processing record at row ${rowNumber}:`, error);
        errors.push({
          row: rowNumber,
          data: record,
          error: error.message || "Unknown error occurred"
        });
      }
    }

    // Delete the uploaded file
    try {
      fs.unlinkSync(req.file.path);
    } catch (error) {
      console.error("Error deleting file:", error);
    }

    res.status(200).json({
      success: true,
      message: `Created ${results.length} machines, skipped ${errors.length} rows`,
      createdCount: results.length,
      created: results,
      skipped: errors
    });
  } catch (error) {
    console.error("Bulk create error:", error);
    // Clean up file if it exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Error cleaning up file:", cleanupError);
      }
    }
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong"
    });
  }
});

// ⚠️ TEMPORARY – delete ALL POS machines. Remove before production.
const deleteAllPosMachines = asyncHandler(async (req, res) => {
  const deleted = await PosMachine.destroy({ where: {}, truncate: true });
  res.status(200).json({ success: true, message: `All POS machines deleted`, deleted });
});

module.exports = {
  getAllPosMachine,
  createPosMachine,
  getPosMachine,
  activatePosMachine,
  deactivatePosMachine,
  unassignPosMachine,
  deletePosMachine,
  deleteAllPosMachines,
  markAsDelivered,
  markAsReturnInitiated,
  assignPosMachineToUserID,
  assignPosMachineToMerchant,
  getPosMachineList,
  getPosMachinesByUserId,
  updatePosMachine,
  bulkCreatePosMachines
}