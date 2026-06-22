const axios = require('axios');
const crypto = require('crypto');

// 1. Credentials
const userName = "RT10547";
const password = "Tushar@10";

// 2. Static AES Key and IV (Matches the provided Postman collection)
const aesKeyString = "5197318082698711"; 
const ivString = "6620682763440784";
const aesKey = Buffer.from(aesKeyString, 'utf8');
const iv = Buffer.from(ivString, 'utf8');

// 3. The New Certificate provided by SevenPay (cmp.sbi.bank.in)
const certPem = `-----BEGIN CERTIFICATE-----
MIIG+TCCBeGgAwIBAgIQBFszCZNFCF+W4nuM6WCqJDANBgkqhkiG9w0BAQsFADBE
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMR4wHAYDVQQDExVE
aWdpQ2VydCBFViBSU0EgQ0EgRzIwHhcNMjUwODI4MDAwMDAwWhcNMjYwOTI4MjM1
OTU5WjCBvjETMBEGCysGAQQBgjc8AgEDEwJJTjEaMBgGA1UEDwwRR292ZXJubWVu
dCBFbnRpdHkxGjAYBgNVBAUTEUdvdmVybm1lbnQgRW50aXR5MQswCQYDVQQGEwJJ
TjEUMBIGA1UECBMLTWFoYXJhc2h0cmExFDASBgNVBAcTC05hdmkgTXVtYmFpMRww
GgYDVQQKExNTVEFURSBCQU5LIE9GIElORElBMRgwFgYDVQQDEw9jbXAuc2JpLmJh
bmsuaW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDQtpAtQqsDtiHP
HcC5NRHWd83CuuwlMCXh3vj1uYzu3z2dnMspd6fiJuioWMPqrLa0+Mkyyb94Wfxf
dvqW0pwgUBQxDFMdEnyGSuCfeZc7wSgERzcsXwxH6nM4g8+OCT16d8qkqtwpJX/U
TGc8unYYJLGmBAWf9do39KcwwR+Ju6XD9OxqNatz88FvJLCKwXVfNx0qoK9RPIdp
sUt4Zc30t2jy9fKwtHdHKyzV1phzECQYUTjKOyMunRyzHNi7Fef3+G4mOezDRejz
Ka+Q7uD9gnTVciVKpy4YhlSc+o8exSbTWfG2AoZUxY+xeHaygvu7sNAwFToF4Nla
f/NQO5B/AgMBAAGjggNqMIIDZjAfBgNVHSMEGDAWgBRqTlC/mGidW3sgddRZAXlI
ZpIyBjAdBgNVHQ4EFgQUT+PzvaZvg0cIrdQqopW9a04GReMwLwYDVR0RBCgwJoIP
Y21wLnNiaS5iYW5rLmlughN3d3cuY21wLnNiaS5iYW5rLmluMEoGA1UdIARDMEEw
CwYJYIZIAYb9bAIBMDIGBWeBDAEBMCkwJwYIKwYBBQUHAgEWG2h0dHA6Ly93d3cu
ZGlnaWNlcnQuY29tL0NQUzAOBgNVHQ8BAf8EBAMCBaAwHQYDVR0lBBYwFAYIKwYB
BQUHAwEGCCsGAQUFBwMCMHUGA1UdHwRuMGwwNKAyoDCGLmh0dHA6Ly9jcmwzLmRp
Z2ljZXJ0LmNvbS9EaWdpQ2VydEVWUlNBQ0FHMi5jcmwwNKAyoDCGLmh0dHA6Ly9j
cmw0LmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEVWUlNBQ0FHMi5jcmwwcwYIKwYBBQUH
AQEEZzBlMCQGCCsGAQUFBzABhhhodHRwOi8vb2NzcC5kaWdpY2VydC5jb20wPQYI
KwYBBQUHMAKGMWh0dHA6Ly9jYWNlcnRzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEVW
UlNBQ0FHMi5jcnQwDAYDVR0TAQH/BAIwADCCAXwGCisGAQQB1nkCBAIEggFsBIIB
aAFmAHUA2AlVO5RPev/IFhlvlE+Fq7D4/F6HVSYPFdEucrtFSxQAAAGY8MPFlgAA
BAMARjBEAiAbbJGtoZ4EbMa7MC0htGYyT1Zx4TOCRMLL+jk81WQkegIgSN/7CZIu
hHhF8lkmcTDAyzIcDyEtLa5FSiUuw1Hkc7gAdQDCMX5XRRmjRe5/ON6ykEHrx8Ih
WiK/f9W1rXaa2Q5SzQAAAZjww8WnAAAEAwBGMEQCIGmE0LVnmCjcI2DDxjlnaIns
96m8z/mEzXolWfNv55lBAiAwcQx9P9lGZ2HnT0h8AODF1Nymk1Lz0oXMNeRXsgKO
lwB2AJROQ4f67MHvgfMZJCaoGGUBx9NfOAIBP3JnfVU3LhnYAAABmPDDxa0AAAQD
AEcwRQIhAOHi/rxYCTBE8xzdLQXQj0zKeqntGt5Gupt/BR+fn/TIAiBCGQiG4Cfl
8GSlbJW+lAv5yCyGN0Bfpp6/o0w47n9jJzANBgkqhkiG9w0BAQsFAAOCAQEAZlCM
IRBU6ADoZME5Kbw1Bm/1xBqjHb7yoBx5VYc9Ijl5XnEx+uG7OTad1vKhTKZP97Tf
+Zsn5LyZL0w7w/Ap3smQz4JIuRcFstwIl1UWWgQamv/BTp0HnnzlAOlpF67I1E5+
N0IaNRRarnfieF9S+4Y64n74cVXm2uP75MCpxqmHMVl3A9g602dvrklDXntsWIbJ
SGt5ECqzW2TQ6yCtMlrBhE/bdxsChrx3RIPECt93M1tlzpynK9sxU2L8sAqoXfWM
rDFkEQZB5Sq2m+0gMKue8bgwBH7VCrtm2ROc1HgS7QjupQeR9sDulIfnvrzLH5rx
xwpiF9pFkAa0lh+2MQ==
-----END CERTIFICATE-----`;

