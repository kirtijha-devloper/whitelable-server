const { expect } = require('chai');
const sinon = require('sinon');
const {
  normalizeSettlementType,
  resolveEffectiveSettlement,
  evaluateDynamicSettlement,
  validateMerchantT0Limit,
} = require('../services/settlementService');
const RazorpayNotification = require('../models/RazorpayNotification');
const User = require('../models/User');
const serviceSettingsService = require('../services/serviceSettingsService');

describe('Settlement Service Unit Tests', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('normalizeSettlementType', () => {
    it('should normalize T0 and today_settlement to T0', () => {
      expect(normalizeSettlementType('T0')).to.equal('T0');
      expect(normalizeSettlementType('today_settlement')).to.equal('T0');
      expect(normalizeSettlementType('TODAY_SETTLEMENT')).to.equal('T0');
      expect(normalizeSettlementType('')).to.equal('T0');
      expect(normalizeSettlementType(null)).to.equal('T0');
    });

    it('should normalize T1 and next_day_settlement to T1', () => {
      expect(normalizeSettlementType('T1')).to.equal('T1');
      expect(normalizeSettlementType('next_day_settlement')).to.equal('T1');
      expect(normalizeSettlementType('NEXT_DAY_SETTLEMENT')).to.equal('T1');
    });
  });

  describe('resolveEffectiveSettlement', () => {
    it('should return T1 when user settlement_type is T1', async () => {
      const user = { id: 101, settlement_type: 'T1', t0_daily_limit: 50000 };
      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 1000 });
      expect(res.effectiveSettlement).to.equal('T1');
      expect(res.isLimitExceeded).to.be.false;
    });

    it('should return T1 when user is T0 and t0_daily_limit is NULL or 0 (Unassigned/Zero Limit)', async () => {
      const user = { id: 102, role: 'merchant', settlement_type: 'T0', t0_daily_limit: null };
      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 1000 });
      expect(res.effectiveSettlement).to.equal('T1');
      expect(res.isLimitExceeded).to.be.true;
      expect(res.t0Limit).to.equal(0);
    });

    it('should return T0 when projected total is within t0_daily_limit', async () => {
      const user = { id: 103, role: 'merchant', settlement_type: 'T0', t0_daily_limit: 50000 };
      sandbox.stub(RazorpayNotification, 'sum').resolves(20000);

      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 10000 });
      expect(res.effectiveSettlement).to.equal('T0');
      expect(res.isLimitExceeded).to.be.false;
      expect(res.todayT0Total).to.equal(20000);
      expect(res.projectedTotal).to.equal(30000);
      expect(res.t0Limit).to.equal(50000);
    });

    it('should auto-shift to T1 when projected total exceeds t0_daily_limit', async () => {
      const user = { id: 104, role: 'merchant', settlement_type: 'T0', t0_daily_limit: 50000 };
      sandbox.stub(RazorpayNotification, 'sum').resolves(45000);

      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 10000 });
      expect(res.effectiveSettlement).to.equal('T1');
      expect(res.isLimitExceeded).to.be.true;
      expect(res.todayT0Total).to.equal(45000);
      expect(res.projectedTotal).to.equal(55000);
      expect(res.t0Limit).to.equal(50000);
      expect(res.note).to.include('T0 Limit exceeded');
    });

    it('should calculate franchise effective self-limit as total pool minus allocated to merchants (Pool: 100, Allocated: 50 => Franchise Limit: 50)', async () => {
      const franchiseUser = { id: 201, role: 'franchaise', settlement_type: 'T0', t0_daily_limit: 100 };
      sandbox.stub(User, 'findAll').resolves([{ t0_daily_limit: 50 }]);
      sandbox.stub(RazorpayNotification, 'sum').resolves(0);

      // Remaining self limit is 100 - 50 = 50. Transaction of 40 <= 50 => T0
      const res1 = await resolveEffectiveSettlement({ user: franchiseUser, incomingTxnAmount: 40 });
      expect(res1.effectiveSettlement).to.equal('T0');
      expect(res1.t0Limit).to.equal(50);

      // Transaction of 60 > 50 => T1
      const res2 = await resolveEffectiveSettlement({ user: franchiseUser, incomingTxnAmount: 60 });
      expect(res2.effectiveSettlement).to.equal('T1');
      expect(res2.isLimitExceeded).to.be.true;
    });
  });

  describe('evaluateDynamicSettlement', () => {
    it('should honor static DB mode when global switch is OFF', async () => {
      sandbox.stub(serviceSettingsService, 'getServiceFlagValue').resolves(false);
      const user = { id: 101, settlement_type: 'T0', t0_daily_limit: 5000 };

      const res = await evaluateDynamicSettlement({ user, transactionAmount: 1000 });
      expect(res.settlementType).to.equal('T0');
      expect(res.isGlobalT0Enabled).to.be.false;
      expect(res.reason).to.include('Global T0 switch OFF');
    });

    it('should return dynamic T1 when T0 limit is unassigned or 0 with global switch ON', async () => {
      sandbox.stub(serviceSettingsService, 'getServiceFlagValue').resolves(true);
      const userUnassigned = { id: 102, settlement_type: 'T0', t0_daily_limit: null };

      const res = await evaluateDynamicSettlement({ user: userUnassigned, transactionAmount: 1000 });
      expect(res.settlementType).to.equal('T1');
      expect(res.isGlobalT0Enabled).to.be.true;
      expect(res.reason).to.include('T0 Limit Unassigned');
    });

    it('should return dynamic T0 when limit is unlimited', async () => {
      sandbox.stub(serviceSettingsService, 'getServiceFlagValue').resolves(true);
      const userUnlimited = { id: 103, settlement_type: 'T0', t0_daily_limit: 'unlimited' };

      const res = await evaluateDynamicSettlement({ user: userUnlimited, transactionAmount: 50000 });
      expect(res.settlementType).to.equal('T0');
      expect(res.isGlobalT0Enabled).to.be.true;
    });

    it('should return T0 when within limit and T1 when limit exceeded', async () => {
      sandbox.stub(serviceSettingsService, 'getServiceFlagValue').resolves(true);
      const user = { id: 104, settlement_type: 'T0', t0_daily_limit: 10000 };

      const resWithin = await evaluateDynamicSettlement({ user, transactionAmount: 5000, todayT0Sum: 2000 });
      expect(resWithin.settlementType).to.equal('T0');

      const resExceeded = await evaluateDynamicSettlement({ user, transactionAmount: 9000, todayT0Sum: 2000 });
      expect(resExceeded.settlementType).to.equal('T1');
      expect(resExceeded.isLimitExceeded).to.be.true;
    });

    it('should allow reducing merchant limit from 5000 to 2000 when merchant has used 0 today', async () => {
      const merchantUser = { id: 303, role: 'merchant', franchaise_id: null, t0_daily_limit: 5000 };
      sandbox.stub(RazorpayNotification, 'sum').resolves(0);

      let err1 = null;
      try {
        await validateMerchantT0Limit({ targetUser: merchantUser, requestedLimit: 2000, requesterUser: { role: 'admin' } });
      } catch (e) {
        err1 = e;
      }
      expect(err1).to.be.null;
    });

    it('should reject allocating limit to merchant if franchise pool (100) is exceeded by existing allocation (50) + new allocation (60)', async () => {
      const merchantUser = { id: 304, role: 'merchant', franchaise_id: 201, t0_daily_limit: 0 };
      const parentFranchise = { id: 201, role: 'franchaise', t0_daily_limit: 100 };

      sandbox.stub(User, 'findByPk').resolves(parentFranchise);
      sandbox.stub(RazorpayNotification, 'sum').resolves(0);
      sandbox.stub(User, 'findAll').resolves([{ t0_daily_limit: 50 }]); // Other merchant allocated 50

      let err = null;
      try {
        await validateMerchantT0Limit({ targetUser: merchantUser, requestedLimit: 60, requesterUser: { role: 'admin' } });
      } catch (e) {
        err = e;
      }

      expect(err).to.not.be.null;
      expect(err.message).to.include('Limit pool of Franchise (₹100) exceeded');
    });
  });
});
