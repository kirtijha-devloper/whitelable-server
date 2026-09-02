/**
 * Utility functions for masking PII data (email, mobile number) in API responses.
 */

/**
 * Mask an email address to conceal sensitive personal information in network responses.
 * Examples:
 * - "sampleuser1230@gmail.com" -> "s************0@gmail.com"
 * - "john.doe@abheepay.com"    -> "j******e@abheepay.com"
 * - "ab@domain.com"            -> "a*@domain.com"
 * - "a@domain.com"             -> "a*@domain.com"
 *
 * @param {string} email
 * @returns {string} Masked email or original if empty/invalid
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') {
    return email;
  }

  const trimmed = email.trim();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return email;
  }

  const localPart = trimmed.substring(0, atIndex);
  const domain = trimmed.substring(atIndex);

  if (localPart.length <= 1) {
    return `${localPart}*${domain}`;
  }

  if (localPart.length === 2) {
    return `${localPart[0]}*${domain}`;
  }

  const firstChar = localPart[0];
  const lastChar = localPart[localPart.length - 1];
  const maskLength = localPart.length - 2;
  const maskedMiddle = '*'.repeat(maskLength);

  return `${firstChar}${maskedMiddle}${lastChar}${domain}`;
}

/**
 * Mask a mobile number to conceal sensitive personal information in network responses.
 * Example:
 * - "9876543210" -> "******3210"
 *
 * @param {string} mobileNumber
 * @returns {string} Masked mobile number or original if empty/invalid
 */
function maskMobileNumber(mobileNumber) {
  if (!mobileNumber || typeof mobileNumber !== 'string') {
    return mobileNumber;
  }

  const trimmed = mobileNumber.trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }

  const visibleDigits = 4;
  const maskedPart = '*'.repeat(trimmed.length - visibleDigits);
  const visiblePart = trimmed.slice(-visibleDigits);

  return `${maskedPart}${visiblePart}`;
}

module.exports = {
  maskEmail,
  maskMobileNumber,
};
