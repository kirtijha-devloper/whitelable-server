const { normalizeSettlementType, resolveEffectiveSettlement } = require('../services/settlementService');
const RazorpayNotification = require('../models/RazorpayNotification');

describe('Settlement Service Unit Tests', () => {
  describe('normalizeSettlementType', () => {
    it('should normalize T0 and today_settlement to T0', () => {
      expect(normalizeSettlementType('T0')).toBe('T0');
      expect(normalizeSettlementType('today_settlement')).toBe('T0');
      expect(normalizeSettlementType('TODAY_SETTLEMENT')).toBe('T0');
      expect(normalizeSettlementType('')).toBe('T0');
      expect(normalizeSettlementType(null)).toBe('T0');
    });

    it('should normalize T1 and next_day_settlement to T1', () => {
      expect(normalizeSettlementType('T1')).toBe('T1');
      expect(normalizeSettlementType('next_day_settlement')).toBe('T1');
      expect(normalizeSettlementType('NEXT_DAY_SETTLEMENT')).toBe('T1');
    });
  });

  describe('resolveEffectiveSettlement', () => {
    it('should return T1 when user settlement_type is T1', async () => {
      const user = { id: 101, settlement_type: 'T1', t0_daily_limit: 50000 };
      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 1000 });
      expect(res.effectiveSettlement).toBe('T1');
      expect(res.isLimitExceeded).toBe(false);
    });

    it('should return T1 when user is T0 and t0_daily_limit is NULL or 0 (Unassigned/Zero Limit)', async () => {
      const user = { id: 102, role: 'merchant', settlement_type: 'T0', t0_daily_limit: null };
      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 1000 });
      expect(res.effectiveSettlement).toBe('T1');
      expect(res.isLimitExceeded).toBe(true);
      expect(res.t0Limit).toBe(0);
    });

    it('should return T0 when projected total is within t0_daily_limit', async () => {
      const user = { id: 103, role: 'merchant', settlement_type: 'T0', t0_daily_limit: 50000 };
      jest.spyOn(RazorpayNotification, 'sum').mockResolvedValue(20000);

      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 10000 });
      expect(res.effectiveSettlement).toBe('T0');
      expect(res.isLimitExceeded).toBe(false);
      expect(res.todayT0Total).toBe(20000);
      expect(res.projectedTotal).toBe(30000);
      expect(res.t0Limit).toBe(50000);

      RazorpayNotification.sum.mockRestore();
    });

    it('should auto-shift to T1 when projected total exceeds t0_daily_limit', async () => {
      const user = { id: 104, role: 'merchant', settlement_type: 'T0', t0_daily_limit: 50000 };
      jest.spyOn(RazorpayNotification, 'sum').mockResolvedValue(45000);

      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 10000 });
      expect(res.effectiveSettlement).toBe('T1');
      expect(res.isLimitExceeded).toBe(true);
      expect(res.todayT0Total).toBe(45000);
      expect(res.projectedTotal).toBe(55000);
      expect(res.t0Limit).toBe(50000);
      expect(res.note).toContain('T0 Limit exceeded');

      RazorpayNotification.sum.mockRestore();
    });

    it('should calculate franchise effective self-limit as total pool minus allocated to merchants', async () => {
      const User = require('../models/User');
      const franchiseUser = { id: 201, role: 'franchaise', settlement_type: 'T0', t0_daily_limit: 300 };
      jest.spyOn(User, 'findAll').mockResolvedValue([{ t0_daily_limit: 100 }]);
      jest.spyOn(RazorpayNotification, 'sum').mockResolvedValue(150);

      // Remaining self limit is 300 - 100 = 200. Projected: 150 + 40 = 190 <= 200 => T0
      const res1 = await resolveEffectiveSettlement({ user: franchiseUser, incomingTxnAmount: 40 });
      expect(res1.effectiveSettlement).toBe('T0');
      expect(res1.t0Limit).toBe(200);

      // Projected: 150 + 140 = 290 > 200 => T1
      const res2 = await resolveEffectiveSettlement({ user: franchiseUser, incomingTxnAmount: 140 });
      expect(res2.effectiveSettlement).toBe('T1');
      expect(res2.isLimitExceeded).toBe(true);

      User.findAll.mockRestore();
      RazorpayNotification.sum.mockRestore();
    });
  });

  describe('evaluateDynamicSettlement', () => {
    const { evaluateDynamicSettlement } = require('../services/settlementService');
    const serviceSettingsService = require('../services/serviceSettingsService');

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should honor static DB mode when global switch is OFF', async () => {
      jest.spyOn(serviceSettingsService, 'getServiceFlagValue').mockResolvedValue(false);
      const user = { id: 101, settlement_type: 'T0', t0_daily_limit: 5000 };

      const res = await evaluateDynamicSettlement({ user, transactionAmount: 1000 });
      expect(res.settlementType).toBe('T0');
      expect(res.isGlobalT0Enabled).toBe(false);
      expect(res.reason).toContain('Global T0 switch OFF');
    });

    it('should return dynamic T1 when T0 limit is unassigned or 0 with global switch ON', async () => {
      jest.spyOn(serviceSettingsService, 'getServiceFlagValue').mockResolvedValue(true);
      const userUnassigned = { id: 102, settlement_type: 'T0', t0_daily_limit: null };

      const res = await evaluateDynamicSettlement({ user: userUnassigned, transactionAmount: 1000 });
      expect(res.settlementType).toBe('T1');
      expect(res.isGlobalT0Enabled).toBe(true);
      expect(res.reason).toContain('T0 Limit Unassigned');
    });

    it('should return dynamic T0 when limit is unlimited', async () => {
      jest.spyOn(serviceSettingsService, 'getServiceFlagValue').mockResolvedValue(true);
      const userUnlimited = { id: 103, settlement_type: 'T0', t0_daily_limit: 'unlimited' };

      const res = await evaluateDynamicSettlement({ user: userUnlimited, transactionAmount: 50000 });
      expect(res.settlementType).toBe('T0');
      expect(res.isGlobalT0Enabled).toBe(true);
    });

    it('should return T0 when within limit and T1 when limit exceeded', async () => {
      jest.spyOn(serviceSettingsService, 'getServiceFlagValue').mockResolvedValue(true);
      const user = { id: 104, settlement_type: 'T0', t0_daily_limit: 10000 };

      const resWithin = await evaluateDynamicSettlement({ user, transactionAmount: 5000, todayT0Sum: 2000 });
      expect(resWithin.settlementType).toBe('T0');

      const resExceeded = await evaluateDynamicSettlement({ user, transactionAmount: 9000, todayT0Sum: 2000 });
      expect(resExceeded.settlementType).toBe('T1');
      expect(resExceeded.isLimitExceeded).toBe(true);
    });

    it('should allow reducing merchant limit from 5000 to 2000 when merchant has used 0 today', async () => {
      const { validateMerchantT0Limit } = require('../services/settlementService');
      const merchantUser = { id: 303, role: 'merchant', franchaise_id: null, t0_daily_limit: 5000 };
      // Merchant utilized today: 0
      jest.spyOn(RazorpayNotification, 'sum').mockResolvedValue(0);

      // Reducing to 2000, 1000, or 0 should succeed when used today is 0
      await expect(
        validateMerchantT0Limit({ targetUser: merchantUser, requestedLimit: 2000, requesterUser: { role: 'admin' } })
      ).resolves.not.toThrow();

      await expect(
        validateMerchantT0Limit({ targetUser: merchantUser, requestedLimit: 0, requesterUser: { role: 'admin' } })
      ).resolves.not.toThrow();
    });
  });
});
