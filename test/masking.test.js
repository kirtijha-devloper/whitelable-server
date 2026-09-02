const assert = require('assert');
const { maskEmail, maskMobileNumber } = require('../utils/masking');

describe('PII Masking Utilities', () => {
  describe('maskEmail', () => {
    it('masks standard email addresses correctly', () => {
      assert.strictEqual(maskEmail('sampleuser1230@gmail.com'), 's************0@gmail.com');
      assert.strictEqual(maskEmail('john.doe@abheepay.com'), 'j******e@abheepay.com');
      assert.strictEqual(maskEmail('test@domain.com'), 't**t@domain.com');
    });

    it('handles short local parts gracefully', () => {
      assert.strictEqual(maskEmail('ab@domain.com'), 'a*@domain.com');
      assert.strictEqual(maskEmail('a@domain.com'), 'a*@domain.com');
    });

    it('handles invalid or empty email values safely', () => {
      assert.strictEqual(maskEmail(null), null);
      assert.strictEqual(maskEmail(undefined), undefined);
      assert.strictEqual(maskEmail('invalidemail'), 'invalidemail');
      assert.strictEqual(maskEmail(''), '');
    });
  });

  describe('maskMobileNumber', () => {
    it('masks mobile numbers preserving last 4 digits', () => {
      assert.strictEqual(maskMobileNumber('9876543210'), '******3210');
      assert.strictEqual(maskMobileNumber('+919876543210'), '*********3210');
    });

    it('handles short numbers or null/undefined safely', () => {
      assert.strictEqual(maskMobileNumber('123'), '123');
      assert.strictEqual(maskMobileNumber(null), null);
      assert.strictEqual(maskMobileNumber(undefined), undefined);
    });
  });
});
