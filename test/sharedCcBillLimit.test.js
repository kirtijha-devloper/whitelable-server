const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const sinon = require('sinon');

const db = require('../config/database');
const User = require('../models/User');
const Company = require('../models/Company');
const AdminCcBillDailyLimit = require('../models/AdminCcBillDailyLimit');
const CcBillLimitReservation = require('../models/CcBillLimitReservation');
const CcBillPayment = require('../models/CcBillPayment');
const BillAvenuePayment = require('../models/BillAvenuePayment');
const BillAvenueBillFetch = require('../models/BillAvenueBillFetch');
const PayoutTransaction = require('../models/PayoutTransaction');
const PayoutAuditLog = require('../models/PayoutAuditLog');
const Beneficiary = require('../models/Beneficiary');
const PayoutCharge = require('../models/PayoutCharge');
const Ledger = require('../models/Ledger');

const sharedCcBillLimitService = require('../services/sharedCcBillLimitService');
const sharedCcBillLimitRoutes = require('../routes/sharedCcBillLimitRoutes');
const bbpsCCBillRoutes = require('../routes/cc/bbps/bbpsCCBillRoutes');
const billAvenueRoutes = require('../routes/cc/billAvenue/billAvenueRoutes');

const bbpsCCBillService = require('../services/cc/bbps/bbpsCCBillService');
const billAvenueService = require('../services/cc/billAvenue/billAvenueService');
const vimoService = require('../services/vimo.service');
const ledgerService = require('../services/ledgerService');
const serviceSettingsService = require('../services/serviceSettingsService');
const payoutReferenceService = require('../services/payoutReferenceService');

const SECRET = process.env.ACCESS_TOKEN_SECRET || 'testsecret';

