const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require('../models/User');

const registerUser = asyncHandler( async (req, res) => {
    console.log("hrespones", req.body)
    const { name, email, password, is_franchise, is_merchant } = req.body
    if (!name || !email || !password) {
        res.status(400);
        throw new Error("All fields are mandatory. !") ;
    }
    const userAvailable = await User.findOne({ where: { email: email } });

    if (userAvailable) {
        res.status(400);
        throw new Error("User Already Exist!");
    }

   

    const hashPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: email,
      name: name,
      password: hashPassword,
      mobile_number: "mobile_number_1",
      mobile_number_country_code: "mobile_number_country_code_2",
      is_admin: false, // Default value
      is_franchise: false, // Default value
      is_merchant: true, // Default value
      is_approved: false, // Default value
      is_pos_asigned: false // Default value
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
                id: user.id,
                is_admin: user.is_admin,
                is_franchise: user.is_franchise,
                is_merhcant: user.is_merchant
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

const currentUser = asyncHandler( async (req, res) => {
    res.json(req.user);
});

module.exports = {registerUser, loginUser, currentUser }