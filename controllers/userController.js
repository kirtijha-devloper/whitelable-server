const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require('../models/User');

const registerUser = asyncHandler( async (req, res) => {
    console.log("hrespones", req.body)
    const { email, password} = req.body
    if (!email || !password) {
        res.status(400);
        throw new Error("All fields are mandatory. !") ;
    }

    const userAvailable = await User.findOne({ where: { email: email } });

    if (userAvailable) {
        res.status(400);
        throw new Error("User Already Exist!");
    }

   
    // await User.sync(); 
    const hashPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: email,
      password: hashPassword,
      is_approved: false,
      status: "active"
    }
    );

    console.log("User created", user)

    if (user) {
        res.status(201).json({id: user.id, email: user.email})
    } else {
        res.status(400);
        throw new Error("User is not valid !")
    }
});

const loginUser = asyncHandler( async (req, res) => {
    const { email, password } = req.body
    if (!email || !password) {
        res.status(400);
        throw new Error("All fields are mandatory. !") ;
    }

    const user = await User.findOne({ where: { email: email } });

    if (user && (await bcrypt.compare(password, user.password))){
        const accessToken = jwt.sign({
            user: {
                name: user.name,
                email: user.email,
                mobile_number: user.mobile_number,
                id: user.id,
                role: user.role
            }},
            process.env.ACCESS_TOKEN_SECRET,
            {expiresIn: "30m"}
        );
        res.status(200).json({accessToken})
    }else {
        res.status(401);
        throw new Error("Email or Password are not valid !.")
    }
});

const onBoardUser = asyncHandler(async(req, res) => {
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
    const user = await User.create({
        email: email,
        password: hashPassword,
        is_approved: false,
        mobile_number: mobile_number,
        status: "active",
        is_approved: req.is_approved || false,
        role: req.role || "merhcant",
        organization_name: req.organization_name,
        dob: req.dob,
        gender: req.gender,
        address1: req.address1,
        address2: req.address2,
        city: city.req,
        district: req.district,
        pincode: req.pincode,  
        state: req.state,
        country:  req.country,
        pan_number: req.pan_number,
        aadhar_number: req.aadhar_number,
        pan_number_url: req.pan_number_url,
        aadhar_number_url: req.aadhar_number_url,
        shop_with_photo_url: req.shop_with_photo_url,
    }
    );
    console.log("OnBoarded User", user)
    if (user) {
        res.status(201).json({id: user.id})
    } else {
        res.status(400);
        throw new Error("User is not valid !")
    }
})

const approveUser = asyncHandler( async (req, res) => {
    const role = req.user.role
    if (role !== "admin")
        throw new Error ("You are not allowed!")
    end
    const id = req.params.id
    const user = await User.findOne({ where: { id } });


    if (user) {
        res.status(200).json(loginUserRole)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };

});

const currentUser = asyncHandler( async (req, res) => {
    const user = await User.findOne({ where: { email: req.user.email } });
    res.json(user);
});

module.exports = {registerUser, loginUser, currentUser, onBoardUser, approveUser }