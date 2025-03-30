const asyncHandler = require("express-async-handler")
// @desc Get all Pos Machine
// @route GET /api/pos_machine

const PosMachine = require('../models/posMachine');

const getAllPosMachine = asyncHandler(async (req, res) => {
    const { status, tid_number } = req.query;
try {
     const where = {};
    if (tid_number) where.tid_number = tid_number;
    if (status) where.status = status;
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


const assignPosMachineToFranchaise = asyncHandler ( async (req, res) => {
    const ids = req.body.ids
    const franchaiseId = req.franchaiseId
    if (!ids || !Array.isArray(ids) || ids.length === 0 || !franchaiseId) {
        res.status(400);
        throw new Error ("All fields are mandatory !")
    }

    const updated = await PosMachine.update(
        { franchaise_id: franchaiseId },
        {
        where: {
            id: ids
        }
        }
    );

    res.status(200).json({
        message: `POS Machines assigned to franchaise ${franchaiseId}`,
        updatedCount: updated[0] // this gives number of affected rows
    });
});

const assignPosMachineToMerhcant = asyncHandler ( async (req, res) => {
    const id = req.body.id
    const franchaiseId = req.merchantId
    if (!id || !Array.isArray(ids) || ids.length === 0 || !franchaiseId) {
        res.status(400);
        throw new Error ("All fields are mandatory !")
    }

    const updated = await PosMachine.update(
        { assigned_user_id: merchantId },
        {
        where: {
            id: id
        }
        }
    );

    res.status(200).json({
        message: `POS Machines assigned to merchant ${merchantId}`
    });
});



module.exports = { getAllPosMachine, createPosMachine, getPosMachine, activatePosMachine, deactivatePosMachine, deletePosMachine, markAsDelivered , markAsReturnInitiated, assignPosMachineToFranchaise, assignPosMachineToMerhcant}