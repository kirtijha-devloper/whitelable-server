
const Sequelize = require('sequelize');
const db = require('../config/database');
const User = db.define('User', {
  id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      name: {
        allowNull: true,
        type: Sequelize.STRING
      },
      email: {
        allowNull: false,
        type: Sequelize.STRING
      },
      mobile_number: {
        allowNull: true,
        type: Sequelize.STRING
      },

      mobile_number_country_code: {
        allowNull: true,
        type: Sequelize.STRING
      },

      password: {
        allowNull: false,
        type: Sequelize.STRING    
      },

      role: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'merchant'
      },
      abheepay_id: {
      type: Sequelize.STRING
      },
      dob: {
      type: Sequelize.DATE
      },
      gender: {
      type: Sequelize.STRING
      },
      address1: {
      type: Sequelize.STRING },
      address2: {
      type: Sequelize.STRING },
      city: {
      type: Sequelize.STRING },
      district: { type: Sequelize.STRING },
      pincode: { type: Sequelize.STRING },  
      state: { type: Sequelize.STRING },
      country:  { type: Sequelize.STRING },
      pan_number: {type: Sequelize.STRING },
      aadhar_number: {type: Sequelize.STRING},
      pan_number_url: {type: Sequelize.STRING },
      aadhar_number_url: {type: Sequelize.STRING},
      aadhar_back_number_url: {type: Sequelize.STRING},
      shop_with_photo_url: {type: Sequelize.STRING},
      bank_passbook_url: { type: Sequelize.STRING },
      is_approved: {  
        type: Sequelize.BOOLEAN,
        defaultValue: false },
      organization_name: {
        allowNull: true,
        type: Sequelize.STRING
      },
      is_pos_asigned: {
        type: Sequelize.BOOLEAN,
        defaultValue: false },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active',
        },
      wallet: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      wallet_hold: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      settlement_type: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'today_settlement',
        validate: {
          isIn: {
            args: [['today_settlement', 'next_day_settlement']],
            msg: 'settlement_type must be either "today_settlement" or "next_day_settlement"'
          }
        }
      },
      franchaise_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        // references: {
        //   model: 'Users',
        //   key: 'id'
        // }
      },
      ipay_outlet_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'InstantPay outlet ID assigned to this merchant (PHP: session outlet)'
      },
      createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW
        }
})

module.exports = User;