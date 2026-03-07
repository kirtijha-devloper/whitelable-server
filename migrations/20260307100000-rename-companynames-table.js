'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // previous migration created "CompanyNames" (PascalCase);
    // our models expect snake_case "company_names".
    // rename the existing table without touching the old migration.
    await queryInterface.renameTable('CompanyNames', 'company_names');
  },

  async down(queryInterface, Sequelize) {
    // restore original name on rollback so the old migration stays valid
    await queryInterface.renameTable('company_names', 'CompanyNames');
  }
};
