const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const sendOtpUtils = require('../utils/sendOtp');
const mailUtils = require('../utils/mail');
sendOtpUtils.sendRegistrationSms = async () => ({ success: true });
mailUtils.sendMail = async () => ({ accepted: ['test@example.com'] });

const adminRoutes = require('../routes/adminRoutes');
const userRoutes = require('../routes/userRoutes');
const LoginPopup = require('../models/LoginPopup');
const { LOGIN_POPUP_UPLOAD_DIR } = require('../middleware/loginPopupUpload');

const app = express();
app.use(express.json({ strict: false }));
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Admin' } }, SECRET);
const merchantToken = jwt.sign({ user: { id: 2, role: 'merchant', name: 'Merchant' } }, SECRET);

function getSampleImagePath() {
  const uploadsDir = path.resolve(__dirname, '..', 'uploads');
  const fileName = fs.readdirSync(uploadsDir)
    .find((name) => /\.(png|jpg|jpeg|webp|gif)$/i.test(name));

  if (!fileName) {
    throw new Error('Could not find a sample image in uploads/.');
  }

  return path.join(uploadsDir, fileName);
}

function cleanupTestUploadDir() {
  const uploadDir = path.resolve(LOGIN_POPUP_UPLOAD_DIR);

  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
}

let stubs = {};

beforeEach(() => {
  stubs = {
    create: LoginPopup.create,
    findAll: LoginPopup.findAll,
    findByPk: LoginPopup.findByPk,
  };
});

afterEach(() => {
  LoginPopup.create = stubs.create;
  LoginPopup.findAll = stubs.findAll;
  LoginPopup.findByPk = stubs.findByPk;
  cleanupTestUploadDir();
});

describe('Login popup routes', () => {
  it('allows admin to upload a login popup image', async () => {
    const sampleImagePath = getSampleImagePath();

    LoginPopup.create = async (payload) => ({
      id: 1,
      ...payload,
      created_at: new Date('2026-04-07T10:00:00.000Z'),
      updated_at: new Date('2026-04-07T10:00:00.000Z'),
      toJSON() {
        return { ...this };
      },
    });

    const res = await request(app)
      .post('/api/admin/login-popups')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title', 'Festival Offer')
      .field('display_order', '1')
      .field('is_active', 'true')
      .field('target_roles', 'merchant,franchise')
      .attach('image', sampleImagePath);

    expect(res.status).to.equal(201);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.title).to.equal('Festival Offer');
    expect(res.body.data.display_order).to.equal(1);
    expect(res.body.data.is_active).to.equal(true);
    expect(res.body.data.target_roles).to.deep.equal(['merchant', 'franchaise']);
    expect(res.body.data.image_url).to.match(/\/uploads\/test-login-popups\//);
  });

  it('returns active login popups filtered by current user role in order', async () => {
    LoginPopup.findAll = async () => ([
      {
        id: 3,
        title: 'All Roles Popup',
        image_path: 'uploads/test-login-popups/all.png',
        display_order: 1,
        is_active: true,
        starts_at: null,
        ends_at: null,
        target_roles: null,
        created_at: new Date('2026-04-07T10:00:00.000Z'),
        updated_at: new Date('2026-04-07T10:00:00.000Z'),
      },
      {
        id: 4,
        title: 'Merchant Popup',
        image_path: 'uploads/test-login-popups/merchant.png',
        display_order: 2,
        is_active: true,
        starts_at: null,
        ends_at: null,
        target_roles: ['merchant', 'franchaise'],
        created_at: new Date('2026-04-07T10:05:00.000Z'),
        updated_at: new Date('2026-04-07T10:05:00.000Z'),
      },
      {
        id: 5,
        title: 'Admin Popup',
        image_path: 'uploads/test-login-popups/admin.png',
        display_order: 3,
        is_active: true,
        starts_at: null,
        ends_at: null,
        target_roles: ['admin'],
        created_at: new Date('2026-04-07T10:10:00.000Z'),
        updated_at: new Date('2026-04-07T10:10:00.000Z'),
      },
    ]);

    const res = await request(app)
      .get('/api/user/login-popups')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.map((popup) => popup.id)).to.deep.equal([3, 4]);
  });

  it('allows admin to update popup metadata without re-uploading image', async () => {
    const popup = {
      id: 8,
      title: 'Old Title',
      image_path: 'uploads/test-login-popups/original.png',
      display_order: 1,
      is_active: true,
      starts_at: null,
      ends_at: null,
      target_roles: null,
      created_at: new Date('2026-04-07T10:00:00.000Z'),
      updated_at: new Date('2026-04-07T10:00:00.000Z'),
      async update(payload) {
        Object.assign(this, payload, { updated_at: new Date('2026-04-07T11:00:00.000Z') });
        return this;
      },
      toJSON() {
        return { ...this };
      },
    };

    LoginPopup.findByPk = async () => popup;

    const res = await request(app)
      .put('/api/admin/login-popups/8')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'New Title',
        display_order: 5,
        is_active: false,
        target_roles: ['employee'],
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.title).to.equal('New Title');
    expect(res.body.data.display_order).to.equal(5);
    expect(res.body.data.is_active).to.equal(false);
    expect(res.body.data.target_roles).to.deep.equal(['employee']);
  });

  it('allows admin to delete a popup', async () => {
    const popup = {
      id: 9,
      image_path: 'uploads/test-login-popups/delete-me.png',
      async destroy() {
        return true;
      },
      toJSON() {
        return { ...this };
      },
    };

    LoginPopup.findByPk = async () => popup;

    const res = await request(app)
      .delete('/api/admin/login-popups/9')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.message).to.match(/deleted successfully/i);
  });
});
