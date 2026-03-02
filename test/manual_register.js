const axios = require('axios');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');
require('dotenv').config();
(async () => {
  const BASE='http://localhost:5000';
  // generate admin token
  const token = jwt.sign(
    { user: { id: 30, name: 'Vivek', mobile_number: '8873962933', role: 'admin', ipay_outlet_id: null } },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '1h' }
  );
  const form = new FormData();
  form.append('role','merchant');
  form.append('name','NoPass');
  form.append('email','nopass@example.com');
  form.append('mobile_number','9999999999');
  form.append('password','abc');
  try {
    const res = await axios.post(`${BASE}/api/user/register`, form, {
      headers: { ...form.getHeaders(), Authorization: 'Bearer dummy' },
      validateStatus: () => true,
    });
    console.log('status', res.status, res.data);
  } catch (e) {
    console.error('error', e.response ? e.response.data : e.message);
  }
})();