describe('Shared Daily CC Bill Limit Across Admin Hierarchy & Payment Flows', () => {
  let app;

  // Hierarchy A (Company Alpha)
  let superAdminUser;
  let adminA;
  let superFranchiseA;
  let franchiseA;
  let merchantA;
  let companyA;

  let superAdminToken;
  let adminAToken;
  let superFranchiseAToken;
  let franchiseAToken;
  let merchantAToken;

  // Hierarchy B (Company Beta - Isolated Admin)
  let adminB;
  let superFranchiseB;
  let franchiseB;
  let merchantB;
  let companyB;

  let adminBToken;
  let superFranchiseBToken;
  let franchiseBToken;
  let merchantBToken;

  before(async () => {
    process.env.ACCESS_TOKEN_SECRET = SECRET;

    // Sync all required tables in SQLite test database
    await User.sync();
    await Company.sync();
    await AdminCcBillDailyLimit.sync();
    await CcBillLimitReservation.sync();
    await CcBillPayment.sync();
    await BillAvenuePayment.sync();
    await BillAvenueBillFetch.sync();
    await PayoutTransaction.sync();
    await Beneficiary.sync();
    await PayoutCharge.sync();
    await Ledger.sync();

    app = express();
    app.use(express.json());
    app.use('/api/shared-cc-bill-limit', sharedCcBillLimitRoutes);
    app.use('/shared-cc-bill-limit', sharedCcBillLimitRoutes);
    app.use('/api/bbps-cc', bbpsCCBillRoutes);
    app.use('/api/bill-avenue', billAvenueRoutes);
  });

  beforeEach(async () => {
    // Clean up test data
    await CcBillLimitReservation.destroy({ where: {}, truncate: true });
    await AdminCcBillDailyLimit.destroy({ where: {}, truncate: true });
    await CcBillPayment.destroy({ where: {}, truncate: true });
    await BillAvenuePayment.destroy({ where: {}, truncate: true });
    await BillAvenueBillFetch.destroy({ where: {}, truncate: true });
    await PayoutTransaction.destroy({ where: {}, truncate: true });
    await Beneficiary.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });
    await Company.destroy({ where: {}, truncate: true });

    // 1. Super Admin
    superAdminUser = await User.create({
      id: 1,
      name: 'Super Admin',
      email: 'superadmin@test.com',
      password: 'hash',
      role: 'super_admin',
      status: 'active',
      wallet: 1000000,
    });
    superAdminToken = jwt.sign({ user: { id: superAdminUser.id, role: 'super_admin' } }, SECRET);

    // 2. Hierarchy A: Super Admin -> Admin A -> Super Franchise A -> Franchise A -> Merchant A
    companyA = await Company.create({
      id: 1,
      company_id: 'COMP_ALPHA',
      company_name: 'Alpha Payments Ltd',
      domain_name: 'alpha.abheepay.com',
      user_id: 2,
      bill_payment_limit: 10000.00,
      payout_limit: 50000.00,
      status: 'active',
    });

    adminA = await User.create({
      id: 2,
      name: 'Admin Alpha',
      email: 'admin.alpha@test.com',
      password: 'hash',
      role: 'admin',
      status: 'active',
      company_id: 'COMP_ALPHA',
      wallet: 500000,
      ipay_outlet_id: 1001,
    });

    superFranchiseA = await User.create({
      id: 10,
      name: 'Super Franchise A',
      email: 'sf.alpha@test.com',
      password: 'hash',
      role: 'super_franchise',
      company_id: 'COMP_ALPHA',
      status: 'active',
      wallet: 200000,
      ipay_outlet_id: 1002,
    });

    franchiseA = await User.create({
      id: 20,
      name: 'Franchise A',
      email: 'f.alpha@test.com',
      password: 'hash',
      role: 'franchaise',
      super_franchise_id: 10,
      company_id: 'COMP_ALPHA',
      status: 'active',
      wallet: 150000,
      ipay_outlet_id: 1003,
    });

    merchantA = await User.create({
      id: 30,
      name: 'Merchant A',
      email: 'm.alpha@test.com',
      password: 'hash',
      role: 'merchant',
      franchaise_id: 20,
      super_franchise_id: 10,
      company_id: 'COMP_ALPHA',
      status: 'active',
      wallet: 100000,
      ipay_outlet_id: 1004,
    });

    adminAToken = jwt.sign({ user: { id: adminA.id, role: 'admin', company_id: 'COMP_ALPHA', ipay_outlet_id: 1001 } }, SECRET);
    superFranchiseAToken = jwt.sign({ user: { id: superFranchiseA.id, role: 'super_franchise', company_id: 'COMP_ALPHA', ipay_outlet_id: 1002 } }, SECRET);
    franchiseAToken = jwt.sign({ user: { id: franchiseA.id, role: 'franchaise', company_id: 'COMP_ALPHA', ipay_outlet_id: 1003 } }, SECRET);
    merchantAToken = jwt.sign({ user: { id: merchantA.id, role: 'merchant', company_id: 'COMP_ALPHA', ipay_outlet_id: 1004 } }, SECRET);

    // 3. Hierarchy B: Super Admin -> Admin B -> Super Franchise B -> Franchise B -> Merchant B
    companyB = await Company.create({
      id: 2,
      company_id: 'COMP_BETA',
      company_name: 'Beta Payments Ltd',
      domain_name: 'beta.abheepay.com',
      user_id: 3,
      bill_payment_limit: 20000.00,
      payout_limit: 50000.00,
      status: 'active',
    });

    adminB = await User.create({
      id: 3,
      name: 'Admin Beta',
      email: 'admin.beta@test.com',
      password: 'hash',
      role: 'admin',
      status: 'active',
      company_id: 'COMP_BETA',
      wallet: 500000,
      ipay_outlet_id: 2001,
    });

    superFranchiseB = await User.create({
      id: 11,
      name: 'Super Franchise B',
      email: 'sf.beta@test.com',
      password: 'hash',
      role: 'super_franchise',
      company_id: 'COMP_BETA',
      status: 'active',
      wallet: 200000,
      ipay_outlet_id: 2002,
    });

    franchiseB = await User.create({
      id: 21,
      name: 'Franchise B',
      email: 'f.beta@test.com',
      password: 'hash',
      role: 'franchaise',
      super_franchise_id: 11,
      company_id: 'COMP_BETA',
      status: 'active',
      wallet: 150000,
      ipay_outlet_id: 2003,
    });

    merchantB = await User.create({
      id: 31,
      name: 'Merchant B',
      email: 'm.beta@test.com',
      password: 'hash',
      role: 'merchant',
      franchaise_id: 21,
      super_franchise_id: 11,
      company_id: 'COMP_BETA',
      status: 'active',
      wallet: 100000,
      ipay_outlet_id: 2004,
    });

    adminBToken = jwt.sign({ user: { id: adminB.id, role: 'admin', company_id: 'COMP_BETA', ipay_outlet_id: 2001 } }, SECRET);
    superFranchiseBToken = jwt.sign({ user: { id: superFranchiseB.id, role: 'super_franchise', company_id: 'COMP_BETA', ipay_outlet_id: 2002 } }, SECRET);
    franchiseBToken = jwt.sign({ user: { id: franchiseB.id, role: 'franchaise', company_id: 'COMP_BETA', ipay_outlet_id: 2003 } }, SECRET);
    merchantBToken = jwt.sign({ user: { id: merchantB.id, role: 'merchant', company_id: 'COMP_BETA', ipay_outlet_id: 2004 } }, SECRET);
  });

  afterEach(() => {
    sinon.restore();
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // Suite 1: Hierarchy Resolution & Multi-Admin Isolation
  // ═════════════════════════════════════════════════════════════════════════════
  describe('1. Hierarchy Resolution & Multi-Admin Isolation', () => {
    it('resolves all eligible users under Admin A (Admin, SF, Franchise, Merchant) to Admin A', async () => {
      const fromAdmin = await sharedCcBillLimitService.resolveOwningAdmin(adminA);
      expect(fromAdmin.adminUser.id).to.equal(adminA.id);

      const fromSf = await sharedCcBillLimitService.resolveOwningAdmin(superFranchiseA);
      expect(fromSf.adminUser.id).to.equal(adminA.id);

      const fromF = await sharedCcBillLimitService.resolveOwningAdmin(franchiseA);
      expect(fromF.adminUser.id).to.equal(adminA.id);

      const fromM = await sharedCcBillLimitService.resolveOwningAdmin(merchantA);
      expect(fromM.adminUser.id).to.equal(adminA.id);
    });

    it('resolves all eligible users under Admin B to Admin B', async () => {
      const fromAdmin = await sharedCcBillLimitService.resolveOwningAdmin(adminB);
      expect(fromAdmin.adminUser.id).to.equal(adminB.id);

      const fromSf = await sharedCcBillLimitService.resolveOwningAdmin(superFranchiseB);
      expect(fromSf.adminUser.id).to.equal(adminB.id);

      const fromF = await sharedCcBillLimitService.resolveOwningAdmin(franchiseB);
      expect(fromF.adminUser.id).to.equal(adminB.id);

      const fromM = await sharedCcBillLimitService.resolveOwningAdmin(merchantB);
      expect(fromM.adminUser.id).to.equal(adminB.id);
    });

    it('traverses upwards via franchaise_id and super_franchise_id if user.company_id is null', async () => {
      const noCompanyMerchant = await User.create({
        id: 99,
        name: 'No Company Merchant',
        email: 'nocompany@test.com',
        password: 'hash',
        role: 'merchant',
        franchaise_id: franchiseA.id,
        super_franchise_id: superFranchiseA.id,
        company_id: null,
        status: 'active',
      });

      const res = await sharedCcBillLimitService.resolveOwningAdmin(noCompanyMerchant);
      expect(res.adminUser.id).to.equal(adminA.id);
    });

    it('fails safely when user has no company mapping or hierarchy upwards', async () => {
      const orphanUser = await User.create({
        id: 999,
        name: 'Orphan User',
        email: 'orphan@test.com',
        password: 'hash',
        role: 'merchant',
        company_id: null,
        franchaise_id: null,
        super_franchise_id: null,
        status: 'active',
      });

      let caughtErr = null;
      try {
        await sharedCcBillLimitService.resolveOwningAdmin(orphanUser);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).to.not.be.null;
      expect(caughtErr.message).to.include('missing company identifier');
    });

    it('fails safely when user account is inactive', async () => {
      const inactiveUser = await User.create({
        id: 998,
        name: 'Inactive User',
        email: 'inactive@test.com',
        password: 'hash',
        role: 'merchant',
        company_id: 'COMP_ALPHA',
        status: 'inactive',
      });

      let caughtErr = null;
      try {
        await sharedCcBillLimitService.resolveOwningAdmin(inactiveUser);
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).to.not.be.null;
      expect(caughtErr.message).to.include('User account is inactive');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // Suite 2: Core Shared Limit Specification (Admin ₹1k + SF ₹2k + F ₹2k + M ₹3k)
  // ═════════════════════════════════════════════════════════════════════════════
  describe('2. Core Shared Limit Specification', () => {
    it('enforces shared consumption across all 4 tiers and rejects subsequent overlimit payment', async () => {
      // Step 1: Super Admin assigns Admin A daily limit of ₹10,000
      const putRes = await request(app)
        .put('/api/shared-cc-bill-limit')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ admin_id: adminA.id, daily_limit: 10000 });
      expect(putRes.status).to.equal(200);
      expect(putRes.body.data.daily_limit).to.equal(10000);
      expect(putRes.body.data.remaining_amount).to.equal(10000);

      // Super Admin assigns Admin B daily limit of ₹20,000
      await request(app)
        .put('/api/shared-cc-bill-limit')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ admin_id: adminB.id, daily_limit: 20000 });

      // Step 2: Payment 1 - Admin A pays ₹1,000
      await sharedCcBillLimitService.reserveLimit({
        userId: adminA.id,
        amount: 1000,
        flow: 'bbps_cc',
        referenceId: 'SPEC_TXN_ADMIN',
      });
      await sharedCcBillLimitService.commitReservation({
        flow: 'bbps_cc',
        referenceId: 'SPEC_TXN_ADMIN',
      });

      let statusA = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(statusA.consumed_amount).to.equal(1000);
      expect(statusA.remaining_amount).to.equal(9000);

      // Step 3: Payment 2 - Super Franchise A pays ₹2,000
      await sharedCcBillLimitService.reserveLimit({
        userId: superFranchiseA.id,
        amount: 2000,
        flow: 'ba_cc',
        referenceId: 'SPEC_TXN_SF',
      });
      await sharedCcBillLimitService.commitReservation({
        flow: 'ba_cc',
        referenceId: 'SPEC_TXN_SF',
      });

      statusA = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(statusA.consumed_amount).to.equal(3000);
      expect(statusA.remaining_amount).to.equal(7000);

      // Step 4: Payment 3 - Franchise A pays ₹2,000
      await sharedCcBillLimitService.reserveLimit({
        userId: franchiseA.id,
        amount: 2000,
        flow: 'cc_bill_3',
        referenceId: 'SPEC_TXN_FRANCHISE',
      });
      await sharedCcBillLimitService.commitReservation({
        flow: 'cc_bill_3',
        referenceId: 'SPEC_TXN_FRANCHISE',
      });

      statusA = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(statusA.consumed_amount).to.equal(5000);
      expect(statusA.remaining_amount).to.equal(5000);

      // Step 5: Payment 4 - Merchant A pays ₹3,000
      await sharedCcBillLimitService.reserveLimit({
        userId: merchantA.id,
        amount: 3000,
        flow: 'bbps_cc',
        referenceId: 'SPEC_TXN_MERCHANT',
      });
      await sharedCcBillLimitService.commitReservation({
        flow: 'bbps_cc',
        referenceId: 'SPEC_TXN_MERCHANT',
      });

      // Total consumed under Admin A must be ₹8,000, remaining ₹2,000
      statusA = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(statusA.daily_limit).to.equal(10000);
      expect(statusA.consumed_amount).to.equal(8000);
      expect(statusA.reserved_amount).to.equal(0);
      expect(statusA.remaining_amount).to.equal(2000);

      // Step 6: Simulate another payment of ₹2,500 from any eligible user under Admin A
      let rejectedError = null;
      try {
        await sharedCcBillLimitService.reserveLimit({
          userId: merchantA.id,
          amount: 2500,
          flow: 'cc_bill_3',
          referenceId: 'SPEC_TXN_OVERLIMIT',
        });
      } catch (err) {
        rejectedError = err;
      }

      // Expected result: rejected because only ₹2,000 remains
      expect(rejectedError).to.not.be.null;
      expect(rejectedError.code).to.equal('CC_BILL_DAILY_LIMIT_EXCEEDED');
      expect(rejectedError.data.available_amount).to.equal(2000);
      expect(rejectedError.data.requested_amount).to.equal(2500);

      // Step 7: Verify Admin B is completely isolated
      // Merchant B under Admin B makes a ₹5,000 payment -> must succeed!
      await sharedCcBillLimitService.reserveLimit({
        userId: merchantB.id,
        amount: 5000,
        flow: 'ba_cc',
        referenceId: 'SPEC_TXN_ADMIN_B',
      });
      await sharedCcBillLimitService.commitReservation({
        flow: 'ba_cc',
        referenceId: 'SPEC_TXN_ADMIN_B',
      });

      const statusB = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminB.id });
      expect(statusB.daily_limit).to.equal(20000);
      expect(statusB.consumed_amount).to.equal(5000);
      expect(statusB.remaining_amount).to.equal(15000);

      // Admin A limit remains unaffected at ₹2,000 remaining
      const statusACheck = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(statusACheck.consumed_amount).to.equal(8000);
      expect(statusACheck.remaining_amount).to.equal(2000);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // Suite 3: Cross-Flow Payment Lifecycle, Concurrency & Idempotency
  // ═════════════════════════════════════════════════════════════════════════════
  describe('3. Cross-Flow Payment Lifecycle & Concurrency', () => {
    it('cross-flow consumption: CC Bill Pay, BA CC Bill Pay, and CC Bill 3 share the same limit', async () => {
      // 1. CC Bill Pay consumes ₹3,000
      await sharedCcBillLimitService.reserveLimit({
        userId: merchantA.id,
        amount: 3000,
        flow: 'bbps_cc',
        referenceId: 'FLOW_BBPS_1',
      });
      await sharedCcBillLimitService.commitReservation({ flow: 'bbps_cc', referenceId: 'FLOW_BBPS_1' });

      // 2. BA CC Bill Pay consumes ₹2,000
      await sharedCcBillLimitService.reserveLimit({
        userId: franchiseA.id,
        amount: 2000,
        flow: 'ba_cc',
        referenceId: 'FLOW_BACC_1',
      });
      await sharedCcBillLimitService.commitReservation({ flow: 'ba_cc', referenceId: 'FLOW_BACC_1' });

      // 3. CC Bill 3 consumes ₹3,000
      await sharedCcBillLimitService.reserveLimit({
        userId: superFranchiseA.id,
        amount: 3000,
        flow: 'cc_bill_3',
        referenceId: 'FLOW_CC3_1',
      });
      await sharedCcBillLimitService.commitReservation({ flow: 'cc_bill_3', referenceId: 'FLOW_CC3_1' });

      const status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.consumed_amount).to.equal(8000);
      expect(status.remaining_amount).to.equal(2000);

      // Attempt ₹3,000 via CC Bill 3 -> rejected
      let overlimit = false;
      try {
        await sharedCcBillLimitService.reserveLimit({
          userId: merchantA.id,
          amount: 3000,
          flow: 'cc_bill_3',
          referenceId: 'FLOW_CC3_REJECT',
        });
      } catch (err) {
        if (err.code === 'CC_BILL_DAILY_LIMIT_EXCEEDED') overlimit = true;
      }
      expect(overlimit).to.be.true;
    });

    it('concurrent reservations safely serialize and prevent overspending', async () => {
      // Current limit is ₹10,000. Initiate 4 concurrent reservations of ₹3,000 each (total ₹12,000).
      // Exactly 3 must succeed (total ₹9,000) and 1 must fail.
      const promises = [1, 2, 3, 4].map((i) =>
        sharedCcBillLimitService.reserveLimit({
          userId: merchantA.id,
          amount: 3000,
          flow: 'bbps_cc',
          referenceId: `CONCUR_${i}`,
        }).then(() => ({ success: true, id: i }))
          .catch((err) => ({ success: false, id: i, error: err.code }))
      );

      const results = await Promise.all(promises);
      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      expect(succeeded.length).to.equal(3);
      expect(failed.length).to.equal(1);
      expect(failed[0].error).to.equal('CC_BILL_DAILY_LIMIT_EXCEEDED');

      const status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.reserved_amount).to.equal(9000);
      expect(status.remaining_amount).to.equal(1000);
    });

    it('duplicate reservations and callbacks are idempotent and do not double count', async () => {
      const r1 = await sharedCcBillLimitService.reserveLimit({
        userId: merchantA.id,
        amount: 2000,
        flow: 'ba_cc',
        referenceId: 'DUP_REF_1',
      });
      expect(r1.alreadyReserved).to.be.false;

      const r2 = await sharedCcBillLimitService.reserveLimit({
        userId: merchantA.id,
        amount: 2000,
        flow: 'ba_cc',
        referenceId: 'DUP_REF_1',
      });
      expect(r2.alreadyReserved).to.be.true;

      let status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.reserved_amount).to.equal(2000);

      // Duplicate commits
      await sharedCcBillLimitService.commitReservation({ flow: 'ba_cc', referenceId: 'DUP_REF_1' });
      await sharedCcBillLimitService.commitReservation({ flow: 'ba_cc', referenceId: 'DUP_REF_1' });

      status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.consumed_amount).to.equal(2000);
      expect(status.reserved_amount).to.equal(0);
    });

    it('pending / unknown transactions retain reservations to protect available limit', async () => {
      await sharedCcBillLimitService.reserveLimit({
        userId: merchantA.id,
        amount: 4000,
        flow: 'cc_bill_3',
        referenceId: 'PEND_REF_1',
      });

      // Status remains reserved
      let status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.reserved_amount).to.equal(4000);
      expect(status.remaining_amount).to.equal(6000);

      // Attempt payment of ₹7,000 -> rejected
      let rejected = false;
      try {
        await sharedCcBillLimitService.reserveLimit({
          userId: franchiseA.id,
          amount: 7000,
          flow: 'bbps_cc',
          referenceId: 'BLOCKED_BY_PENDING',
        });
      } catch (err) {
        if (err.code === 'CC_BILL_DAILY_LIMIT_EXCEEDED') rejected = true;
      }
      expect(rejected).to.be.true;
    });

    it('definitive provider failure releases reservation and restores capacity', async () => {
      await sharedCcBillLimitService.reserveLimit({
        userId: merchantA.id,
        amount: 4000,
        flow: 'ba_cc',
        referenceId: 'FAIL_REF_1',
      });

      let status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.reserved_amount).to.equal(4000);
      expect(status.remaining_amount).to.equal(6000);

      await sharedCcBillLimitService.releaseReservation({ flow: 'ba_cc', referenceId: 'FAIL_REF_1' });

      status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.reserved_amount).to.equal(0);
      expect(status.remaining_amount).to.equal(10000);
    });

    it('refunding a consumed transaction restores consumed capacity to available pool', async () => {
      await sharedCcBillLimitService.reserveLimit({
        userId: merchantA.id,
        amount: 3000,
        flow: 'bbps_cc',
        referenceId: 'REFUND_REF_1',
      });
      await sharedCcBillLimitService.commitReservation({ flow: 'bbps_cc', referenceId: 'REFUND_REF_1' });

      let status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.consumed_amount).to.equal(3000);
      expect(status.remaining_amount).to.equal(7000);

      await sharedCcBillLimitService.releaseReservation({ flow: 'bbps_cc', referenceId: 'REFUND_REF_1' });

      status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.consumed_amount).to.equal(0);
      expect(status.remaining_amount).to.equal(10000);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // Suite 4: Controller-Level HTTP Integration for All 3 Payment Flows
  // ═════════════════════════════════════════════════════════════════════════════
  describe('4. Controller-Level HTTP Integration (BBPS CC, BillAvenue, CC Bill 3)', () => {
    beforeEach(() => {
      // Stub ledger balance checks to always succeed
      sinon.stub(ledgerService, 'getAvailableBalance').resolves(500000);
      sinon.stub(ledgerService, 'createLedgerEntry').resolves({
        id: 99,
        save: sinon.stub().resolvesThis(),
        update: sinon.stub().resolvesThis(),
      });
      sinon.stub(ledgerService, 'createPayoutEntry').resolves({ id: 99 });

      // Stub service toggles to always allow CC bill operations
      sinon.stub(serviceSettingsService, 'assertServiceEnabledOrRespond').resolves(true);

      // Stub PayoutAuditLog.create for SQLite compatibility
      sinon.stub(PayoutAuditLog, 'create').resolves({ id: 1 });
    });

    it('Flow 1: POST /api/bbps-cc/pay (CC Bill Pay) enforces and consumes shared limit', async () => {
      sinon.stub(bbpsCCBillService, 'payCCBill').resolves({
        externalRef: 'MOCK_BBPS_REF_1',
        data: { statuscode: 'TXN', status: 'SUCCESS' },
      });

      const res = await request(app)
        .post('/api/bbps-cc/pay')
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({
          billerId: 'CC_BILLER_TEST',
          param1: '4111111111111111',
          transactionAmount: 1500,
          customerMobile: '9876543210',
        });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;

      const status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.consumed_amount).to.equal(1500);
      expect(status.remaining_amount).to.equal(8500);
    });

    it('Flow 2: POST /api/bill-avenue/pay (BA CC Bill Pay) enforces and consumes shared limit', async () => {
      sinon.stub(billAvenueService, 'payBill').resolves({
        billPaymentResponse: {
          responseCode: '000',
          txnRefId: 'BA_MOCK_TXN_1',
          status: 'SUCCESS',
        },
      });

      const res = await request(app)
        .post('/api/bill-avenue/pay')
        .set('Authorization', `Bearer ${franchiseAToken}`)
        .send({
          billerId: 'BA_BILLER_TEST',
          customerParams: { accountNo: '4111111111111111' },
          amount: 2500,
          paymentMode: 'Cash',
        });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;

      const status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.consumed_amount).to.equal(2500);
      expect(status.remaining_amount).to.equal(7500);
    });

    it('Flow 3: POST /api/bill-avenue/cc-bill-3/pay (CC Bill 3) enforces and reserves shared limit', async () => {
      sinon.stub(vimoService, 'resolveBankCode').resolves('HDFC');
      sinon.stub(payoutReferenceService, 'getNextPayoutReference').resolves('VIMO_REF_CC3_1');
      sinon.stub(vimoService, 'createPayout').resolves({
        responseCode: '00',
        message: 'Payout initiated successfully',
        data: { txnId: 'VIMO_TXN_1', status: 'PROCESSING' },
      });

      const res = await request(app)
        .post('/api/bill-avenue/cc-bill-3/pay')
        .set('Authorization', `Bearer ${superFranchiseAToken}`)
        .send({
          billerId: 'HDFC_CC',
          customerParams: { card: '4111111111111111' },
          amount: 3000,
          bankName: 'HDFC Bank',
          beneficiaryAccountNumber: '4111111111111111',
          beneficiaryLocation: 'MH',
          lat: 19.0760,
          long: 72.8777,
        });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;

      const status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.reserved_amount).to.equal(3000);
      expect(status.remaining_amount).to.equal(7000);
    });

    it('Controller rejects payment with HTTP 400 & CC_BILL_DAILY_LIMIT_EXCEEDED when limit is exceeded', async () => {
      // First, consume ₹8,000 of the ₹10,000 limit
      await sharedCcBillLimitService.reserveLimit({
        userId: adminA.id,
        amount: 8000,
        flow: 'bbps_cc',
        referenceId: 'PRE_EXCEED_1',
      });
      await sharedCcBillLimitService.commitReservation({ flow: 'bbps_cc', referenceId: 'PRE_EXCEED_1' });

      // Now send a payment request for ₹3,000 via CC Bill Pay controller (only ₹2,000 remains)
      const res = await request(app)
        .post('/api/bbps-cc/pay')
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({
          billerId: 'CC_BILLER_TEST',
          param1: '4111111111111111',
          transactionAmount: 3000,
          customerMobile: '9876543210',
        });

      expect(res.status).to.equal(400);
      expect(res.body.success).to.be.false;
      expect(res.body.code).to.equal('CC_BILL_DAILY_LIMIT_EXCEEDED');
      expect(res.body.data.available_amount).to.equal(2000);
      expect(res.body.data.requested_amount).to.equal(3000);

      // Verify that no reservation was left behind
      const status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.consumed_amount).to.equal(8000);
      expect(status.reserved_amount).to.equal(0);
      expect(status.remaining_amount).to.equal(2000);
    });

    it('Controller releases reservation when provider returns definitive failure', async () => {
      // Mock provider definitive failure (statuscode: 'FAILED')
      sinon.stub(bbpsCCBillService, 'payCCBill').resolves({
        externalRef: 'MOCK_FAIL_REF',
        data: { statuscode: 'FAILED', status: 'FAILED' },
      });

      const res = await request(app)
        .post('/api/bbps-cc/pay')
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({
          billerId: 'CC_BILLER_TEST',
          param1: '4111111111111111',
          transactionAmount: 2000,
          customerMobile: '9876543210',
        });

      expect(res.status).to.equal(200); // Controller returns 200 with success: false for provider decline
      expect(res.body.success).to.be.false;

      // Reservation should have been released
      const status = await sharedCcBillLimitService.getAdminLimitStatus({ adminId: adminA.id });
      expect(status.reserved_amount).to.equal(0);
      expect(status.consumed_amount).to.equal(0);
      expect(status.remaining_amount).to.equal(10000);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // Suite 5: Authorization & Security Guardrails
  // ═════════════════════════════════════════════════════════════════════════════
  describe('5. Authorization & Security Guardrails', () => {
    it('Super Admin can configure Admin daily CC bill limit', async () => {
      const res = await request(app)
        .put('/api/shared-cc-bill-limit')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          admin_id: adminA.id,
          daily_limit: 25000,
        });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.data.daily_limit).to.equal(25000);
      expect(res.body.data.remaining_amount).to.equal(25000);
    });

    it('Admin, Super Franchise, Franchise, and Merchant cannot modify company limit (HTTP 403)', async () => {
      // Admin
      const resAdmin = await request(app)
        .put('/api/shared-cc-bill-limit')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ daily_limit: 50000 });
      expect(resAdmin.status).to.equal(403);
      expect(resAdmin.body.success).to.be.false;

      // Super Franchise
      const resSf = await request(app)
        .put('/api/shared-cc-bill-limit')
        .set('Authorization', `Bearer ${superFranchiseAToken}`)
        .send({ daily_limit: 50000 });
      expect(resSf.status).to.equal(403);
      expect(resSf.body.success).to.be.false;

      // Franchise
      const resF = await request(app)
        .put('/api/shared-cc-bill-limit')
        .set('Authorization', `Bearer ${franchiseAToken}`)
        .send({ daily_limit: 50000 });
      expect(resF.status).to.equal(403);
      expect(resF.body.success).to.be.false;

      // Merchant
      const resM = await request(app)
        .put('/api/shared-cc-bill-limit')
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({ daily_limit: 50000 });
      expect(resM.status).to.equal(403);
      expect(resM.body.success).to.be.false;
    });

    it('Non-super-admin user cannot supply another Admin ID to inspect or spend that Admin limit', async () => {
      // Merchant A attempts to inspect Admin B's limit by passing ?admin_id=3
      const res = await request(app)
        .get('/api/shared-cc-bill-limit?admin_id=3')
        .set('Authorization', `Bearer ${merchantAToken}`);

      expect(res.status).to.equal(200);
      // The server ignores ?admin_id=3 and strictly resolves Merchant A's actual owning admin (Admin A = id 2)
      expect(res.body.data.admin_id).to.equal(adminA.id);
    });
  });
});
