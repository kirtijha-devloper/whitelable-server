// ensure models & associations initialized
require('../models/initAssociations');
const reportCtrl = require('../controllers/reportController');

function makeMockReq(query, user) {
    return { query, user };
}
function makeMockRes() {
    return {
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(obj) {
            console.log('RESPONSE', this.statusCode, obj);
            return obj;
        }
    };
}
async function test() {
    console.log('Testing getRazorpayNotificationReport with no dates');
    const req = makeMockReq({}, { role: 'admin', id: 1 });
    const res = makeMockRes();
    await reportCtrl.getRazorpayNotificationReport(req, res);

    console.log('Testing with malformed dates');
    const req2 = makeMockReq({ start_date:'bad', end_date:'also' }, { role:'admin', id:1});
    const res2 = makeMockRes();
    await reportCtrl.getRazorpayNotificationReport(req2, res2);

    console.log('Testing with valid range');
    const today = new Date().toISOString().slice(0,10);
    const req3 = makeMockReq({ start_date: today, end_date: today }, { role:'admin', id:1 });
    const res3 = makeMockRes();
    await reportCtrl.getRazorpayNotificationReport(req3, res3);
}

test().catch(e=>console.error('ERR',e));
