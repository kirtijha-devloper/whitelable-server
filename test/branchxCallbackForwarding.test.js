const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const crypto = require('crypto');
const axios = require('axios');

process.env.BRANCHX_CALLBACK_FORWARD_URL = process.env.BRANCHX_CALLBACK_FORWARD_URL || 'https://api.abheepay.com/api/branchx/callback';
process.env.BRANCHX_CALLBACK_ENCRYPTION_KEY = process.env.BRANCHX_CALLBACK_ENCRYPTION_KEY || 'relay-test-key';
process.env.BRANCHX_CALLBACK_ENCRYPTION_IV = process.env.BRANCHX_CALLBACK_ENCRYPTION_IV || 'relay-test-iv';

const branchxRoutes = require('../routes/payments/branchxRoutes');

function deriveKey(secret, size = 32) {
  const secretBuffer = Buffer.from(String(secret), 'utf8');
  if (secretBuffer.length === size) {
    return secretBuffer;
  }

  return crypto.createHash('sha256').update(secretBuffer).digest().subarray(0, size);
}

function deriveIv(ivValue) {
  const ivBuffer = Buffer.from(String(ivValue), 'utf8');
  if (ivBuffer.length === 16) {
    return ivBuffer;
  }

  return crypto.createHash('sha256').update(ivBuffer).digest().subarray(0, 16);
}

function encryptPayload(payload) {
  const key = deriveKey(process.env.BRANCHX_CALLBACK_ENCRYPTION_KEY, 32);
  const iv = deriveIv(process.env.BRANCHX_CALLBACK_ENCRYPTION_IV);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const plainText = JSON.stringify(payload);
  return Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]).toString('base64');
}

describe('BranchX payout callback forwarding', () => {
  const app = express();

  app.use('/api/payment/v2/payout/callback', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json());
  app.use('/api/payment/v2', branchxRoutes);

  let axiosStub;

  beforeEach(() => {
    axiosStub = sinon.stub(axios, 'request').callsFake(async (config) => ({
      status: 200,
      data: { success: true, forwardedTo: config.url },
    }));
  });

  afterEach(() => {
    sinon.restore();
  });

  it('decrypts an encrypted callback body, processes it locally, and forwards it to api.abheepay.com', async () => {
    const decryptedPayload = {
      status: 'SUCCESS',
      message: 'Completed',
      statuscode: '200',
    };

    const encryptedPayload = encryptPayload(decryptedPayload);

    const res = await request(app)
      .post('/api/payment/v2/payout/callback')
      .set('Content-Type', 'text/plain')
      .send(encryptedPayload);

    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal('Missing identifier in callback payload');

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(axiosStub.called).to.equal(true);

    const call = axiosStub.firstCall.args[0];
    expect(call.url).to.equal('https://api.abheepay.com/api/branchx/callback');
    expect(call.method).to.equal('post');
    expect(call.data).to.deep.equal(decryptedPayload);
    expect(call.headers).to.have.property('content-type', 'text/plain');
  });
});
