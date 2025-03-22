'use strict';

/** @type {import('sequelize-cli').Migration} */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Step 1: Add the new columns
    await queryInterface.addColumn("PosMachines", "abheepay_id", {
      type: Sequelize.INTEGER,
      allowNull: true, // Set to `false` if the column should not allow null values
    });

    await queryInterface.addColumn("PosMachines", "assigned_user_id", {
      type: Sequelize.INTEGER,
      allowNull: true, // Set to `false` if the column should not allow null values
    });

    await queryInterface.addColumn("PosMachines", "franchaise_id", {
      type: Sequelize.INTEGER,
      allowNull: true, // Set to `false` if the column should not allow null values
    });

    // Step 2: Add foreign key constraints (optional)
    await queryInterface.addConstraint("PosMachines", {
      fields: ["assigned_user_id"],
      type: "foreign key",
      name: "fk_assigned_user_id",
      references: {
        table: "Users", // Reference the Users table
        field: "id", // Reference the id column in the Users table
      },
      onDelete: "SET NULL", // Set to `CASCADE` if you want to delete related rows
      onUpdate: "CASCADE",
    });

    await queryInterface.addConstraint("PosMachines", {
      fields: ["franchaise_id"],
      type: "foreign key",
      name: "fk_franchaise_id",
      references: {
        table: "Users", // Reference the Users table
        field: "id", // Reference the id column in the Users table
      },
      onDelete: "SET NULL", // Set to `CASCADE` if you want to delete related rows
      onUpdate: "CASCADE",
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Step 1: Remove foreign key constraints (if added)
    await queryInterface.removeConstraint("PosMachines", "fk_assigned_user_id");
    await queryInterface.removeConstraint("PosMachines", "fk_franchaise_id");

    // Step 2: Remove the columns
    await queryInterface.removeColumn("PosMachines", "abheepay_id");
    await queryInterface.removeColumn("PosMachines", "assigned_user_id");
    await queryInterface.removeColumn("PosMachines", "franchaise_id");
  },
};