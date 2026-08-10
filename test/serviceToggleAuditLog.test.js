const { expect } = require('chai');
const db = require('../config/database');
const User = require('../models/User');
const ServiceToggleAuditLog = require('../models/ServiceToggleAuditLog');
const UserServiceSetting = require('../models/UserServiceSetting');
const {
  upsertUserServiceSettings,
  upsertServiceSettings,
  getServiceToggleAuditLogs,
} = require('../services/serviceSettingsService');

describe('ServiceToggleAuditLog Integration & Transaction Tests', () => {
  let adminUser;
  let merchantUser;

  before(async () => {
    // Ensure associations are loaded
    require('../models/initAssociations');
    const ServiceSetting = require('../models/ServiceSetting');
    const Ledger = require('../models/Ledger');
    await User.sync();
    await UserServiceSetting.sync();
    await ServiceSetting.sync();
    await ServiceToggleAuditLog.sync();
    await Ledger.sync();

    // Create test admin user
    [adminUser] = await User.findOrCreate({
      where: { username: 'TEST_ADMIN_AUDIT' },
      defaults: {
        name: 'Test Admin Audit',
        username: 'TEST_ADMIN_AUDIT',
        email: 'test_admin_audit@example.com',
        password: '$2b$10$abcdefghijklmnopqrstuuv',
        role: 'admin',
        status: 'active',
      },
    });

    // Create test merchant user
    [merchantUser] = await User.findOrCreate({
      where: { username: 'TEST_MERCHANT_AUDIT' },
      defaults: {
        name: 'Test Merchant Audit',
        username: 'TEST_MERCHANT_AUDIT',
        email: 'test_merchant_audit@example.com',
        password: '$2b$10$abcdefghijklmnopqrstuuv',
        role: 'merchant',
        status: 'active',
        is_payout_enabled: true,
      },
    });
  });

  after(async () => {
    // Cleanup audit logs created during test
    if (adminUser && merchantUser) {
      await ServiceToggleAuditLog.destroy({
        where: {
          user_id: adminUser.id,
        },
      });
      await UserServiceSetting.destroy({
        where: {
          user_id: merchantUser.id,
        },
      });
    }
  });

  it('should transactionally create ServiceToggleAuditLog entry when disabling a user service', async () => {
    const transaction = await db.transaction();

    try {
      const result = await upsertUserServiceSettings(
        merchantUser,
        { vimo_payout: false },
        adminUser.id,
        {
          transaction,
          ip_address: '127.0.0.1',
          user_agent: 'MochaTestRunner/1.0',
        }
      );

      expect(result.userServiceSettings.vimo_payout).to.equal(false);

      const auditLogs = await ServiceToggleAuditLog.findAll({
        where: {
          user_id: adminUser.id,
          affected_user_id: merchantUser.id,
          service_key: 'vimo_payout',
        },
        transaction,
      });

      expect(auditLogs.length).to.be.at.least(1);
      const latestLog = auditLogs[auditLogs.length - 1];
      expect(latestLog.previous_state).to.equal(true);
      expect(latestLog.new_state).to.equal(false);
      expect(latestLog.action).to.equal('DISABLE');
      expect(latestLog.ip_address).to.equal('127.0.0.1');

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  });

  it('should transactionally create ServiceToggleAuditLog entry when enabling a user service', async () => {
    const transaction = await db.transaction();

    try {
      const result = await upsertUserServiceSettings(
        merchantUser,
        { vimo_payout: true },
        adminUser.id,
        {
          transaction,
          ip_address: '10.0.0.1',
          user_agent: 'MochaTestRunner/1.0',
        }
      );

      expect(result.userServiceSettings.vimo_payout).to.equal(true);

      const auditLogs = await ServiceToggleAuditLog.findAll({
        where: {
          user_id: adminUser.id,
          affected_user_id: merchantUser.id,
          service_key: 'vimo_payout',
        },
        transaction,
      });

      expect(auditLogs.length).to.be.at.least(2);
      const latestLog = auditLogs[auditLogs.length - 1];
      expect(latestLog.previous_state).to.equal(false);
      expect(latestLog.new_state).to.equal(true);
      expect(latestLog.action).to.equal('ENABLE');
      expect(latestLog.ip_address).to.equal('10.0.0.1');

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  });

  it('should rollback both service setting and audit log if transaction is rolled back', async () => {
    const transaction = await db.transaction();

    await upsertUserServiceSettings(
      merchantUser,
      { sevenpay_payout: false },
      adminUser.id,
      {
        transaction,
        ip_address: '192.168.1.1',
        user_agent: 'MochaRollbackTest/1.0',
      }
    );

    // Rollback explicitly
    await transaction.rollback();

    // Check outside transaction: no audit log entry should exist with IP '192.168.1.1'
    const auditLogs = await ServiceToggleAuditLog.findAll({
      where: {
        ip_address: '192.168.1.1',
      },
    });

    expect(auditLogs.length).to.equal(0);
  });

  it('should fetch audit logs with performingUser and affectedUser included via getServiceToggleAuditLogs', async () => {
    const logsResult = await getServiceToggleAuditLogs({
      userId: adminUser.id,
      affectedUserId: merchantUser.id,
      page: 1,
      limit: 10,
    });

    expect(logsResult.data).to.be.an('array');
    expect(logsResult.count).to.be.at.least(2);
    expect(logsResult.data[0].performingUser).to.exist;
    expect(logsResult.data[0].performingUser.id).to.equal(adminUser.id);
    expect(logsResult.data[0].affectedUser).to.exist;
    expect(logsResult.data[0].affectedUser.id).to.equal(merchantUser.id);
  });

  it('should filter audit logs by search query matching target user name or abheepay_id', async () => {
    const logsResult = await getServiceToggleAuditLogs({
      search: 'Test Merchant Audit',
      page: 1,
      limit: 10,
    });

    expect(logsResult.data).to.be.an('array');
    expect(logsResult.count).to.be.at.least(1);
    expect(logsResult.data[0].affectedUser.name).to.equal('Test Merchant Audit');

    const emptyResult = await getServiceToggleAuditLogs({
      search: 'NON_EXISTENT_USER_XYZ_123',
      page: 1,
      limit: 10,
    });

    expect(emptyResult.data).to.be.an('array');
    expect(emptyResult.count).to.equal(0);
  });

  it('should record audit log when admin credits or debits user wallet', async () => {
    const { adminDirectCredit, adminDirectDebit } = require('../controllers/adminWalletController');
    const reqCredit = {
      user: { id: adminUser.id, role: 'admin', name: 'Admin Test' },
      body: { user_id: merchantUser.id, amount: 250.50, reason: 'Test Credit Audit' },
      ip: '127.0.0.1',
      headers: {},
    };
    let jsonCredit = null;
    const resCredit = {
      status: (code) => ({
        json: (data) => {
          jsonCredit = data;
          return data;
        },
      }),
    };

    await adminDirectCredit(reqCredit, resCredit);
    expect(jsonCredit.success).to.equal(true);

    const creditLog = await ServiceToggleAuditLog.findOne({
      where: {
        user_id: adminUser.id,
        affected_user_id: merchantUser.id,
        service_key: 'admin_credit',
      },
      order: [['createdAt', 'DESC']],
    });

    expect(creditLog).to.exist;
    expect(creditLog.action).to.equal('CREDIT');
    expect(parseFloat(creditLog.balance_after)).to.equal(250.50);

    const reqDebit = {
      user: { id: adminUser.id, role: 'admin', name: 'Admin Test' },
      body: { user_id: merchantUser.id, amount: 50.00, reason: 'Test Debit Audit' },
      ip: '127.0.0.1',
      headers: {},
    };
    let jsonDebit = null;
    const resDebit = {
      status: (code) => ({
        json: (data) => {
          jsonDebit = data;
          return data;
        },
      }),
    };

    await adminDirectDebit(reqDebit, resDebit);
    expect(jsonDebit.success).to.equal(true);

    const debitLog = await ServiceToggleAuditLog.findOne({
      where: {
        user_id: adminUser.id,
        affected_user_id: merchantUser.id,
        service_key: 'admin_debit',
      },
      order: [['createdAt', 'DESC']],
    });

    expect(debitLog).to.exist;
    expect(debitLog.action).to.equal('DEBIT');
    expect(parseFloat(debitLog.balance_after)).to.equal(200.50);
  });

  it('should filter audit logs by startDate and endDate', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const logsResult = await getServiceToggleAuditLogs({
      startDate: todayStr,
      endDate: todayStr,
      page: 1,
      limit: 10,
    });

    expect(logsResult.data).to.be.an('array');
    expect(logsResult.count).to.be.at.least(1);
  });

  it('should record audit log when settlement type is updated for a user', async () => {
    const { setUserSettlementType } = require('../controllers/adminController');
    const req = {
      user: { id: adminUser.id, role: 'admin', name: 'Admin Test' },
      params: { id: merchantUser.id },
      body: { settlement_type: 'next_day_settlement' },
      ip: '127.0.0.1',
      headers: {},
    };
    let jsonResult = null;
    const res = {
      status: (code) => ({
        json: (data) => {
          jsonResult = data;
          return data;
        },
      }),
    };

    await setUserSettlementType(req, res);
    expect(jsonResult.success).to.equal(true);

    const settlementLog = await ServiceToggleAuditLog.findOne({
      where: {
        user_id: adminUser.id,
        affected_user_id: merchantUser.id,
        service_key: 'settlement_type',
      },
      order: [['createdAt', 'DESC']],
    });

    expect(settlementLog).to.exist;
    expect(settlementLog.action).to.equal('T+1');
    expect(settlementLog.new_state).to.equal(false);
  });
});
