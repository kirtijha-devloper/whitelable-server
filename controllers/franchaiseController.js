const asyncHandler = require("express-async-handler");
const User = require('../models/User');
const { Op } = require("sequelize");
const bcrypt = require("bcrypt");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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
   

      const panFile = req.files?.pan_photo;
      const aadharFile = req.files?.aadhar_photo;
      const shopFile = req.files?.shop_photo;

      const panUrl = panFile ? await cloudinary.uploader.upload(panFile.tempFilePath, {
        folder: "franchaise",
      }) : null;
      const aadharUrl = aadharFile ? await cloudinary.uploader.upload(aadharFile.tempFilePath, {
        folder: "franchaise",
      }) : null;

      const shopUrl = shopFile ? await cloudinary.uploader.upload(shopFile.tempFilePath, {
        folder: "franchaise",
      }) : null;

  

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
      pan_number_url: panUrl?.secure_url || user.pan_number_url,
      aadhar_number_url: aadharUrl?.secure_url || user.aadhar_number_url,
      shop_with_photo_url: shopUrl?.secure_url || user.shop_with_photo_url,
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
  try {
    const { 
      status = "active",
      page = 1,
      limit = 10
    } = req.query;

    const userRole = req.user.role;
    
    if (userRole === "merchant") {
      res.status(400);
      throw new Error('you are not allowed!');
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    // Role-based filtering
    if (userRole === "admin") {
      where.role = "franchaise";
      if (status) where.status = status;
    } else if (userRole === "franchaise") {
      // Franchise can only see themselves
      where.id = req.user.id;
      if (status) where.status = status;
    }

    // Get total count and paginated results
    const { count, rows: users } = await User.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: users,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
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