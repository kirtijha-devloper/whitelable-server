const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require('../models/User');

const registerUser = asyncHandler( async (req, res) => {
    try {
    console.log("hrespones", req.body)
    const { email, password, role} = req.body
    if (!email || !password || !role) {
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
      role: role,
      mobile_number: req.body.mobile_number,
      mobile_number_country_code: (req.body.mobile_number || "+91"),
      name: req.body.name,
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
    } catch(error) {res.status(500).json({ error });}
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
    const user = await User.findOne({ where: { email: req.user.email } })
    res.json({
        email: user.email,
        mobile_number: user.mobile_number, 
        name: (user.name || "NA"), 
        mobile_number_country_code: (user.mobile_number_country_code || "+91"),
        role: user.role || "merhcant",
        abheepay_id: user.abheepay_id,
        is_approved: user.is_approved,
        organization_name: user.organization_name || "NA",
        status: user.status,
        is_pos_assigned: ( user.is_pos_assigned || false),
        wallet: user.wallet
});
});

module.exports = {registerUser, loginUser, currentUser, approveUser }