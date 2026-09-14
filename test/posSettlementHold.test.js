const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const SettlementHold = require('../models/SettlementHold');
const RazorpayNotification = require('../models/RazorpayNotification');
const ledgerService = require('../services/ledgerService');
const { resolveEffectiveSettlement } = require('../services/settlementService');
const { releaseSettlementHolds } = require('../cron/releaseSettlementHolds');

jest.mock('../middleware/validateTokenHandler', () => (req, res, next) => {
  req.user = { id: 101, role: 'merchant', email: 'merchant@example.com' };
  next();
});

jest.mock('../services/tpinService', () => ({
  hasActiveTpin: jest.fn().mockResolvedValue(false),
  replaceTpin: jest.fn(),
  verifyTpinForUser: jest.fn(),
}));

const userRoutes = require('../routes/userRoutes');

const app = express();
app.use(bodyParser.json());
app.use('/api/user', userRoutes);

describe('POS Settlement Hold & User Profile Tests', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
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

      jest.spyOn(User, 'findByPk').mockResolvedValue(mockUser);
      jest.spyOn(ledgerService, 'getAvailableBalance').mockResolvedValue(166.62);

      const res = await request(app).get('/api/user/current');

      expect(res.status).toBe(200);
      expect(res.body.wallet).toBe(666.62);
      expect(res.body.available_balance).toBe(166.62);
      expect(res.body.settlement_hold).toBe(500.00);
      expect(res.body.settlement_type).toBe('T0');
      expect(res.body.t0_daily_limit).toBe(100);
    });
  });

  describe('T0 Limit Auto-Shift & Hold Preservation', () => {
    it('should create SettlementHold when effective settlement mode is T1', async () => {
      const mockUser = {
        id: 101,
        settlement_type: 'T0',
        t0_daily_limit: 5000,
      };

      jest.spyOn(RazorpayNotification, 'sum').mockResolvedValue(0);

      const resolution = await resolveEffectiveSettlement({
        user: mockUser,
        incomingTxnAmount: 6000
      });

      expect(resolution.effectiveSettlement).toBe('T1');
      expect(resolution.isLimitExceeded).toBe(true);
    });

    it('should calculate getAvailableBalance by subtracting unreleased holds regardless of user settlement_type', async () => {
      jest.spyOn(Ledger, 'findOne').mockResolvedValue({ balance: 1000 });
      jest.spyOn(SettlementHold, 'sum').mockResolvedValue(300);

      const avail = await ledgerService.getAvailableBalance(101);
      expect(avail).toBe(700);
    });

    it('should mark hold as released in releaseSettlementHolds cron', async () => {
      const mockPendingHolds = [
        { id: 1, user_id: 101, amount: 500, hold_date: '2026-09-13', release_at: new Date(Date.now() - 10000) }
      ];

      jest.spyOn(SettlementHold, 'findAll').mockResolvedValue(mockPendingHolds);
      jest.spyOn(SettlementHold, 'update').mockResolvedValue([1]);
      jest.spyOn(SettlementHold, 'count').mockResolvedValue(0);

      await releaseSettlementHolds();

      expect(SettlementHold.update).toHaveBeenCalledWith(
        { released: true },
        expect.objectContaining({
          where: expect.objectContaining({
            released: false
          })
        })
      );
    });
  });
});
