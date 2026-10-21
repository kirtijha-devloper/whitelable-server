const { expect } = require('chai');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Ledger = require('../models/Ledger');
const Commission = require('../models/Commission');
const PayoutTransaction = require('../models/PayoutTransaction');
const { distributePayoutCommission } = require('../services/payoutCommissionService');
const reportRoutes = require('../routes/reportRoutes');
const ledgerRoutes = require('../routes/ledgerRoutes');

const SECRET = process.env.ACCESS_TOKEN_SECRET || 'testsecret';

describe('Super Franchise Payout & Commission Distribution Flow', () => {
  let app;
  let superFranchiseToken;
  let adminToken;
  let franchiseToken;
  let merchantToken;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.ACCESS_TOKEN_SECRET = SECRET;

    app = express();
    app.use(express.json());
    app.use('/report', reportRoutes);
    app.use('/ledger', ledgerRoutes);
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    });

    adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Super Admin' } }, SECRET);
    superFranchiseToken = jwt.sign({ user: { id: 10, role: 'super_franchise', name: 'Super Franchise' } }, SECRET);
    franchiseToken = jwt.sign({ user: { id: 20, role: 'franchaise', name: 'Franchise' } }, SECRET);
    merchantToken = jwt.sign({ user: { id: 30, role: 'merchant', name: 'Merchant' } }, SECRET);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('distributePayoutCommission', () => {
    it('distributes deducted payout service charge to Franchise, Super Franchise, and Super Admin', async () => {
      const merchant = { id: 30, name: 'Merchant Test', franchaise_id: 20, super_franchise_id: 10 };
      const franchise = { id: 20, name: 'Franchise Test', role: 'franchaise', wallet: 100, super_franchise_id: 10 };
      const superFranchise = { id: 10, name: 'SF Test', role: 'super_franchise', wallet: 200 };
      const superAdmin = { id: 1, name: 'Admin Test', role: 'super_admin', wallet: 500 };

      sinon.stub(User, 'findByPk').callsFake(async (id) => {
        if (id === 30) return merchant;
        if (id === 20) return franchise;
        if (id === 10) return superFranchise;
        if (id === 1) return superAdmin;
        return null;
      });

      sinon.stub(User, 'findOne').callsFake(async (opts) => {
        return superAdmin;
      });

      const updatedWallets = {};
      sinon.stub(User, 'update').callsFake(async (data, opts) => {
        updatedWallets[opts.where.id] = data.wallet;
        return [1];
      });

      const createdLedgers = [];
      sinon.stub(Ledger, 'create').callsFake(async (data) => {
        createdLedgers.push(data);
        return { id: createdLedgers.length, ...data };
      });

      sinon.stub(Ledger, 'findOne').resolves(null);

      const createdCommissions = [];
      sinon.stub(Commission, 'create').callsFake(async (data) => {
        createdCommissions.push(data);
        return { id: createdCommissions.length, ...data };
      });

      const payoutTxn = {
        id: 101,
        reference_id: 'PAYOUT_CRN_101',
        amount: '1000.00',
        service_charge: 10,
        utr: 'UTR123456789',
      };

      const results = await distributePayoutCommission({
        payoutTransaction: payoutTxn,
        merchantId: 30,
        amount: 1000,
        serviceCharge: 10,
        provider: 'Sevenpay',
      });

      expect(results).to.be.an('array');
      expect(results.length).to.equal(3);

      // Franchise commission (30% of ₹10 = ₹3)
      const franchiseRes = results.find(r => r.recipient_id === 20);
      expect(franchiseRes).to.exist;
      expect(franchiseRes.amount).to.equal(3);
      expect(updatedWallets[20]).to.equal(103);

      // Super Franchise commission (20% of ₹10 = ₹2)
      const sfRes = results.find(r => r.recipient_id === 10);
      expect(sfRes).to.exist;
      expect(sfRes.amount).to.equal(2);
      expect(updatedWallets[10]).to.equal(202);

      // Super Admin profit (remainder = ₹5)
      const adminRes = results.find(r => r.recipient_id === 1);
      expect(adminRes).to.exist;
      expect(adminRes.amount).to.equal(5);
      expect(updatedWallets[1]).to.equal(505);

      // Verify created Ledger rows
      expect(createdLedgers.length).to.equal(3);
      expect(createdLedgers[0].transaction_type).to.equal('payout_commission');
      expect(createdLedgers[1].transaction_type).to.equal('payout_commission');
      expect(createdLedgers[2].transaction_type).to.equal('payout_profit');
    });
  });

  describe('Super Franchise Payout Report & Ledger Scoping', () => {
    it('GET /report/payout - includes all downline merchant payouts for Super Franchise', async () => {
      sinon.stub(User, 'findByPk').withArgs(10).resolves({ id: 10, role: 'super_franchise', status: 'active' });
      sinon.stub(User, 'findAll').callsFake(async (opts) => {
        if (opts.where && opts.where.super_franchise_id === 10) {
          return [{ id: 20 }]; // franchise
        }
        return [{ id: 30 }]; // merchant
      });

      let capturedWhere = null;
      sinon.stub(PayoutTransaction, 'findAndCountAll').callsFake(async (opts) => {
        capturedWhere = opts.where;
        return {
          count: 1,
          rows: [
            {
              id: 101,
              merchant_id: 30,
              amount: '1000.00',
              service_charge: 10,
              status: 'SUCCESS',
              createdAt: new Date(),
            }
          ]
        };
      });

      sinon.stub(Ledger, 'findAll').resolves([]);

      const res = await request(app)
        .get('/report/payout?from_date=2026-10-01&to_date=2026-10-17')
        .set('Authorization', `Bearer ${superFranchiseToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(capturedWhere).to.exist;
      expect(capturedWhere.merchant_id).to.exist;
    });

    it('GET /ledger/entries - allows Super Franchise to view downline merchant ledger', async () => {
      sinon.stub(User, 'findByPk').callsFake(async (id) => {
        if (id === 10) return { id: 10, role: 'super_franchise', status: 'active' };
        if (id === 30 || id === '30') return { id: 30, role: 'merchant', super_franchise_id: 10, status: 'active' };
        return null;
      });

      sinon.stub(Ledger, 'findAndCountAll').resolves({
        count: 1,
        rows: [
          {
            id: 1,
            user_id: 30,
            transaction_type: 'payout',
            debit: 1010,
            credit: 0,
            balance: 500,
            createdAt: new Date(),
          }
        ]
      });
      sinon.stub(Ledger, 'findOne').resolves({ balance: 500 });

      const res = await request(app)
        .get('/ledger/entries?user_id=30')
        .set('Authorization', `Bearer ${superFranchiseToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.data).to.be.an('array');
      expect(res.body.data[0].id).to.equal(1);
    });
  });
});
