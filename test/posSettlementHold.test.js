const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const sinon = require('sinon');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const User = require('../models/User');
const Ledger = require('../models/Ledger');
const SettlementHold = require('../models/SettlementHold');
const RazorpayNotification = require('../models/RazorpayNotification');
const ledgerService = require('../services/ledgerService');
const { resolveEffectiveSettlement } = require('../services/settlementService');
const { releaseSettlementHolds } = require('../cron/releaseSettlementHolds');
const userRoutes = require('../routes/userRoutes');

const app = express();
app.use(bodyParser.json());
app.use('/api/user', userRoutes);

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const merchantToken = jwt.sign({ user: { id: 101, role: 'merchant', email: 'merchant@example.com' } }, SECRET);

describe('POS Settlement Hold & User Profile Tests', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /api/user/current Payload Verification', () => {
    it('should return available_balance, settlement_hold, settlement_type, and t0_daily_limit even when mode is T0', async () => {
      const mockUser = {
        id: 101,
        name: 'Test Merchant',
        email: 'merchant@example.com',
        role: 'merchant',
        wallet: 666.62,
        settlement_type: 'T0',
        t0_daily_limit: 100,
        status: 'active',
        is_approved: true,
        toJSON: function() {
          return {
            id: 101,
            name: 'Test Merchant',
            email: 'merchant@example.com',
            role: 'merchant',
            wallet: 666.62,
            settlement_type: 'T0',
            t0_daily_limit: 100,
            status: 'active',
            is_approved: true,
          };
        }
      };

      sandbox.stub(User, 'findByPk').resolves(mockUser);
      sandbox.stub(ledgerService, 'getAvailableBalance').resolves(166.62);

      const res = await request(app)
        .get('/api/user/current')
        .set('Authorization', `Bearer ${merchantToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.wallet).to.equal(666.62);
      expect(res.body.available_balance).to.equal(166.62);
      expect(res.body.settlement_hold).to.equal(500.00);
      expect(res.body.settlement_type).to.equal('T0');
      expect(res.body.t0_daily_limit).to.equal(100);
    });
  });

  describe('T0 Limit Auto-Shift & Hold Preservation', () => {
    it('should create SettlementHold when effective settlement mode is T1', async () => {
      const mockUser = {
        id: 101,
        settlement_type: 'T0',
        t0_daily_limit: 5000,
      };

      sandbox.stub(RazorpayNotification, 'sum').resolves(0);

      const resolution = await resolveEffectiveSettlement({
        user: mockUser,
        incomingTxnAmount: 6000
      });

      expect(resolution.effectiveSettlement).to.equal('T1');
      expect(resolution.isLimitExceeded).to.be.true;
    });

    it('should calculate getAvailableBalance by subtracting unreleased holds regardless of user settlement_type', async () => {
      sandbox.stub(Ledger, 'findOne').resolves({ balance: 1000 });
      sandbox.stub(SettlementHold, 'sum').resolves(300);

      const avail = await ledgerService.getAvailableBalance(101);
      expect(avail).to.equal(700);
    });

    it('should mark hold as released in releaseSettlementHolds cron', async () => {
      const mockPendingHolds = [
        { id: 1, user_id: 101, amount: 500, hold_date: '2026-09-13', release_at: new Date(Date.now() - 10000) }
      ];

      sandbox.stub(SettlementHold, 'findAll').resolves(mockPendingHolds);
      const updateStub = sandbox.stub(SettlementHold, 'update').resolves([1]);
      sandbox.stub(SettlementHold, 'count').resolves(0);

      await releaseSettlementHolds();

      expect(updateStub.calledOnce).to.be.true;
    });
  });
});
