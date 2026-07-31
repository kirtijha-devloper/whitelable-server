const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const sevenpayService = require('../services/sevenpayPayout.service');
const { encryptJsonPayload, decryptAesFromBase64 } = require('../utils/sevenpayEncryption');

describe('SevenPay Payout Service Tests', () => {
  let axiosGetStub;
  let axiosPostStub;
  let axiosRequestStub;
  let axiosCreateStub;

  beforeEach(() => {
    // Set up env variables
    process.env.SEVENPAY_BASE_URL = 'https://txnapi.sevenpay.in';
    process.env.SEVEN_PAY_SHARED_LOGIN_ID = 'test-login-id';
    process.env.SEVEN_PAY_SHARED_API_KEY = 'test-api-key';
    process.env.SEVENPAY_USERNAME = 'test-user';
    process.env.SEVENPAY_PASSWORD = 'test-password';
    process.env.SEVENPAY_ORG_ID = 'test-org';
    process.env.SEVENPAY_USER_ID = 'test-user-id';
    process.env.SEVENPAY_PUBLIC_KEY_PATH = 'fake-path';

    axiosGetStub = sinon.stub(axios, 'get');
    axiosPostStub = sinon.stub(axios, 'post');
    axiosRequestStub = sinon.stub();
    axiosCreateStub = sinon.stub(axios, 'create').returns({ request: axiosRequestStub });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('login should fetch fresh token from Shared API every time without caching', async () => {
    const mockSharedApiResponse = {
      success: true,
      responseCode: '0',
      token: 'fresh-token-123',
      expiresIn: 3600,
      responseData: {
        userId: 'some-user',
        orgId: 'some-org'
      }
    };

    axiosGetStub.resolves({ data: mockSharedApiResponse });

    // Call 1
    const res1 = await sevenpayService.login();
    expect(res1.token).to.equal('fresh-token-123');
    expect(res1.cached).to.equal(false);

    // Call 2 (should call api again and NOT retrieve from memory cache)
    const mockSharedApiResponse2 = {
      success: true,
      responseCode: '0',
      token: 'fresh-token-456',
      expiresIn: 3600,
      responseData: {
        userId: 'some-user',
        orgId: 'some-org'
      }
    };
    axiosGetStub.resolves({ data: mockSharedApiResponse2 });

    const res2 = await sevenpayService.login();
    expect(res2.token).to.equal('fresh-token-456');
    expect(res2.cached).to.equal(false);

    // Verify axios.get was called exactly twice
    expect(axiosGetStub.callCount).to.equal(2);
    expect(axiosGetStub.firstCall.args[0]).to.equal('https://api.abheepay.com/api/shared/7pay-token');
    expect(axiosGetStub.firstCall.args[1].headers).to.deep.equal({
      'x-7pay-login-id': 'test-login-id',
      'x-7pay-login-api-key': 'test-api-key'
    });
  });

  it('getWalletBalance should fetch balance using encrypted GET request with orgId', async () => {
    const mockSharedApiResponse = {
      success: true,
      responseCode: '0',
      token: 'fresh-token-123',
      expiresIn: 3600,
      responseData: {
        userId: 'some-user',
        orgId: '47716'
      }
    };
    axiosGetStub.resolves({ data: mockSharedApiResponse });

    axiosRequestStub.callsFake(async (config) => {
      expect(config.method).to.equal('get');
      expect(config.url).to.equal('/api/User/GetWalletBalanceAsync');
      expect(config.params).to.deep.equal({ orgId: 47716 });

      return {
        data: JSON.stringify({
          responseCode: '0',
          response: 'Success',
          data: {
            walletBalance: '25000.50'
          },
          errors: null
        })
      };
    });

    const balanceResult = await sevenpayService.getWalletBalance({ orgId: 47716 });
    expect(balanceResult.walletBalance).to.equal('25000.50');
    expect(balanceResult.rawResponse.responseCode).to.equal('0');
  });
});
