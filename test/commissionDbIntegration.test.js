const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Ensure test env is active (test-setup.js runs before this file via mocha --file)
const db = require('../config/database');
const CommissionDefault = require('../models/CommissionDefault');
const UserCommission = require('../models/UserCommission');
const User = require('../models/User');

const commissionRoutes = require('../routes/commissionRoutes');

const app = express();
app.use(express.json());
app.use('/api/commission', commissionRoutes);

const adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Admin' } }, process.env.ACCESS_TOKEN_SECRET);
const merchantToken = jwt.sign({ user: { id: 2, role: 'merchant', name: 'Merchant' } }, process.env.ACCESS_TOKEN_SECRET);

describe('commission DB-backed integration', function () {
  this.timeout(5000);

  before(async () => {
    // sync all models with sqlite in-memory
    await db.sync({ force: true });

    // ensure associations exist for include() to work in controller
    CommissionDefault.hasMany(UserCommission, { foreignKey: 'commission_default_id', as: 'userCommissions' });
    UserCommission.belongsTo(CommissionDefault, { foreignKey: 'commission_default_id', as: 'defaultCommission' });

    // create a user
    await User.create({ id: 2, name: 'Merchant', email: 'm@x.com', password: 'x', role: 'merchant' });

    // create global slabs
    await CommissionDefault.create({ payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', payment_mode: 'CARD', min_amount: 0, max_amount: 100, flat_fee: 2, percent_fee: 0 });
    await CommissionDefault.create({ payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', payment_mode: 'CARD', min_amount: 101, max_amount: 10000, flat_fee: 0, percent_fee: 0.5 });
  });

  after(async () => {
    await db.drop();
  });

  it('returns user-linked commission when a link exists', async () => {
    const slab = await CommissionDefault.findOne({ where: { min_amount: 0 } });
    await UserCommission.create({ user_id: 2, commission_default_id: slab.id, is_active: true });

    const res = await request(app)
      .post('/api/commission/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ user_id: 2, paymentCardBrand: 'RUPAY', paymentCardType: 'CREDIT', paymentMode: 'CARD', amount: 50 });

    expect(res.status).to.equal(200);
    expect(res.body.source).to.equal('user');
    expect(res.body.fee.charge).to.equal(2.00);
  });

  it('applies user-specific override when present in UserCommission', async () => {
    const slab = await CommissionDefault.findOne({ where: { min_amount: 0 } });
    // ensure deterministic test state (remove any existing user links created by other tests)
    await UserCommission.destroy({ where: { user_id: 2 } });
    await UserCommission.create({ user_id: 2, commission_default_id: slab.id, is_active: true, flat_fee: 1.25 });

    const res = await request(app)
      .post('/api/commission/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ user_id: 2, paymentCardBrand: 'RUPAY', paymentCardType: 'CREDIT', paymentMode: 'CARD', amount: 50 });

    expect(res.status).to.equal(200);
    expect(res.body.source).to.equal('user');
    expect(res.body.fee.charge).to.equal(1.25);
  });

  it('falls back to default when no user link present', async () => {
    const res = await request(app)
      .post('/api/commission/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ user_id: 3, paymentCardBrand: 'RUPAY', paymentCardType: 'CREDIT', paymentMode: 'CARD', amount: 200 });

    expect(res.status).to.equal(200);
    expect(res.body.source).to.equal('default');
    expect(res.body.fee.charge).to.be.closeTo(1.00, 0.001); // 0.5% of 200
  });
});
