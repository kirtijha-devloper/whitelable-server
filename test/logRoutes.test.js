const { expect } = require('chai');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const adminRoutes = require('../routes/adminRoutes');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');

const app = express();
app.use('/api/admin', adminRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;

function signUser(user) {
  return jwt.sign({ user }, SECRET);
}

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

const adminToken = signUser({ id: 1, role: 'admin', name: 'Admin' });
const merchantToken = signUser({ id: 2, role: 'merchant', name: 'Merchant' });
const employeeLogsToken = signUser({
  id: 3,
  role: 'employee',
  name: 'Ops Employee',
  employee_access_role: {
    id: 9,
    name: 'Ops',
    slug: 'ops',
    status: 'active',
    permissions: [EMPLOYEE_PERMISSIONS.SYSTEM_LOGS_READ],
  },
});

describe('admin log routes', () => {
  let originalLogDir;
  let tempLogDir;

  beforeEach(() => {
    originalLogDir = process.env.LOG_DIR;
    tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-server-logs-'));
    process.env.LOG_DIR = tempLogDir;
  });

  afterEach(() => {
    if (originalLogDir === undefined) {
      delete process.env.LOG_DIR;
    } else {
      process.env.LOG_DIR = originalLogDir;
    }

    fs.rmSync(tempLogDir, { recursive: true, force: true });
  });

  it('lists log files with download URLs for admins', async () => {
    fs.writeFileSync(path.join(tempLogDir, 'app.log'), 'app log');
    fs.writeFileSync(path.join(tempLogDir, 'error.log'), 'error log');
    fs.writeFileSync(path.join(tempLogDir, '.hidden.log'), 'hidden');
    fs.mkdirSync(path.join(tempLogDir, 'archive'));

    const res = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.count).to.equal(2);

    const names = res.body.data.files.map((file) => file.name);
    expect(names).to.have.members(['app.log', 'error.log']);
    expect(names).to.not.include('.hidden.log');

    const appLog = res.body.data.files.find((file) => file.name === 'app.log');
    expect(appLog.download_url).to.equal('/api/admin/logs/app.log/download');
    expect(appLog.size).to.equal(7);
    expect(appLog.modified_at).to.be.a('string');
  });

  it('downloads a selected log file', async () => {
    fs.writeFileSync(path.join(tempLogDir, 'app.log'), 'download me\n');

    const res = await request(app)
      .get('/api/admin/logs/app.log/download')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).to.equal(200);
    expect(res.headers['content-disposition']).to.match(/attachment; filename="app\.log"/);
    expect(res.body.toString()).to.equal('download me\n');
  });

  it('allows employees with the server log permission', async () => {
    fs.writeFileSync(path.join(tempLogDir, 'app.log'), 'app log');

    const res = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${employeeLogsToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data.files.map((file) => file.name)).to.deep.equal(['app.log']);
  });

  it('blocks non-admin users', async () => {
    const res = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(403);
    expect(res.body.message).to.equal('Admin access only.');
  });

  it('rejects path traversal downloads', async () => {
    const res = await request(app)
      .get('/api/admin/logs/..%5Cpackage.json/download')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal('Invalid log filename.');
  });
});