// Extract Public Key from Certificate
const cert = new crypto.X509Certificate(certPem);
const publicKeyPem = cert.publicKey.export({ type: 'spki', format: 'pem' });
const pubKeyObj = crypto.createPublicKey(publicKeyPem);

// 4. RSA Encrypt the Headers
const encryptedKey = crypto.publicEncrypt({ key: pubKeyObj, padding: crypto.constants.RSA_PKCS1_PADDING }, aesKey).toString('base64');
const encryptedIv = crypto.publicEncrypt({ key: pubKeyObj, padding: crypto.constants.RSA_PKCS1_PADDING }, iv).toString('base64');

async function testLogin() {
  const payload = {
    userName: userName,
    password: password,
    channelType: "API"
  };

  // 5. AES Encrypt the Request Body
  const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, iv);
  const plaintextBody = JSON.stringify(payload);
  const encryptedPayload = Buffer.concat([
    cipher.update(Buffer.from(plaintextBody, 'utf8')),
    cipher.final(),
  ]).toString('base64');

  // We wrap the Base64 string in double quotes to satisfy ASP.NET Core application/json model binding
  const requestBody = '"' + encryptedPayload + '"';

  console.log('--- EXECUTING SEVENPAY REQUEST ---');
  console.log(`Payload:`, payload);
  console.log(`Encrypted Body:`, requestBody);
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
        }
      }
    );
    console.log(`[SUCCESS] Response Code: ${response.status}`);
    console.log(`[Response Data]:`, response.data);
  } catch (error) {
    console.log(`[ERROR] Request Failed!`);
    console.log(`Status Code:`, error.response?.status);
    console.log(`Content-Length:`, error.response?.headers['content-length']);
    console.log(`RAW Response Data:`, error.response?.data);
    
    console.log("\nCONCLUSION: The request headers successfully decrypted, meaning the AES key was accepted.");
    console.log("However, the server explicitly returned an empty '400 Bad Request'.");
    console.log("This means the application logic rejected the login (Likely Invalid Credentials or IP Whitelist issue).");
  }
}
testLogin();
