const asyncHandler = require("express-async-handler");
const User = require('../models/User');
const { Op } = require("sequelize");
const bcrypt = require("bcrypt");
const upload = require("../utils/mutlerSetup")

const onBoardUser = asyncHandler(async(req, res) => {
    try{
    
    const role = "franchaise"
    // const { email, password, mobile_number } = req.body

    // if (!email || !mobile_number || !password) {
    //     res.status(400);
    //     throw new Error("email, mobile_number and password fields are mandatory. !") ;
    // }


    // const existingUser = await User.findOne({
    //     where: {
    //         [Op.or]: [
    //             { email: email },
    //             { mobile_number: mobile_number }
    //         ]
    //     }
    //     });

    const {id} = req.params

    const user = await User.findByPk(id)

    if (!user) {
        res.status(400);
        throw new Error("User does not exists!");
    };
   

      const panFile = req.files?.pan_photo?.[0];
      const aadharFile = req.files?.aadhar_photo?.[0];
      const shopFile = req.files?.shop_photo?.[0];

      const baseUrl = `${req.protocol}://${req.get('host')}/uploads/`;
      const panUrl = panFile ? `${baseUrl}${panFile.filename}` : null;
      const aadharUrl = aadharFile ? `${baseUrl}${aadharFile.filename}` : null;
      const shopUrl = shopFile ? `${baseUrl}${shopFile.filename}` : null;

      user.set({
      role: role,
      is_approved: true,
      organization_name: req.body.organization_name,
      dob: req.body.dob,
      gender: req.body.gender,
      address1: req.body.address1,
      address2: req.body.address2,
      city: req.body.city,
      district: req.body.district,
      pincode: req.body.pincode,
      state: req.body.state,
      country: req.body.country,
      pan_number: req.body.pan_number,
      aadhar_number: req.body.aadhar_number,
      pan_number_url: panUrl || user.pan_number_url,
      aadhar_number_url: aadharUrl || user.aadhar_number_url,
      shop_with_photo_url: shopUrl || user.shop_with_photo_url,
      status: "active"
    });

await user.save();

    if (user) {
        res.status(200).json({id: user.id})
    } else {
        res.status(400);
        throw new Error("User is not valid !")
    }
    } catch (error) {
        res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
      }
});

const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findByPk(id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
if (user.role !== "franchaise") {
    res.status(404);
    throw new Error('User not found');
}
  res.status(200).json(user);
});

const getUsers = asyncHandler(async (req, res) => {
  const userRole = req.user.role
  if (userRole === "merchant") {
    res.status(400);
    throw new Error('you are not allowed!');
    }
  let users;
  if (userRole === "admin") {
      const role = "franchaise"
      users = await User.findAll({ 
        where:{role: role, status: "active" },  
        order: [['createdAt', 'DESC']]
      });
  }
  if (userRole === "franchaise") {
      users = await User.findAll({
        where: {
          status: "active",
          id: req.user.id
        },
        order: [['createdAt', 'DESC']]
      });
  }
  res.status(200).json(users);
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    res.status(400);
    throw new Error('Status is required');
  }

  const user = await User.findByPk(id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.status = status;
  await user.save();

  res.status(200).json({ message: 'Status updated', id });
});

module.exports = {onBoardUser, getUserById, getUsers, updateUserStatus}