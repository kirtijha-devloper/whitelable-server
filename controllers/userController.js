const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const  User = require('../models/User');
const ChargeType = require('../models/ChargeType');
const ChargeSlab = require('../models/ChargeSlab')
const { Op } = require('sequelize');

const getUsers = asyncHandler(async (req, res) => {
    const { status } = req.query;

    const where = {};
    if (status) where.status = status;

    const users = await User.findAll({ 
        where,
        limit: 10,
        order: [['createdAt', 'DESC']]});

    res.status(200).json(users);
    });

    const getUserByID = asyncHandler(async (req, res) => {
        try {
            const role = req.user.role;
            const searchedId = req.params.id;
            const isPosRentalSlabRequired = req.query.is_pos_rental_slab_required;
            const isPayoutSlabRequired = req.query.is_payout_slab_required;

            const searchedUser = await User.findByPk(searchedId);

            if (!searchedUser) {
            res.status(404);
            throw new Error("User Not Found.");
            }

            if (role === "franchaise") {
            if (searchedUser.franchaise_id !== req.user.id) {
                res.status(403);
                throw new Error("You are not allowed to view this user.");
            }
            }

            if (role === "merchant") {
            if (req.user.id !== Number(searchedId)) {
                res.status(403);
                throw new Error("You are not allowed to view this user.");
            }
            }
            const response = {};

            response.user = searchedUser

        if (isPosRentalSlabRequired) {
                const slabs = await ChargeSlab.findAll({
                where: {
                    charge_type_category: "pos_rental",
                    user_id: searchedId
                }
                });
                response.pos_rental_slabs = slabs;
            }
        if (isPayoutSlabRequired) {
                const slabs = await ChargeSlab.findAll({
                where: {
                    charge_type_category: "payout_slab",
                    user_id: searchedId
                }
                });
                response.payout_slabs = slabs;
            }
            res.status(200).json(response);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });


const registerUser = asyncHandler( async (req, res) => {
    try {
    const { email, password, role} = req.body
    if (!email || !password || !role) {
        res.status(400);
        throw new Error("All fields are mandatory!") ;
    }

    const userAvailable = await User.findOne({ where: { email: email } });

    if (userAvailable) {
        res.status(400);
        throw new Error("User Already Exist!");
    }

    // await User.sync(); 
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
        email: email,
        password: hashPassword,
        role: role,
        mobile_number: req.body.mobile_number,
        mobile_number_country_code: (req.body.mobile_number_country_code || "+91"),
        abheepay_id: abheepay_id,
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
            {expiresIn: "5h"}
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

    user.is_approved = true;

    await user.save();
    if (user) {
        res.status(200).json(loginUserRole)
    } else {
        res.status(404);
            throw new Error ("NoT Found !")
    };

});

    const currentUser = asyncHandler( async (req, res) => {
        try {
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
                    is_pos_asigned: ( user.is_pos_asigned || false),
                    wallet: user.wallet,
                    id: user.id
            });
        } catch(err) {
        res.status(404);
            throw new Error("token is expired!")
        }
        });

    const updatePassword = asyncHandler(async (req, res) => {
        const { id, password } = req.body;

        if (!id || !password) {
            res.status(400);
            throw new Error("All fields are mandatory!");
        }

        if (req.user.id !== Number(id)) {
            res.status(401);
            throw new Error("You are not authorized.");
        }

        const user = await User.findByPk(id);
        if (!user) {
            res.status(404);
            throw new Error("User not found.");
        }

        const hashPassword = await bcrypt.hash(password, 10);
        user.password = hashPassword;
        await user.save();

        res.status(200).json({ message: "Password updated successfully." });
    });

    const updateFranchaiseID = asyncHandler(async (req, res) => {});

module.exports = {registerUser, loginUser, currentUser, approveUser, getUsers, getUserByID, updatePassword, updateFranchaiseID}