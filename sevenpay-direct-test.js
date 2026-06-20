const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');

const userName = "RT10547";
const password = "Tushar@10";

const aesKeyString = "5197318082698711"; 
const ivString = "6620682763440784";
const aesKey = Buffer.from(aesKeyString, 'utf8');
const iv = Buffer.from(ivString, 'utf8');

// The NEW encrypted Key and IV from the certificate
const encryptedKey = "kkfR8cw5BMkQu9sd/6aTv/gGN/+lzCtCKtPfyKkb3RXaF9pAGwmRFt4gZGbrcAqpvfvEYPKsyswMmbxntdQw63B/uDNSCcJgmuvp8GG8OAaF77htB9TWNhOBcl1Xre4fh5sbc16dNPli9dulDXgtO16gP43QJ3TZ3fIYkn8oMy0hS6idIHIoPV8qVl4TdTTChp691MZbFxagpwtojOmxAuc8guJMRA79R8yzibr9JvxK9aC0ROQttOicifuSM+YeFrCTPirn3xd3Mtt6PQhAyQg/yUlOMJuqLtLilya8YjIHqUhcD+LVsm9Ak1+6bx1TQDoEUb7MN4HKPkamlh6GgA==";
const encryptedIv = "Q1AoDPVaMNSN0O4Zb1F3hXIQWTygrmBWMrJzFBrn+cMVLanKoTq0cxH+sr426VVZNStmFIpqeoMQNipVwVylvwsPI8+cJ7XVVcurWXC1JuTc8UoRsXRZKAZ5maDRJpxG5MyhuTY4AUFYu4I3ze14tQgxw06Rx9Oc/9JxB/tXgvgPn5ZNP1uoOOGB+QfT+Nc66AVbVc85XookeaMRx2kessG8nvtMFoNp2BgXmmIYmJTqimQTLAWfsXInJvWejRKWQyAgLoMTeH6gSAgIScxi6yhQXuxkCVqJTp4OwqQA+iMRUPwOW1oOeS5PdrZxJzL4Mx+q23QK7Oj6SR7wu53bWg==";

async function testLogin() {
  const payload = {
    userName: userName,
    password: password,
    channelType: "API"
  };

  const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, iv);
  const plaintextBody = JSON.stringify(payload);
  const encryptedPayload = Buffer.concat([
    cipher.update(Buffer.from(plaintextBody, 'utf8')),
    cipher.final(),
  ]).toString('base64');

  // Let's send it WITH double quotes so ASP.NET can parse it
  const bodyWithQuotes = '"' + encryptedPayload + '"';

  console.log('Sending Body:', bodyWithQuotes);

  try {
    const response = await axios.post(
      'https://txnapi.sevenpay.in/api/Account/GetToken/Login',
      bodyWithQuotes,
      {
        headers: {
          key: encryptedKey,
          iv: encryptedIv,
          'Content-Type': 'application/json',
          'x-request-channel': 'Web'
        }
      }
    );
    console.log(`\n[SUCCESS] Response Code: ${response.status}`);
    console.log(`[Response Data]:`, response.data);
  } catch (error) {
    console.log(`\n[ERROR] Request Failed!`);
    console.log(`Status Code:`, error.response?.status);
    console.log(`RAW Response Data:`, error.response?.data);
  }
}
testLogin();
