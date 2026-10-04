const Sequelize = require("sequelize");
const db = require("../config/database");
const User = db.define("User", {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.INTEGER,
  },
  name: {
    allowNull: true,
    type: Sequelize.STRING,
  },
  email: {
    allowNull: false,
    type: Sequelize.STRING,
  },
  mobile_number: {
    allowNull: true,
    type: Sequelize.STRING,
  },

  mobile_number_country_code: {
    allowNull: true,
    type: Sequelize.STRING,
  },

  password: {
    allowNull: false,
    type: Sequelize.STRING,
  },

  role: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: "merchant",
  },
  permissions: {
    type: Sequelize.JSON,
    allowNull: false,
    defaultValue: [],
    comment: "Action-based permissions for employee users.",
  },
  employee_access_role_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment: "Assigned EmployeeAccessRole.id for employee users.",
  },
  abheepay_id: {
    type: Sequelize.STRING,
  },
  dob: {
    type: Sequelize.DATE,
  },
  gender: {
    type: Sequelize.STRING,
  },
  address1: {
    type: Sequelize.STRING,
  },
  address2: {
    type: Sequelize.STRING,
  },
  city: {
    type: Sequelize.STRING,
  },
  district: { type: Sequelize.STRING },
  pincode: { type: Sequelize.STRING },
  state: { type: Sequelize.STRING },
  country: { type: Sequelize.STRING },
  pan_number: { type: Sequelize.STRING },
  aadhar_number: { type: Sequelize.STRING },
  pan_number_url: { type: Sequelize.STRING },
  aadhar_number_url: { type: Sequelize.STRING },
  aadhar_back_number_url: { type: Sequelize.STRING },
  shop_with_photo_url: { type: Sequelize.STRING },
  bank_passbook_url: { type: Sequelize.STRING },
  bank_account_number: { type: Sequelize.STRING, allowNull: true },
  bank_ifsc: { type: Sequelize.STRING, allowNull: true },
  is_approved: {
    type: Sequelize.BOOLEAN,
    defaultValue: false,
  },
  organization_name: {
    allowNull: true,
    type: Sequelize.STRING,
  },
  is_pos_asigned: {
    type: Sequelize.BOOLEAN,
    defaultValue: false,
  },
  status: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: "active",
  },
  is_payout_enabled: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: "Can this user initiate payout requests?",
  },
  start_ledger: {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment:
      "When true, ledger entries are recorded for this user. Admin-only flag; can only be enabled, never disabled via API.",
  },
  wallet: {
    type: Sequelize.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.0,
  },
  settlement_type: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: "T0",
    validate: {
      isIn: {
        args: [["T0", "T1", "today_settlement", "next_day_settlement"]],
        msg: 'settlement_type must be either "T0", "T1", "today_settlement", or "next_day_settlement"',
      },
    },
  },
  t0_daily_limit: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: true,
    defaultValue: null,
    comment: "Daily limit for T0 settlements. NULL means Unlimited.",
  },
  cutoff_timestamp: {
    type: Sequelize.STRING(5),
    allowNull: true,
    defaultValue: null,
    comment:
      "User custom cutoff timestamp (HH:mm). NULL inherits global_default_cutoff_time.",
  },
  t1_balance: {
    type: Sequelize.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.0,
    comment: "Pending T1 funds (from card/POS transactions)",
  },
  prev_day_settled_balance: {
    type: Sequelize.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.0,
    comment: "Usable settled funds before cutoff",
  },
  franchaise_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    // references: {
    //   model: 'Users',
    //   key: 'id'
    // }
  },
  super_franchise_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
  },
  company_or_shop_name: {
    type: Sequelize.STRING,
    allowNull: true,
    comment: "Optional company or shop name provided by user",
  },
  company_id: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  username: {
    type: Sequelize.STRING,
    allowNull: true,
    unique: true,
    comment: "System-generated login username (not supplied by frontend)",
  },
  // InstantPay outlet ID (aka "pin").
  //
  // This is set via the KYC flow (POST /api/kyc/validate-otp) when the
  // InstantPay API returns `data.outletId` after successful OTP validation.
  //
  // It is used by downstream InstantPay integrations (e.g. BBPS bill payments)
  // and can also be set/updated via the admin endpoint
  // PUT /api/merchant/:id/ipay-outlet.
  ipay_outlet_id: {
    type: Sequelize.INTEGER,
    allowNull: true,
    comment:
      "InstantPay outlet ID assigned to this merchant (from InstantPay KYC/OTP validation)",
  },
  createdAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW,
  },
  updatedAt: {
    allowNull: false,
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW,
  },
});

User.associate = function (models) {
  User.belongsTo(models.User, {
    foreignKey: "franchaise_id",
    as: "franchise_details",
  });
  User.belongsTo(models.User, {
    foreignKey: "super_franchise_id",
    as: "super_franchise_details",
  });
  User.hasMany(models.User, { foreignKey: "franchaise_id", as: "merchants" });
  User.hasMany(models.User, {
    foreignKey: "super_franchise_id",
    as: "franchises",
  });
  User.belongsTo(models.Company, {
    foreignKey: "company_id",
    targetKey: "company_id",
    as: "company",
  });
};

module.exports = User;
