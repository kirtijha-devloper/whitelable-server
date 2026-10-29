'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('Companies');
    
    if (!tableInfo.domain_name) {
      await queryInterface.addColumn('Companies', 'domain_name', {
        type: Sequelize.STRING,
        allowNull: true,
      });

      // Backfill any existing records with fallback domain based on company_id or id
      await queryInterface.sequelize.query(`
        UPDATE "Companies"
        SET "domain_name" = COALESCE(
          NULLIF(TRIM("domain_name"), ''),
          LOWER(REGEXP_REPLACE(COALESCE("company_id", 'company-' || "id"), '[^a-zA-Z0-9_-]', '-', 'g')) || '.abheepay.com'
        )
        WHERE "domain_name" IS NULL OR TRIM("domain_name") = '';
      `);

      // Add unique constraint / index
      await queryInterface.addIndex('Companies', ['domain_name'], {
        unique: true,
        name: 'companies_domain_name_unique',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('Companies');
    if (tableInfo.domain_name) {
      try {
        await queryInterface.removeIndex('Companies', 'companies_domain_name_unique');
      } catch (_) {}
      await queryInterface.removeColumn('Companies', 'domain_name');
    }
  }
};

