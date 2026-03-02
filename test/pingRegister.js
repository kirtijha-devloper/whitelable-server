const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = `http://localhost:5000`;

async function post(form, authHeader) {
    const headers = { ...form.getHeaders() };
    if (authHeader) headers.Authorization = authHeader;
    try {
        const res = await axios.post(`${BASE_URL}/api/user/register`, form, {
            headers,
            validateStatus: () => true,
        });
        return { status: res.status, body: res.data };
    } catch (e) {
        // dump whole object for debugging
        console.error('axios error object:', e);
        console.error('axios error message:', e.message);
        console.error('axios code:', e.code);
        console.error('axios config/url', e.config?.url);
        console.error('axios response', e.response && {
            status: e.response.status,
            data: e.response.data
        });
        throw e;
    }
}

(async () => {
    try {
        const form = new FormData();
        form.append('role', 'merchant');
        const r = await post(form);
        console.log('result', r);
    } catch (e) {
        console.error('caught error in script', e.message);
    }
})();
