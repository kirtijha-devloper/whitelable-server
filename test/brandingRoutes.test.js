const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const Company = require('../models/Company');
const User = require('../models/User');
const db = require('../config/database');
const brandingRoutes = require('../routes/brandingRoutes');
const { sanitizeDomain, resolveFullImageUrl } = require('../controllers/brandingController');

describe('Dynamic Tenant Branding & API Test Suite', function () {
  this.timeout(10000);
  let app;

  before(async () => {
    // Ensure Company table is synced in SQLite in-memory test database
    await Company.sync();

    app = express();
    app.use(express.json());
    app.use('/api/branding', brandingRoutes);
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ success: false, message: err.message });
    });
  });

  afterEach(async () => {
    // Clean up test companies created during tests
    await Company.destroy({
      where: {
        company_id: ['COMP_TEST_ALPHA', 'COMP_TEST_BETA', 'COMP_TEST_NOLOGO', 'COMP_TEST_UPDATE', 'COMP_TEST_CREATED'],
      },
    }).catch(() => {});
  });

  describe('Domain Normalization Utilities', () => {
    it('normalizes domain by stripping protocols, ports, www, and query strings', () => {
      expect(sanitizeDomain('https://www.partner.example.com:5001/path?arg=1#hash')).to.equal('partner.example.com');
      expect(sanitizeDomain('HTTP://WWW.TENANT.IO:80/')).to.equal('tenant.io');
      expect(sanitizeDomain('   sub.domain.co.in:3000   ')).to.equal('sub.domain.co.in');
      expect(sanitizeDomain('')).to.equal('');
      expect(sanitizeDomain(null)).to.equal('');
    });

    it('resolves image URLs cleanly for both relative paths and absolute URLs', () => {
      const mockReq = {
        protocol: 'https',
        get: (header) => (header === 'host' ? 'api.portal.com' : null),
      };
      expect(resolveFullImageUrl(mockReq, 'https://res.cloudinary.com/demo/logo.png')).to.equal(
        'https://res.cloudinary.com/demo/logo.png'
      );
      expect(resolveFullImageUrl(mockReq, '/uploads/company_logos/logo1.png')).to.equal(
        'https://api.portal.com/uploads/company_logos/logo1.png'
      );
      expect(resolveFullImageUrl(mockReq, 'uploads/company_logos/logo2.png')).to.equal(
        'https://api.portal.com/uploads/company_logos/logo2.png'
      );
      expect(resolveFullImageUrl(mockReq, null)).to.equal(null);
    });
  });

  describe('GET /api/branding/current - Multi-Tenant Resolution & Isolation', () => {
    let tenantAlpha;
    let tenantBeta;

    beforeEach(async () => {
      tenantAlpha = await Company.create({
        domain_name: 'partner.tenant-alpha.test',
        company_id: 'COMP_TEST_ALPHA',
        company_name: 'Tenant Alpha Enterprises',
        company_logo: 'https://res.cloudinary.com/cloud/image/upload/alpha-logo.png',
        user_id: 991,
        status: 'active',
        payout_limit: 100000,
        bill_payment_limit: 50000,
      });

      tenantBeta = await Company.create({
        domain_name: 'partner.tenant-beta.test',
        company_id: 'COMP_TEST_BETA',
        company_name: 'Tenant Beta Solutions',
        company_logo: '/uploads/company_logos/beta-logo.png',
        user_id: 992,
        status: 'active',
        payout_limit: 200000,
        bill_payment_limit: 75000,
      });
    });

    it('Scenario 1: returns Tenant Alpha actual company branding when requested via Tenant Alpha domain', async () => {
      const res = await request(app)
        .get('/api/branding/current')
        .set('Host', 'partner.tenant-alpha.test');

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data).to.be.an('object');
      expect(res.body.data.companyName).to.equal('Tenant Alpha Enterprises');
      expect(res.body.data.companyLogoUrl).to.equal('https://res.cloudinary.com/cloud/image/upload/alpha-logo.png');
      expect(res.body.data.domain).to.equal('partner.tenant-alpha.test');
      expect(res.body.data.isDefault).to.equal(false);
    });

    it('Scenario 2: returns Tenant Beta actual company branding when requested via Tenant Beta domain', async () => {
      const res = await request(app)
        .get('/api/branding/current')
        .set('Host', 'partner.tenant-beta.test');

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data.companyName).to.equal('Tenant Beta Solutions');
      expect(res.body.data.companyLogoUrl).to.include('/uploads/company_logos/beta-logo.png');
      expect(res.body.data.domain).to.equal('partner.tenant-beta.test');
      expect(res.body.data.isDefault).to.equal(false);
    });

    it('Scenario 3: strict tenant isolation - two registered tenants never receive each other branding', async () => {
      const resAlpha = await request(app)
        .get('/api/branding/current')
        .set('Host', 'partner.tenant-alpha.test');

      const resBeta = await request(app)
        .get('/api/branding/current')
        .set('Host', 'partner.tenant-beta.test');

      expect(resAlpha.body.data.companyName).to.equal('Tenant Alpha Enterprises');
      expect(resAlpha.body.data.companyName).to.not.equal(resBeta.body.data.companyName);
      expect(resAlpha.body.data.companyLogoUrl).to.not.equal(resBeta.body.data.companyLogoUrl);
      expect(resAlpha.body.data.domain).to.not.equal(resBeta.body.data.domain);
    });

    it('Scenario 4: handles domain normalization with ports, uppercase, and www. prefix', async () => {
      const resUpper = await request(app)
        .get('/api/branding/current')
        .set('Host', 'PARTNER.TENANT-ALPHA.TEST:5001');

      expect(resUpper.status).to.equal(200);
      expect(resUpper.body.data.companyName).to.equal('Tenant Alpha Enterprises');

      const resWww = await request(app)
        .get('/api/branding/current')
        .set('Host', 'www.partner.tenant-alpha.test');

      expect(resWww.status).to.equal(200);
      expect(resWww.body.data.companyName).to.equal('Tenant Alpha Enterprises');
    });

    it('Scenario 5: unknown domain safely returns default unbranded fallback without data leakage', async () => {
      const resUnknown = await request(app)
        .get('/api/branding/current')
        .set('Host', 'unregistered-domain.example.org');

      expect(resUnknown.status).to.equal(200);
      expect(resUnknown.body.success).to.equal(true);
      expect(resUnknown.body.data.companyName).to.equal('ABHEEPAY');
      expect(resUnknown.body.data.companyLogoUrl).to.equal(null);
      expect(resUnknown.body.data.faviconUrl).to.equal(null);
      expect(resUnknown.body.data.isDefault).to.equal(true);
      // Ensures no tenant data leaked
      expect(resUnknown.body.data.companyName).to.not.equal('Tenant Alpha Enterprises');
      expect(resUnknown.body.data.companyName).to.not.equal('Tenant Beta Solutions');
    });

    it('Scenario 6: missing logo falls back correctly without breaking response', async () => {
      await Company.create({
        domain_name: 'partner.nologo-tenant.test',
        company_id: 'COMP_TEST_NOLOGO',
        company_name: 'No Logo Tenant',
        company_logo: null,
        user_id: 993,
        status: 'active',
      });

      const res = await request(app)
        .get('/api/branding/current')
        .set('Host', 'partner.nologo-tenant.test');

      expect(res.status).to.equal(200);
      expect(res.body.data.companyName).to.equal('No Logo Tenant');
      expect(res.body.data.companyLogoUrl).to.equal(null);
      expect(res.body.data.faviconUrl).to.equal(null);
      expect(res.body.data.isDefault).to.equal(false);
    });

    it('Scenario 7: logo update changes the branding returned by the API', async () => {
      const initialRes = await request(app)
        .get('/api/branding/current')
        .set('Host', 'partner.tenant-alpha.test');
      expect(initialRes.body.data.companyLogoUrl).to.equal('https://res.cloudinary.com/cloud/image/upload/alpha-logo.png');

      // Update logo in database
      await tenantAlpha.update({
        company_logo: 'https://res.cloudinary.com/cloud/image/upload/alpha-logo-v2.png',
        company_name: 'Tenant Alpha Rebranded',
      });

      const updatedRes = await request(app)
        .get('/api/branding/current')
        .set('Host', 'partner.tenant-alpha.test');
      expect(updatedRes.body.data.companyName).to.equal('Tenant Alpha Rebranded');
      expect(updatedRes.body.data.companyLogoUrl).to.equal('https://res.cloudinary.com/cloud/image/upload/alpha-logo-v2.png');
    });

    it('Scenario 8: local dev explicit override resolves test domain on localhost', async () => {
      const res = await request(app)
        .get('/api/branding/current?dev_domain=partner.tenant-alpha.test')
        .set('Host', 'localhost:5173');

      expect(res.status).to.equal(200);
      expect(res.body.data.companyName).to.equal('Tenant Alpha Enterprises');
      expect(res.body.data.isDefault).to.equal(false);
    });
  });

  describe('Security & Proxy Header Handling', () => {
    it('Scenario 9: ignores untrusted X-Forwarded-Host when trust proxy is false in production', async () => {
      const prodApp = express();
      prodApp.set('trust proxy', false);
      prodApp.use('/api/branding', brandingRoutes);

      const savedEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const res = await request(prodApp)
          .get('/api/branding/current')
          .set('Host', 'real-domain.com')
          .set('X-Forwarded-Host', 'spoofed-domain.com');

        expect(res.status).to.equal(200);
        // Resolved domain must be real-domain.com, NOT spoofed-domain.com
        expect(res.body.data.domain).to.equal('real-domain.com');
      } finally {
        process.env.NODE_ENV = savedEnv;
      }
    });

    it('Scenario 10: does not allow client-supplied dev_domain query to override in production', async () => {
      const prodApp = express();
      prodApp.use('/api/branding', brandingRoutes);

      const savedEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const res = await request(prodApp)
          .get('/api/branding/current?dev_domain=partner.tenant-alpha.test')
          .set('Host', 'unregistered.prod.domain.com');

        expect(res.status).to.equal(200);
        // In production, query parameter override is rejected; domain remains unregistered.prod.domain.com
        expect(res.body.data.domain).to.equal('unregistered.prod.domain.com');
        expect(res.body.data.isDefault).to.equal(true);
      } finally {
        process.env.NODE_ENV = savedEnv;
      }
    });
  });

  describe('Logo Upload Validation', () => {
    const { validateImageFile } = require('../controllers/superAdminController');

    it('Scenario 11: accepts valid image formats (PNG, JPG, JPEG, WEBP, SVG)', () => {
      expect(() => validateImageFile({ name: 'logo.png', mimetype: 'image/png', size: 1024 * 50 })).to.not.throw();
      expect(() => validateImageFile({ name: 'logo.jpg', mimetype: 'image/jpeg', size: 1024 * 100 })).to.not.throw();
      expect(() => validateImageFile({ name: 'logo.webp', mimetype: 'image/webp', size: 1024 * 30 })).to.not.throw();
      expect(() => validateImageFile({ name: 'logo.svg', mimetype: 'image/svg+xml', size: 1024 * 5 })).to.not.throw();
    });

    it('Scenario 12: rejects non-image files with 400 Bad Request', () => {
      expect(() => validateImageFile({ name: 'doc.pdf', mimetype: 'application/pdf', size: 1024 })).to.throw(/valid image file/);
      expect(() => validateImageFile({ name: 'script.exe', mimetype: 'application/x-msdownload', size: 1024 })).to.throw(/valid image file/);
      expect(() => validateImageFile({ name: 'notes.txt', mimetype: 'text/plain', size: 1024 })).to.throw(/valid image file/);
    });

    it('Scenario 13: rejects oversized logo files exceeding 5MB', () => {
      const oversizedFile = {
        name: 'huge-logo.png',
        mimetype: 'image/png',
        size: 6 * 1024 * 1024,
      };
      expect(() => validateImageFile(oversizedFile)).to.throw(/exceeds maximum allowed size of 5MB/);
    });
  });

  describe('Admin Creation Flow & Branding Persistence Verification', () => {
    it('Scenario 14: persists company name, domain, and logo in Company record and verifies API returns it', async () => {
      const createdCompany = await Company.create({
        domain_name: 'partner.new-company.test',
        company_id: 'COMP_TEST_CREATED',
        company_name: 'New Custom Company',
        company_logo: 'https://res.cloudinary.com/cloud/image/upload/new-logo.png',
        user_id: 994,
        status: 'active',
        payout_limit: 100000,
        bill_payment_limit: 50000,
      });

      expect(createdCompany.id).to.be.a('number');
      expect(createdCompany.company_name).to.equal('New Custom Company');
      expect(createdCompany.domain_name).to.equal('partner.new-company.test');
      expect(createdCompany.company_logo).to.equal('https://res.cloudinary.com/cloud/image/upload/new-logo.png');

      const res = await request(app)
        .get('/api/branding/current')
        .set('Host', 'partner.new-company.test');

      expect(res.status).to.equal(200);
      expect(res.body.data.companyName).to.equal('New Custom Company');
      expect(res.body.data.companyLogoUrl).to.equal('https://res.cloudinary.com/cloud/image/upload/new-logo.png');
      expect(res.body.data.domain).to.equal('partner.new-company.test');
    });
  });
});
