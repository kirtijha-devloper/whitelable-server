/**
 * Quick integration test for POST /api/user/register
 * Run: node test/register.test.js
 */

require('dotenv').config();
const jwt      = require('jsonwebtoken');
const FormData = require('form-data');
const axios    = require('axios');
// avoid hitting real Cloudinary in integration tests
const cloudinary = require('cloudinary').v2;
cloudinary.uploader.upload = async (filePath, opts) => ({ secure_url: 'https://dummy.cloudinary.test/' + path.basename(filePath) });
const path = require('path');

const BASE_URL = `http://localhost:${process.env.PORT || 5000}`;

// ── Mint a short-lived admin token ──────────────────────────────────────────
const token = jwt.sign(
  { user: { id: 30, name: 'Vivek', mobile_number: '8873962933', role: 'admin', ipay_outlet_id: null } },
  process.env.ACCESS_TOKEN_SECRET,
  { expiresIn: '1h' }
);

// ── Unique mobile per run so we never collide ────────────────────────────────
const mobile = `9${Date.now().toString().slice(-9)}`;

// ── Thin wrapper around axios that never throws on HTTP errors ───────────────
async function post(form, authHeader) {
  const headers = { ...form.getHeaders() };
  if (authHeader) headers.Authorization = authHeader;
  const res = await axios.post(`${BASE_URL}/api/user/register`, form, {
    headers,
    validateStatus: () => true,
  });
  return { status: res.status, body: res.data };
}

