const { expect } = require('chai');
const { computeFee, pickMostSpecific } = require('../controllers/commissionController');

describe('commissionController helpers', () => {
  describe('computeFee', () => {
    it('returns null when commission is falsy', () => {
      expect(computeFee(null, 100)).to.equal(null);
    });

    it('uses percent when percent > 0 (takes precedence)', () => {
      const c = { percent_fee: 1.5, flat_fee: 2.0 };
      const r = computeFee(c, 200);
      expect(r.percent_fee).to.equal(1.5);
      expect(r.flat_fee).to.equal(0);
      expect(r.charge).to.equal(3.00);
    });

    it('uses flat when percent is zero', () => {
      const c = { percent_fee: 0, flat_fee: 5.0 };
      const r = computeFee(c, 500);
      expect(r.flat_fee).to.equal(5.0);
      expect(r.percent_fee).to.equal(0);
      expect(r.charge).to.equal(5.0);
    });

    it('rounds percent result to 2 decimals', () => {
      const c = { percent_fee: 0.3333, flat_fee: 0 };
      const r = computeFee(c, 100);
      expect(r.charge).to.equal(0.33);
    });
  });

  describe('pickMostSpecific', () => {
    const slabs = [
      { payment_card_brand: null, payment_card_type: null, payment_mode: null, min_amount: 0, max_amount: 10000 },
      { payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', payment_mode: 'CARD', min_amount: 0, max_amount: 100 },
      { payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', payment_mode: 'CARD', min_amount: 101, max_amount: 10000 }
    ];

    it('selects slab that contains the amount', () => {
      const s = pickMostSpecific(slabs, { paymentCardBrand: 'RUPAY', paymentCardType: 'CREDIT', paymentMode: 'CARD' }, 50);
      expect(Number(s.min_amount)).to.equal(0);
      expect(Number(s.max_amount)).to.equal(100);
    });

    it('falls back to wildcard slab when no specific slab matches amount', () => {
      const s = pickMostSpecific(slabs, { paymentCardBrand: 'VISA', paymentCardType: 'DEBIT', paymentMode: 'CARD' }, 5000);
      expect(s.payment_card_brand).to.equal(null);
    });

    it('prefers more specific slab when multiple match', () => {
      const s = pickMostSpecific(slabs, { paymentCardBrand: 'RUPAY', paymentCardType: 'CREDIT', paymentMode: 'CARD' }, 200);
      expect(Number(s.min_amount)).to.equal(101);
    });
  });
});
