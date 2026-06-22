const axios = require('axios');
const crypto = require('crypto');

const userName = "RT10547";
const password = "Tushar@10";

const aesKey = crypto.randomBytes(32); // 256-bit key
const iv = crypto.randomBytes(16);     // AES block-size IV

const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo84Y6B/A7NrhugpsxmY6
FlrtHxLWYlfgJ70+WkkkEoerV+xbGLpVIfosaiX+SP0bgjDewI0cOHmhwxqF4DYc
fBRZSrRDeKKtHuK1FkI54ASKyBp0q8KHIf1Csyrru8d9Je5Sg8Z3N/h/klR+Js88
cVtCQbal453sYXccN0ixcMn6E+C1l+NpweAQGO5l2O7Svhs+4iK8VsDzZcGzoe5N
MVD6fqvEdZ46M+AKRiClHbsvkMlZs6y8Q3/u5RGCIzO5MgSK6/W8eF5nSpcmOJ8P
kIs9kXM88EY1lAlb726HjPXG5jLuHlW8xA/9AWnagfhNv51INqcr7Yzxbq5N0qkl
jwIDAQAB
-----END PUBLIC KEY-----`;

const pubKeyObj = crypto.createPublicKey(publicKeyPem);

function encryptAesToBase64(plainText, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  return Buffer.concat([
    cipher.update(Buffer.from(plainText, 'utf8')),
    cipher.final()
  ]).toString('base64');
}

function decryptAesFromBase64(encryptedBase64, key, iv) {
  if (encryptedBase64 == null) {
    throw new Error("Encrypted response payload is null or undefined");
  }

  let normalized = encryptedBase64;

  if (typeof normalized !== 'string') {
    normalized = JSON.stringify(normalized);
  }

  normalized = normalized.trim();

  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = JSON.parse(normalized);
  }

  const encryptedBytes = Buffer.from(normalized, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false); // Disable strict padding to prevent crash

  let decryptedBytes = Buffer.concat([
    decipher.update(encryptedBytes),
    decipher.final()
  ]);

  return decryptedBytes.toString('utf8').replace(/[\x00-\x1F\x7F-\x9F]/g, ''); // Clean control characters
}

const encryptedKey = crypto.publicEncrypt(
  {
    key: pubKeyObj,
    padding: crypto.constants.RSA_PKCS1_PADDING
  },
  aesKey
).toString('base64');

const encryptedIv = crypto.publicEncrypt(
  {
    key: pubKeyObj,
    padding: crypto.constants.RSA_PKCS1_PADDING
  },
  iv
).toString('base64');

async function testLogin() {
  const payload = {
    userName: userName,
    password: password,
    channelType: "API"
  };

  const plaintextBody = JSON.stringify(payload);
  const encryptedPayload = encryptAesToBase64(plaintextBody, aesKey, iv);

  // Note: Their new code removed the double quotes wrapper. 
  // Let's send exactly what they wrote:
  const requestBody = encryptedPayload;

  console.log('--- EXECUTING SEVENPAY REQUEST ---');
  console.log('Payload:', payload);

  console.log('Generated AES key length:', aesKey.length); // 32
  console.log('Generated IV length:', iv.length);          // 16

  console.log('Encrypted Body:', requestBody);
  console.log('Encrypted Key:', encryptedKey);
  console.log('Encrypted IV:', encryptedIv);
  console.log('Sending Request...\n');

  try {
    const response = await axios.post(
      'https://txnapi.sevenpay.in/api/Account/GetToken/Login',
      requestBody,
      {
        headers: {
          key: encryptedKey,
          iv: encryptedIv,
          'Content-Type': 'application/json',
          'x-request-channel': 'Web'
        },
        transformRequest: [(data) => data],
        responseType: 'text',
        transformResponse: [(data) => data]
      }
    );

    console.log(`[SUCCESS] Response Code: ${response.status}`);
    console.log(`[Encrypted Response Data]:`, response.data);

    const decryptedResponseText = decryptAesFromBase64(response.data, aesKey, iv);

    console.log(`[Decrypted Response Text]:`, decryptedResponseText);

    try {
      const decryptedResponseJson = JSON.parse(decryptedResponseText);
      console.log(`[Decrypted Response JSON]:`, decryptedResponseJson);
    } catch {
      console.log(`[INFO] Decrypted response is not JSON`);
    }

  } catch (error) {
    console.log(`[ERROR] Request Failed!`);
    console.log(`Status Code:`, error.response?.status);
    console.log(`Content-Length:`, error.response?.headers?.['content-length']);
    console.log(`RAW Response Data:`, error.response?.data);

    if (error.response?.data) {
      try {
        const decryptedErrorText = decryptAesFromBase64(error.response.data, aesKey, iv);
        console.log(`[Decrypted Error Response Text]:`, decryptedErrorText);

        try {
          console.log(`[Decrypted Error Response JSON]:`, JSON.parse(decryptedErrorText));
        } catch {
          console.log(`[INFO] Decrypted error response is not JSON`);
        }
      } catch (decryptError) {
        console.log(`[INFO] Could not decrypt error response:`, decryptError.message);
      }
    }
  }
}

testLogin();
