const { expect } = require('chai');
const sinon = require('sinon');
const { normalizeSettlementType, resolveEffectiveSettlement } = require('../services/settlementService');
const RazorpayNotification = require('../models/RazorpayNotification');

describe('Settlement Service Unit Tests', () => {
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
      expect(res.isLimitExceeded).to.equal(false);
    });

    it('should return T0 when user is T0 and t0_daily_limit is NULL (Unlimited)', async () => {
      const user = { id: 102, settlement_type: 'T0', t0_daily_limit: null };
      const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 100000 });
      expect(res.effectiveSettlement).to.equal('T0');
      expect(res.isLimitExceeded).to.equal(false);
      expect(res.t0Limit).to.equal(null);
    });

    it('should return T0 when projected total is within t0_daily_limit', async () => {
      const user = { id: 103, settlement_type: 'T0', t0_daily_limit: 50000 };
      const stub = sinon.stub(RazorpayNotification, 'sum').resolves(20000);

      try {
        const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 10000 });
        expect(res.effectiveSettlement).to.equal('T0');
        expect(res.isLimitExceeded).to.equal(false);
        expect(res.todayT0Total).to.equal(20000);
        expect(res.projectedTotal).to.equal(30000);
        expect(res.t0Limit).to.equal(50000);
      } finally {
        stub.restore();
      }
    });

    it('should auto-shift to T1 when projected total exceeds t0_daily_limit', async () => {
      const user = { id: 104, settlement_type: 'T0', t0_daily_limit: 50000 };
      const stub = sinon.stub(RazorpayNotification, 'sum').resolves(45000);

      try {
        const res = await resolveEffectiveSettlement({ user, incomingTxnAmount: 10000 });
        expect(res.effectiveSettlement).to.equal('T1');
        expect(res.isLimitExceeded).to.equal(true);
        expect(res.todayT0Total).to.equal(45000);
        expect(res.projectedTotal).to.equal(55000);
        expect(res.t0Limit).to.equal(50000);
        expect(res.note).to.include('T0 Limit exceeded');
      } finally {
        stub.restore();
      }
    });
  });
});
