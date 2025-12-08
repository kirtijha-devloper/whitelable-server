'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Rename existing columns to new schema
    await queryInterface.renameColumn('Beneficiaries', 'mobile', 'mobile_number');
    await queryInterface.renameColumn('Beneficiaries', 'bank_account_number', 'account_number');
    await queryInterface.renameColumn('Beneficiaries', 'bank_account_holder_name', 'beneficiary_name');
    await queryInterface.renameColumn('Beneficiaries', 'bank_ifsc', 'ifsc_code');
    await queryInterface.renameColumn('Beneficiaries', 'user_id', 'merchant_id');

    // Add email if it does not exist (idempotent guard with try/catch)
    try {
      await queryInterface.addColumn('Beneficiaries', 'email', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: ''
      });
    } catch (err) {
      // If column exists, ignore
      if (!err.message.includes('already exists')) {
        throw err;
      }
    }

    // Remove columns not required in the new schema
    const dropCols = [
      'beneficiary_mobile',
      'status',
      'external_reference_id',
      'bank_branch_name',
      'remitter_id'
    ];

    for (const col of dropCols) {
      try {
        await queryInterface.removeColumn('Beneficiaries', col);
      } catch (err) {
        // Ignore if column already removed
        if (!err.message.includes('does not exist')) {
          throw err;
        }
      }
    }
  },

  async down(queryInterface, Sequelize) {
    // Recreate removed columns
    await queryInterface.addColumn('Beneficiaries', 'beneficiary_mobile', {
      type: Sequelize.STRING,
      allowNull: false,
    });
    await queryInterface.addColumn('Beneficiaries', 'status', {
      type: Sequelize.INTEGER,
      defaultValue: 1,
    });
    await queryInterface.addColumn('Beneficiaries', 'external_reference_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('Beneficiaries', 'bank_branch_name', {
      type: Sequelize.STRING,
      allowNull: false,
    });
    await queryInterface.addColumn('Beneficiaries', 'remitter_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    // Rename columns back to original names
    await queryInterface.renameColumn('Beneficiaries', 'mobile_number', 'mobile');
    await queryInterface.renameColumn('Beneficiaries', 'account_number', 'bank_account_number');
    await queryInterface.renameColumn('Beneficiaries', 'beneficiary_name', 'bank_account_holder_name');
    await queryInterface.renameColumn('Beneficiaries', 'ifsc_code', 'bank_ifsc');

    // Remove email if we added it here
    try {
      await queryInterface.removeColumn('Beneficiaries', 'email');
    } catch (err) {
      if (!err.message.includes('does not exist')) {
        throw err;
      }
    }
  }
};

