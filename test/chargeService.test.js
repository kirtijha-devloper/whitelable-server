require('./test-setup');
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
      expect(ChargeService.normalizeCardBrand('MASTER CARD')).to.equal('MASTERCARD');
      expect(ChargeService.normalizeCardBrand('master-card')).to.equal('MASTERCARD');
    });

    it('normalizes AMERICAN EXPRESS and DINERS variants', () => {
      expect(ChargeService.normalizeCardBrand('AMERICAN EXPRESS')).to.equal('AMEX');
      expect(ChargeService.normalizeCardBrand('american-express')).to.equal('AMEX');
      expect(ChargeService.normalizeCardBrand('DINERS CLUB')).to.equal('DINERS');
      expect(ChargeService.normalizeCardBrand('diners-club')).to.equal('DINERS');
    });

    it('returns canonical values for brand candidates', () => {
      const candidates = ChargeService.getCardBrandCandidates('MASTER_CARD');
      expect(candidates).to.include('MASTERCARD');
      expect(candidates).to.include('MASTER_CARD');
      expect(candidates).to.include('MASTER');
      expect(candidates).to.include('MASTER CARD');
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
        expect(opts.bind[8]).to.equal(null);
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

    it('passes merchant role into the bind list for user-specific rule matching', async () => {
      const stub = sinon.stub(db, 'query').callsFake((_query, opts) => {
        expect(opts.bind[8]).to.equal('MERCHANT');
        return [[]];
      });

      await ChargeService.getTransactionChargeRule({
        userId: 7,
        userRole: 'merchant',
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

    it('does not allow promoted franchise users to match legacy merchant-scoped rules', async () => {
      const stub = sinon.stub(db, 'query').callsFake((query, opts) => {
        expect(query).to.include("($9 = 'MERCHANT' AND user_id = $1)");
        expect(opts.bind[8]).to.equal('FRANCHAISE');
        return [];
      });

      await ChargeService.getTransactionChargeRule({
        userId: 42,
        userRole: 'franchaise',
        franchiseId: 42,
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'RUPAY',
        classification: 'PLATINUM',
        settlement: 'today_settlement',
        amount: 500
      });

      expect(stub.calledOnce).to.be.true;
    });

    it('normalizes card lookup values and performs case-insensitive SQL matching', async () => {
      sinon.stub(db, 'query').callsFake((query, opts) => {
        expect(query).to.include('UPPER(payment_mode) = $3');
        expect(query).to.include('UPPER(card_type)    = $4');
        expect(query).to.include('UPPER(card_brand)   = $5');
        expect(query).to.include('UPPER(card_classification) = $6');
        expect(opts.bind[2]).to.equal('CARD');
        expect(opts.bind[3]).to.equal('CREDIT');
        expect(opts.bind[4]).to.equal('VISA');
        expect(opts.bind[5]).to.equal('BUSINESS');
        return [];
      });

      await ChargeService.getTransactionChargeRule({
        userId: 7,
        franchiseId: 5,
        paymentMode: 'Card',
        cardType: 'Credit',
        cardBrand: 'visa',
        classification: 'Business',
        settlement: 'today_settlement',
        amount: 100
      });
    });

    it('supports ANY wildcard condition matching in SQL query', async () => {
      const stub = sinon.stub(db, 'query').callsFake((query, opts) => {
        expect(query).to.include("UPPER(payment_mode) = $3 OR payment_mode IS NULL OR UPPER(payment_mode) = 'ANY'");
        expect(query).to.include("UPPER(card_type)    = $4 OR card_type    IS NULL OR UPPER(card_type)    = 'ANY'");
        expect(query).to.include("UPPER(card_brand)   = $5 OR card_brand   IS NULL OR UPPER(card_brand)   = 'ANY'");
        expect(query).to.include("UPPER(card_classification) = $6 OR card_classification IS NULL OR UPPER(card_classification) = 'ANY'");
        expect(query).to.include("settlement_type     = $7 OR settlement_type     IS NULL OR UPPER(settlement_type)     = 'ANY'");
        return [];
      });

      await ChargeService.getTransactionChargeRule({
        userId: 1,
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'MASTERCARD',
        classification: 'ANY',
        settlement: 'today_settlement',
        amount: 100
      });

      expect(stub.callCount).to.equal(4);
    });
  });
});
