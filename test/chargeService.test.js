const { expect } = require('chai');
const sinon = require('sinon');

const ChargeService = require('../services/chargeService');
const db = require('../config/database');

describe('ChargeService', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('calculateCharge', () => {
    it('returns 0 when rule is null', () => {
      const { charge, gstAmount } = ChargeService.calculateCharge(100, null);
      expect(charge).to.equal(0);
      expect(gstAmount).to.equal(0);
    });

    it('calculates percent and flat correctly with GST', () => {
      const rule = { charge_percent: 2.5, charge_flat: 10, gst_required: true, gst_percent: 18 };
      const { charge, gstAmount } = ChargeService.calculateCharge(1000, rule);
      // percent = 25, flat = 10 ==> 35, gst@18% = 6.3
      expect(charge).to.equal(35);
      expect(gstAmount).to.equal(6.3);
    });

    it('handles missing gst gracefully', () => {
      const rule = { charge_percent: 1, charge_flat: 0, gst_required: false };
      const { charge, gstAmount } = ChargeService.calculateCharge(200, rule);
      expect(charge).to.equal(2);
      expect(gstAmount).to.equal(0);
    });
  });

  describe('card brand normalization', () => {
    it('normalizes MASTER_CARD to MASTERCARD', () => {
      expect(ChargeService.normalizeCardBrand('MASTER_CARD')).to.equal('MASTERCARD');
      expect(ChargeService.normalizeCardBrand('master_card')).to.equal('MASTERCARD');
    });

    it('returns canonical values for brand candidates', () => {
      const candidates = ChargeService.getCardBrandCandidates('MASTER_CARD');
      expect(candidates).to.include('MASTERCARD');
      expect(candidates).to.include('MASTER_CARD');
      expect(candidates).to.include('MASTER');
    });
  });

  describe('getTransactionChargeRule', () => {
    it('returns null when no rows match', async () => {
      sinon.stub(db, 'query').resolves([]); // no rows
      const rule = await ChargeService.getTransactionChargeRule({
        userId: 1,
        franchiseId: null,
        paymentMode: 'CARD',
        cardType: null,
        cardBrand: null,
        classification: null,
        settlement: null,
        amount: 100
      });
      expect(rule).to.be.null;
    });

    it('picks the first row from results array', async () => {
      const fakeRow = { id: 99, charge_percent: '3.0' };
      sinon.stub(db, 'query').resolves([fakeRow]);
      const rule = await ChargeService.getTransactionChargeRule({
        userId: 2,
        franchiseId: 5,
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'VISA',
        classification: 'PLATINUM',
        settlement: 'TODAY',
        amount: 500
      });
      expect(rule).to.deep.equal(fakeRow);
    });

    it('binds replacements correctly for user and franchise', async () => {
      const stub = sinon.stub(db, 'query').callsFake((query, opts) => {
        // verify that the 1st and 2nd bind values match what we passed
        expect(opts.bind[0]).to.equal(7);
        expect(opts.bind[1]).to.equal(5);
        return [[]];
      });
      await ChargeService.getTransactionChargeRule({
        userId: 7,
        franchiseId: 5,
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'VISA',
        classification: 'PLATINUM',
        settlement: 'TODAY',
        amount: 100
      });
      expect(stub.calledOnce).to.be.true;
    });
  });
});