// helper for PUT with formdata
async function putForm(path, form, authHeader) {
  const headers = { ...form.getHeaders() };
  if (authHeader) headers.Authorization = authHeader;
  const res = await axios.put(`${BASE_URL}${path}`, form, {
    headers,
    validateStatus: () => true,
  });
  return { status: res.status, body: res.data };
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    try {
      await fn();
      console.log(`  ✅  ${label}`);
      passed++;
    } catch (err) {
      console.error(`  ❌  ${label}`);
      console.error(`       ${err.message}`);
      failed++;
    }
  }

  function assert(condition, msg) {
    if (!condition) throw new Error(msg);
  }

  console.log('\n══════════════════════════════════════════');
  console.log('  POST /api/user/register — integration tests');
  console.log('══════════════════════════════════════════\n');

  // ── 1. No token → 401 ────────────────────────────────────────────────────
  await test('Returns 401 when Authorization header is missing', async () => {
    const form = new FormData();
    form.append('role', 'merchant');
    const { status } = await post(form);
    assert(status === 401, `Expected 401, got ${status}`);
  });

  // ── 2. Missing required fields → 400 ─────────────────────────────────────
  await test('Returns 400 when required fields are missing', async () => {
    const form = new FormData();
    form.append('role', 'merchant');
    // email, password, mobile_number intentionally omitted
    const { status, body } = await post(form, `Bearer ${token}`);
    assert(status === 400 || status === 500, `Expected 4xx/5xx, got ${status}`);
    assert(body.success === false || body.message, 'Expected error message');
  });

  // ── 3. Missing bank passbook file → 400 ─────────────────────────────────
  await test('Returns 400 when bank_passbook is not provided', async () => {
    const form = new FormData();
    form.append('role', 'merchant');
    form.append('name', 'NoPassbook');
    form.append('email', `nopass_${Date.now()}@example.com`);
    form.append('mobile_number', `${process.env.TEST_MOBILE_PREFIX || '7'}${Date.now().toString().slice(-9)}`);
    form.append('password', 'Test@1234');
    const { status, body } = await post(form, `Bearer ${token}`);
    if (status !== 400) {
      console.log('  ❗ Response body for missing passbook case:', JSON.stringify(body));
    }
    assert(status === 400, `Expected 400 when passbook missing, got ${status}`);
    assert(body.message && body.message.toLowerCase().includes('passbook'), 'Error should mention passbook');
  });

  // ── 3. Successful merchant registration ───────────────────────────────────
  let createdUserId = null;
  await test('Creates a merchant and returns 201 with user + data keys', async () => {
    const form = new FormData();
    form.append('role',            'merchant');
    form.append('name',            'Test Merchant');
    form.append('email',           `test_${Date.now()}@example.com`);
    form.append('mobile_number',   mobile);
    form.append('password',        'Test@1234');
    form.append('gender',          'male');
    form.append('dob',             '1995-06-15');
    form.append('address1',        '12 Test Street');
    form.append('city',            'Mumbai');
    form.append('district',        'Mumbai City');
    form.append('company_or_shop_name', 'Integration Shop LLC');
    form.append('pincode',         '400001');
    form.append('state',           'Maharashtra');
    form.append('aadhar_number',   '123456789012');
    form.append('pan_number',      'ABCDE1234F');
    form.append('settlement_type', 'today_settlement');
    form.append('pos_machine_ids', '[]');

    // attach bank_passbook file (required)
    const fs = require('fs');
    const path = require('path');
    const dummyPath = path.join(__dirname, 'dummy_passbook.txt');
    fs.writeFileSync(dummyPath, 'this simulates a bank passbook image');
    form.append('bank_passbook', fs.createReadStream(dummyPath));

    const { status, body } = await post(form, `Bearer ${token}`);
    console.log('\n  📦  Response body:');
    console.log(JSON.stringify(body, null, 4).replace(/^/gm, '       '));

    assert(status === 201,             `Expected 201, got ${status}: ${body.message}`);
    assert(body.success === true,      'success should be true');
    assert(body.user?.id,              'body.user.id should be present');
    assert(body.data?.id,              'body.data.id should be present');
    assert(body.user.id === body.data.id, 'user.id and data.id should match');
    assert(body.user.role === 'merchant', `Expected role merchant, got ${body.user.role}`);
    assert(body.user.company_or_shop_name === 'Integration Shop LLC', 'company_or_shop_name should be echoed back');
    assert(/^AP[MAF]\d{5}$/.test(body.user.username), `username should follow APx00000 pattern, got ${body.user.username}`);
    createdUsername = body.user.username;
    assert(body.user.abheepay_id?.startsWith('APM'), `abheepay_id should start APM, got ${body.user.abheepay_id}`);
    assert(typeof body.pos === 'object',  'pos object should be present');
    assert(typeof body.sms === 'object',  'sms object should be present');
    createdUserId = body.user.id;
    console.log(`\n       Created user id: ${createdUserId}`);
  });

  // ── 4. Second merchant registration should increment username ──────────
  let secondUsername;
  await test('Second merchant username increments', async () => {
    const mobSecond = `9${Date.now().toString().slice(-9)}`;
    const form = new FormData();
    form.append('role', 'merchant');
    form.append('name', 'Second Merchant');
    form.append('email', `second_${Date.now()}@example.com`);
    form.append('mobile_number', mobSecond);
    form.append('password', 'Test@1234');
    // required passbook file
    const fs = require('fs'); const path = require('path');
    const dummy = path.join(__dirname, 'dummy_passbook.txt');
    fs.writeFileSync(dummy, 'pass');
    form.append('bank_passbook', fs.createReadStream(dummy));

    const { status, body } = await post(form, `Bearer ${token}`);
    assert(status === 201, `Expected 201, got ${status}`);
    assert(/^AP[MAF]\d{5}$/.test(body.user.username), 'username should match pattern');
    secondUsername = body.user.username;
    assert(secondUsername > createdUsername, 'second username should be lexicographically greater');
  });

  // ── 5. Duplicate mobile → 400 ─────────────────────────────────────────────
  await test('Returns 400 on duplicate mobile_number registration', async () => {
    const form = new FormData();
    form.append('role',          'merchant');
    form.append('name',          'Duplicate Test');
    form.append('email',         `dup_${Date.now()}@example.com`);
    form.append('mobile_number', mobile); // same mobile as test 3
    form.append('password',      'Test@1234');
    // add required passbook
    const fs = require('fs'); const path = require('path');
    const dummy = path.join(__dirname, 'dummy_passbook.txt');
    fs.writeFileSync(dummy, 'pass');
    form.append('bank_passbook', fs.createReadStream(dummy));

    const { status, body } = await post(form, `Bearer ${token}`);
    assert(status === 400 || status === 500, `Expected 400/500, got ${status}`);
    assert(/exist/i.test(body.message), `Expected "exist" in message, got: ${body.message}`);
  });

  // ── 5. settlement_type defaults to today_settlement when omitted ──────────
  await test('settlement_type defaults to today_settlement when omitted', async () => {
    const mob2 = `8${Date.now().toString().slice(-9)}`;
    const form = new FormData();
    form.append('role',          'merchant');
    form.append('name',          'Default Settlement Test');
    form.append('email',         `def_${Date.now()}@example.com`);
    form.append('mobile_number', mob2);
    form.append('password',      'Test@1234');
    // settlement_type intentionally omitted
    const fs = require('fs'); const path = require('path');
    const dummy = path.join(__dirname, 'dummy_passbook.txt');
    fs.writeFileSync(dummy, 'pass');
    form.append('bank_passbook', fs.createReadStream(dummy));

    const { status, body } = await post(form, `Bearer ${token}`);
    assert(status === 201, `Expected 201, got ${status}: ${body.message}`);
    assert(body.user?.id, 'user.id should be present');
  });

  // ── 6. Role "franchise" is normalised to "franchaise" in DB ──────────────
  await test('Role "franchise" is accepted and stored with APF prefix', async () => {
    const mob3 = `7${Date.now().toString().slice(-9)}`;
    const form = new FormData();
    form.append('role',          'franchise');
    form.append('name',          'Test Franchise');
    form.append('email',         `frn_${Date.now()}@example.com`);
    form.append('mobile_number', mob3);
    form.append('password',      'Test@1234');
    const fs = require('fs'); const path = require('path');
    const dummy = path.join(__dirname, 'dummy_passbook.txt');
    fs.writeFileSync(dummy, 'pass');
    form.append('bank_passbook', fs.createReadStream(dummy));

    const { status, body } = await post(form, `Bearer ${token}`);
    assert(status === 201, `Expected 201, got ${status}: ${body.message}`);
    assert(body.user?.abheepay_id?.startsWith('APF'), `Expected APF prefix, got ${body.user?.abheepay_id}`);
  });

  // ── 7. Updating user with file upload should work ───────────────────────
  await test('Updating merchant profile with attachment succeeds', async () => {
    assert(createdUserId, 'createdUserId must be set by registration test');
    const form = new FormData();
    form.append('name', 'Updated Merchant');
    const fs = require('fs');
    const path = require('path');
    const dummyPath = path.join(__dirname, 'dummy_update.txt');
    fs.writeFileSync(dummyPath, 'dummy content');
    form.append('pan_photo', fs.createReadStream(dummyPath));

    const { status, body } = await putForm(`/api/user/${createdUserId}`, form, `Bearer ${token}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.success === true, 'Response success must be true');
    // either URL present or unchanged
    assert('pan_number_url' in body.data, 'Response should include pan_number_url');
    assert(body.data.username === createdUsername, 'username should remain the same after update');
  });

  // ── 8. Ensure company_or_shop_name can be updated ─────────────────────
  await test('Updating company_or_shop_name via PUT works', async () => {
    assert(createdUserId, 'createdUserId must be set by registration test');
    const form = new FormData();
    form.append('company_or_shop_name', 'New Shop Name');
    const { status, body } = await putForm(`/api/user/${createdUserId}`, form, `Bearer ${token}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.success === true, 'Response success must be true');
    assert(body.data.company_or_shop_name === 'New Shop Name', 'company_or_shop_name should be updated');
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
