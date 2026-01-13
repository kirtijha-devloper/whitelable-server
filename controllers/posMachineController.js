const asyncHandler = require("express-async-handler")
// @desc Get all Pos Machine
// @route GET /api/pos_machine

const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const { response } = require("express");
const { parse } = require('csv-parse/sync');
const fs = require('fs');

const getAllPosMachine = asyncHandler(async (req, res) => {
  const { status, tid_number, mid_number, device_serial_number, razorpay_id, is_pos_asigned } = req.query;
  const userRole = req.user.role;
  const userId = req.user.id;

  try {
    const where = {};

    // Filters from query
    if (tid_number) where.tid_number = tid_number;
    if (mid_number) where.mid_number = mid_number;
    if (device_serial_number) where.device_serial_number = device_serial_number;
    if (razorpay_id) where.razorpay_id = razorpay_id;

    if (status) where.status = status;
    if (is_pos_asigned !== undefined) where.is_pos_asigned = is_pos_asigned;

    // Role-based access
    if (userRole === "franchaise") {
      where.franchaise_id = userId;
    } else if (userRole === "merchant") {
      where.assigned_user_id = userId;
    }

    const posMachines = await PosMachine.findAll({
      where,
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
    res.json({ list: formattedPosMachines });
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
    const { tid_number, mid_number, device_serial_number } = req.body;
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

    // Find or create based on required fields (tid_number, mid_number, device_serial_number)
    const [posMachine, created] = await PosMachine.findOrCreate({
        where: {
            tid_number: tid_number,
            mid_number: mid_number,
            device_serial_number: device_serial_number
        },
        defaults: {
            tid_number: tid_number,
            mid_number: mid_number,
            device_serial_number: device_serial_number,
            razorpay_id: razorpayId,
            remarks: remarks,
            status: "added",
            franchaise_id: franchaiseId
        }
    });

    // If record already exists, update optional fields if provided
    if (!created) {
        const updateData = {};
        if (razorpayId) {
            updateData.razorpay_id = razorpayId;
        }
        if (remarks && remarks !== "added") {
            updateData.remarks = remarks;
        }
        if (franchaiseId && !posMachine.franchaise_id) {
            updateData.franchaise_id = franchaiseId;
        }
        
        if (Object.keys(updateData).length > 0) {
            await posMachine.update(updateData);
        }
    }

    const statusCode = created ? 201 : 200;
    res.status(statusCode).json({
        success: true,
        created: created,
        message: created ? "POS machine created successfully" : "POS machine already exists",
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
      user.is_pos_asigned = false;
      await user.save();
    }
  }

  res.status(200).json(posMachineById);
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

    if (user.is_pos_asigned) {
        res.status(400);
        throw new Error("User Id has already pos assigned");
    }

    const assigneeRole = user.role

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
    if (assigneeRole === "merchant"){
      user.is_pos_asigned = true
      await user.save()
    }

    res.status(200).json({
        message: `POS Machines assigned `,
        updatedCount: updated[0]
    });
});

const assignPosMachineToMerhcant = asyncHandler ( async (req, res) => {
    const id = req.body.id
    const userId = req.body.user_id
    if (!id || !userId) {
        res.status(400);
        throw new Error ("All fields are mandatory !")
    }
    if (req.user.role == "merchant") {
        res.status(400);
        throw new Error("You are not allowed to assign.");
    }
    const user = await User.findByPk(userId)
    if (user.role !== "merchant") {
        res.status(400);
        throw new Error("Please select correct merchant.");
    }

    if (req.user.role == "franchaise") {
        if (user.franchaise_id) {
            if (user.franchaise_id !== req.user.id) {
                res.status(400);
                throw new Error("Please select correct merchant.");
            }
        } else {
            res.status(400);
                throw new Error("Please select correct merchant.");
}


    }

    
    merchant
    await PosMachine.update(
        { assigned_user_id: merchantId },
        {
        where: {
            id: id
        }
        }
    );

    const merchant = await User.findByPk(id)
    await merchant.update({is_pos_asigned: true});

    res.status(200).json({
        message: `POS Machines assigned to merchant ${merchantId}`
    });
});

const getPosMachineList = asyncHandler(async (req, res) => {
    try {
    console.log("user", req.user.role)
    const { status, page = 1, limit = 10 } = req.query;
    const role = req.user.role; 
    const id = req.user.id;

    const offset = (page - 1) * limit;
    const where = {};

    if (status) where.status = status;

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


const updatePosMachine = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params; // Assuming the ID is passed as a route param
    const {
      tid_number,
      mid_number,
      device_serial_number,
      razorpayid,
      remarks,
      status
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
        columns: ['tid_number', 'mid_number', 'device_serial_number', 'razorpay_id', 'remarks'],
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
      
      // razorpay_id is optional - convert empty strings to null
      const razorpayIdValue = (record.razorpay_id || record['Razorpay ID'] || record['razorpay id'] || record['razorpayid'] || record.razorpayid || '').toString().trim();
      normalized.razorpay_id = razorpayIdValue && razorpayIdValue.length > 0 ? razorpayIdValue : null;
      
      // remarks is optional - default to 'added' if empty
      const remarksValue = (record.remarks || record['Remarks'] || '').toString().trim();
      normalized.remarks = remarksValue && remarksValue.length > 0 ? remarksValue : 'added';
      
      return normalized;
    }).filter(record => record.tid_number && record.mid_number && record.device_serial_number); // Filter out empty records

    console.log("Parsed records:", records);

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

        // Use findOrCreate to optimize database queries (single query instead of findOne + create)
        const [posMachine, created] = await PosMachine.findOrCreate({
          where: {
            tid_number: record.tid_number,
            mid_number: record.mid_number,
            device_serial_number: record.device_serial_number
          },
          defaults: {
            tid_number: record.tid_number,
            mid_number: record.mid_number,
            device_serial_number: record.device_serial_number,
            razorpay_id: record.razorpay_id || null,
            remarks: record.remarks || "added",
            status: "added",
            franchaise_id: franchaiseId
          }
        });

        if (created) {
          // New record was created
          results.push(posMachine);
        } else {
          // Record already exists
          errors.push({
            row: rowNumber,
            data: record,
            error: `POS machine already exists (TID: ${record.tid_number}, MID: ${record.mid_number}, Serial: ${record.device_serial_number})`
          });
        }
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
      message: `Successfully created ${results.length} POS machines`,
      created: results,
      errors: errors
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

module.exports = { getAllPosMachine, createPosMachine, getPosMachine, activatePosMachine, deactivatePosMachine, deletePosMachine, markAsDelivered , markAsReturnInitiated, assignPosMachineToUserID, assignPosMachineToMerhcant, getPosMachineList, updatePosMachine, bulkCreatePosMachines}