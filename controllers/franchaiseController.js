const asyncHandler = require("express-async-handler");
const User = require('../models/User');
const { Op } = require("sequelize");
const bcrypt = require("bcrypt");

const onBoardUser = asyncHandler(async(req, res) => {
    try{
    console.log("test franchaise")
    const role = "franchaise"
    const { email, password, mobile_number } = req.body

    if (!email || !mobile_number || !password) {
        res.status(400);
        throw new Error("email, mobile_number and password fields are mandatory. !") ;
    }


    const existingUser = await User.findOne({
        where: {
            [Op.or]: [
                { email: email },
                { mobile_number: mobile_number }
            ]
        }
        });
    
    if (existingUser) {
        res.status(400);
        throw new Error("User with this email or mobile number already exists!");
    }

    const hashPassword = await bcrypt.hash(password, 10);

    let abheepay_id = '';
    let abheepayPrefix = '';
    let count = 0;
    if (role == 'merchant') {
        abheepayPrefix = 'APM';
        count = await User.count({ where: { role: 'merchant' } });
        abheepay_id = `${abheepayPrefix}${String(count + 1).padStart(4, '0')}`;
        } else if (role == 'franchaise') {
        abheepayPrefix = 'APF';
        count = await User.count({ where: { role: 'franchaise' } });
        abheepay_id = `${abheepayPrefix}${String(count + 1).padStart(4, '0')}`;
        } else if (role == 'admin') {
        abheepayPrefix = 'APA';
        count = await User.count({ where: { role: 'admin' } });
        if (count == 0) {count = 1}
        abheepay_id = `${abheepayPrefix}${String(count + 1).padStart(4, '0')}`;
    }

    const user = await User.create({
        role: "franchaise",
        email: email,
        password: hashPassword,
        mobile_number: mobile_number,
        mobile_number_country_code: req.body.mobile_number_country_code || "+91",
        is_approved: req.body.is_approved || false,
        organization_name: req.body.organization_name,
        dob: req.body.dob,
        gender: req.body.gender,
        address1: req.body.address1,
        address2: req.body.address2,
        city: req.body.city,
        district: req.body.district,
        pincode: req.body.pincode,  
        state: req.body.state,
        country:  req.body.country,
        pan_number: req.body.pan_number,
        aadhar_number: req.body.aadhar_number,
        pan_number_url: req.body.pan_number_url,
        aadhar_number_url: req.body.aadhar_number_url,
        shop_with_photo_url: req.body.shop_with_photo_url,
        abheepay_id: abheepay_id,
        status: "active"
    }
    );
    console.log("OnBoarded User", user)
    if (user) {
        res.status(201).json({id: user.id})
    } else {
        res.status(400);
        throw new Error("User is not valid !")
    }
    } catch (error) {
         res.status(500).json({ error });
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
  const { status } = req.query;
  const role = "franchaise"

  const where = {};
  if (role) where.role = role;
  if (status) where.status = status;

  const users = await User.findAll({ where });

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