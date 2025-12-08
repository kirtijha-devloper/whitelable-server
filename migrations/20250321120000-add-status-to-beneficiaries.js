'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Create ENUM type first (PostgreSQL requirement)
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_Beneficiaries_status" AS ENUM ('active', 'inactive', 'verified');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add status column with ENUM type
    await queryInterface.addColumn('Beneficiaries', 'status', {
      type: Sequelize.ENUM('active', 'inactive', 'verified'),
      allowNull: false,
      defaultValue: 'active'
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove status column
    await queryInterface.removeColumn('Beneficiaries', 'status');
    
    // Drop the ENUM type
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Beneficiaries_status";');
  }
};

