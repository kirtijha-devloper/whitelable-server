const asyncHandler = require("express-async-handler")
// @desc Get all Pos Machine
// @route GET /api/pos_machine

const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const { response } = require("express");

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

    let franchaiseId = ''
    if (userRole === "franchaise") {
      franchaiseId = req.user.id
    }

    const razorpayId = req.body.razorpayid

    const newPosMachine = await PosMachine.create({
        tid_number: req.body.tid_number,   
        mid_number: req.body.mid_number, 
        device_serial_number: req.body.device_serial_number,
        razorpay_id: razorpayId,
        remarks: req.body.remarks || "added",
        status: "added",
        franchaise_id: franchaiseId})

    res.status(201).json(newPosMachine);
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



module.exports = { getAllPosMachine, createPosMachine, getPosMachine, activatePosMachine, deactivatePosMachine, deletePosMachine, markAsDelivered , markAsReturnInitiated, assignPosMachineToUserID, assignPosMachineToMerhcant, getPosMachineList, updatePosMachine}