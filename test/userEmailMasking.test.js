const assert = require('assert');
const { maskEmail, maskMobileNumber } = require('../utils/masking');

describe('User API Response Email Masking Integration', () => {
  it('should mask standard user email in serializer', () => {
    const rawEmail = 'sampleuser1230@gmail.com';
    const masked = maskEmail(rawEmail);
    assert.strictEqual(masked, 's************0@gmail.com');
  });

  it('should preserve domain while masking username in email', () => {
    const email = 'rajesh.kumar@abheepay.com';
    const masked = maskEmail(email);
    assert.ok(masked.endsWith('@abheepay.com'));
    assert.ok(masked.startsWith('r'));
    assert.ok(masked.includes('******'));
  });
});
