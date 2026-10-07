'use strict';

/** @type {import('sequelize-cli').Migration} */

const TABLES_WITH_USER_ID = [
  'Tpins',
  'ChargeSlabs',
  'Ledgers',
  'WalletTransactions',
  'UserCommissions',
  'UserPosCharges',
  'UserPayoutCharges',
  'CcBillPayments',
  'SettlementHolds',
  'BillAvenueBillFetches',
  'BillAvenuePayments',
  'ServiceToggleAuditLogs',
  'complaints',
  'Complaints',
  'credit_card_applications',
  'credit_card_audit_logs',
  'payout_beneficiaries',
  'payout_requests',
  'payout_reference_logs',
  'pos_charge_rules',
  'razorpay_notifications',
  'user_service_settings',
  'worldline_notifications',
];


module.exports = {
  async up(queryInterface, Sequelize) {
    for (const tableName of TABLES_WITH_USER_ID) {
      try {
        const tableDesc = await queryInterface.describeTable(tableName);
        if (tableDesc && !tableDesc.company_id) {
          await queryInterface.addColumn(tableName, 'company_id', {
            type: Sequelize.STRING,
            allowNull: true,
            references: {
              model: 'Companies',
              key: 'company_id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
            comment: 'Company / white-label tenant identifier',
          });
          console.log(`[Migration] Added company_id to ${tableName}`);
        }
      } catch (err) {
        // Table may not exist in some environments; skip safely
        console.warn(`[Migration] Skipping ${tableName}: ${err.message}`);
      }
    }
  },

  async down(queryInterface, Sequelize) {
    for (const tableName of TABLES_WITH_USER_ID) {
      try {
        const tableDesc = await queryInterface.describeTable(tableName);
        if (tableDesc && tableDesc.company_id) {
          await queryInterface.removeColumn(tableName, 'company_id');
          console.log(`[Migration] Removed company_id from ${tableName}`);
        }
      } catch (err) {
        // Table may not exist; skip safely
      }
    }
  },
};
