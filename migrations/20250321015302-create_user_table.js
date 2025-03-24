'use strict';
/** @type {import('sequelize-cli').Migration} */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("Users", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      email: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      mobile_number: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      mobile_number_country_code: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      password: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      is_admin: {
        type: Sequelize.BOOLEAN,
      },
      is_franchise: {
        type: Sequelize.BOOLEAN,
      },
      is_merchant: {
        type: Sequelize.BOOLEAN,
      },
      abheepay_id: {
        type: Sequelize.STRING,
      },
      dob: {
        type: Sequelize.DATE,
      },
      gender: {
        type: Sequelize.STRING, // Changed from DATE to STRING
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
      district: {
        type: Sequelize.STRING,
      },
      pincode: {
        type: Sequelize.STRING,
      },
      state: {
        type: Sequelize.STRING,
      },
      country: {
        type: Sequelize.STRING,
      },
      pan_number: {
        type: Sequelize.STRING,
      },
      aadhar_number: {
        type: Sequelize.STRING,
      },
      pan_number_url: {
        type: Sequelize.STRING,
      },
      aadhar_number_url: {
        type: Sequelize.STRING,
      },
      shop_with_photo_url: {
        type: Sequelize.STRING,
      },
      is_approved: {
        type: Sequelize.BOOLEAN,
      },
      is_pos_asigned: {
        type: Sequelize.BOOLEAN,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    // Add unique constraints (optional)
    await queryInterface.addConstraint("Users", {
      fields: ["email"],
      type: "unique",
      name: "unique_email_constraint",
    });

    await queryInterface.addConstraint("Users", {
      fields: ["mobile_number"],
      type: "unique",
      name: "unique_mobile_number_constraint",
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("Users");
  },
};