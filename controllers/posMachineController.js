const asyncHandler = require("express-async-handler")
// @desc Get all Pos Machine
// @route GET /api/pos_machine

const PosMachine = require('../models/posMachine');
const User = require('../models/User');

const getAllPosMachine = asyncHandler(async (req, res) => {
    const { status, tid_number, is_pos_assigned } = req.query;
try {
    const where = {};
    if (tid_number) where.tid_number = tid_number;
    if (status) where.status = status;
    if (is_pos_assigned) where.is_pos_assigned = is_pos_assigned
    const posMachines = await PosMachine.findAll({where});
    res.json({list: posMachines});
    } catch (error) {
        res.status(500).json({ error: error });
    };
});

// @desc Create  Pos Machine
// @route POST /api/pos_machine

const createPosMachine = asyncHandler(async (req, res ) => {
    try {
    console.log("create params:", req.body)
    const { tid_number, mid_number, device_serial_number } = req.body;
    if (!tid_number || !mid_number || !device_serial_number) {
        res.status(400);
            throw new Error ("All fields are mandatory !")
    };

    const newPosMachine = await PosMachine.create({
        tid_number: req.body.tid_number,   
        mid_number: req.body.mid_number, 
        device_serial_number: req.body.device_serial_number,
        remarks: req.body.remarks || "added",
        status: "added"})

    res.status(201).json(newPosMachine);
    } catch (error) {
    res.status(500).json({ error: error });
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

const deactivatePosMachine = asyncHandler( async (req, res) => {
    const id = req.params.id;
    const posMachineById = await PosMachine.findByPk(id)
    if (posMachineById) {
        posMachineById.status = "in_active";
        await posMachineById.save();
        res.status(200).json(posMachineById)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };
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
    if (!ids || !Array.isArray(ids) || ids.length === 0 || !userId) {
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

    const user = User.findByPk(userId)
    const assigneeRole = user.role

    const where = {}
    if (assigneeRole === "franchaise") {where.franchaise_id = userId};
    if (assigneeRole === "merchant") {where.assigned_user_id = userId};


    const updated = await PosMachine.update(
        { where},
        {
        where: {
            id: ids
        }
        }
    );

    user.is_pos_assigned = true
    await user.save()

    res.status(200).json({
        message: `POS Machines assigned `,
        updatedCount: updated[0]
    });
});

const assignPosMachineToMerhcant = asyncHandler ( async (req, res) => {
    const id = req.body.id
    const merchantId = req.body.merchantId
    if (!id || id.length === 0 || !merchantId) {
        res.status(400);
        throw new Error ("All fields are mandatory !")
    }

    await PosMachine.update(
        { assigned_user_id: merchantId },
        {
        where: {
            id: id
        }
        }
    );

    const merchant = await User.findByPk(id)
    await merchant.update({is_pos_assigned: true});

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

    res.status(200).json({
      totalItems: count,
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      data: machines
    });
    } catch (error) {
    res.status(500).json({
        message: `Error ${error}`
    });
};
  });



module.exports = { getAllPosMachine, createPosMachine, getPosMachine, activatePosMachine, deactivatePosMachine, deletePosMachine, markAsDelivered , markAsReturnInitiated, assignPosMachineToUserID, assignPosMachineToMerhcant, getPosMachineList}