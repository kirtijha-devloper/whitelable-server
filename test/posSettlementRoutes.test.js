const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const adminRoutes = require('../routes/adminRoutes');
const User = require('../models/User');

jest.mock('../middleware/validateTokenHandler', () => (req, res, next) => {
  req.user = { id: 1, role: 'admin', email: 'admin@example.com' };
  next();
});

jest.mock('../middleware/employeePermissionHandler', () => ({
  ensureEmployeePermission: () => (req, res, next) => next()
}));

const app = express();
app.use(bodyParser.json());
app.use('/api/admin', adminRoutes);

describe('POS Settlement Admin Endpoints Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/admin/pos-setting', () => {
    it('should return merchants list and summary statistics', async () => {
      const mockMerchants = [
        {
          id: 101,
          name: 'Merchant 1',
          email: 'm1@example.com',
          role: 'merchant',
          status: 'active',
          settlement_type: 'T0',
          t0_daily_limit: 50000,
          toJSON: () => ({
            id: 101,
            name: 'Merchant 1',
            email: 'm1@example.com',
            role: 'merchant',
            status: 'active',
            settlement_type: 'T0',
            t0_daily_limit: 50000,
          })
        },
        {
          id: 102,
          name: 'Merchant 2',
          email: 'm2@example.com',
          role: 'merchant',
          status: 'active',
          settlement_type: 'T1',
          t0_daily_limit: null,
          toJSON: () => ({
            id: 102,
            name: 'Merchant 2',
            email: 'm2@example.com',
            role: 'merchant',
            status: 'active',
            settlement_type: 'T1',
            t0_daily_limit: null,
          })
        }
      ];

      jest.spyOn(User, 'findAll').mockResolvedValue(mockMerchants);

      const res = await request(app).get('/api/admin/pos-setting');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary).toEqual({
        t0_active_count: 1,
        t1_active_count: 1,
        t0_limit_configured_count: 1,
        total_merchants: 2
      });
      expect(res.body.data.merchants.length).toBe(2);
      expect(res.body.data.merchants[0].email).toBe('m*@example.com');
    });
  });

  describe('POST /api/admin/pos-setting/update-t0-limit', () => {
    it('should update t0_daily_limit for user', async () => {
      const mockUser = {
        id: 101,
        t0_daily_limit: null,
        save: jest.fn().mockResolvedValue(true)
      };

      jest.spyOn(User, 'findByPk').mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/api/admin/pos-setting/update-t0-limit')
        .send({ id: 101, t0_daily_limit: 75000 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUser.t0_daily_limit).toBe(75000);
      expect(mockUser.save).toHaveBeenCalled();
    });

    it('should allow setting t0_daily_limit to null for unlimited', async () => {
      const mockUser = {
        id: 101,
        t0_daily_limit: 50000,
        save: jest.fn().mockResolvedValue(true)
      };

      jest.spyOn(User, 'findByPk').mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/api/admin/pos-setting/update-t0-limit')
        .send({ id: 101, t0_daily_limit: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUser.t0_daily_limit).toBeNull();
    });
  });

  describe('POST /api/admin/pos-setting/update-settlement-type', () => {
    it('should update settlement_type for user', async () => {
      const mockUser = {
        id: 101,
        role: 'merchant',
        settlement_type: 'T1',
        save: jest.fn().mockResolvedValue(true)
      };

      jest.spyOn(User, 'findByPk').mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/api/admin/pos-setting/update-settlement-type')
        .send({ id: 101, settlement_type: 'T0' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUser.settlement_type).toBe('T0');
    });
  });

  describe('POST /api/admin/pos-setting/bulk-settlement', () => {
    it('should bulk update settlement_type for all merchants', async () => {
      jest.spyOn(User, 'update').mockResolvedValue([5]);

      const res = await request(app)
        .post('/api/admin/pos-setting/bulk-settlement')
        .send({ settlement_type: 'T0' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.updated_count).toBe(5);
    });
  });
});
