const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const mxPayoutService = require('../services/payments/mxPayoutService');

describe('MeroRecharge (Payout-M-X) Service Tests', () => {
  let axiosStub;

  beforeEach(() => {
    process.env.MX_BASE_URL = 'https://merorecharge.com';
    process.env.MX_PAYOUT_TOKEN = 'test-payout-token';
    process.env.MX_TRANSACTION_PIN = '9999';

    axiosStub = sinon.stub(axios, 'request');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('normalizeStatus', () => {
    it('should map SUCCESS-like statuses correctly', () => {
      expect(mxPayoutService.normalizeStatus('SUCCESS')).to.equal('SUCCESS');
      expect(mxPayoutService.normalizeStatus('SUCCESSFUL')).to.equal('SUCCESS');
      expect(mxPayoutService.normalizeStatus('COMPLETED')).to.equal('SUCCESS');
    });

    it('should map FAILED-like statuses correctly', () => {
      expect(mxPayoutService.normalizeStatus('FAILED')).to.equal('FAILED');
      expect(mxPayoutService.normalizeStatus('FAILURE')).to.equal('FAILED');
      expect(mxPayoutService.normalizeStatus('REJECTED')).to.equal('FAILED');
      expect(mxPayoutService.normalizeStatus('CANCELLED')).to.equal('FAILED');
    });

    it('should map PENDING-like and unknown statuses to PENDING', () => {
      expect(mxPayoutService.normalizeStatus('PENDING')).to.equal('PENDING');
      expect(mxPayoutService.normalizeStatus('PROCESSING')).to.equal('PENDING');
      expect(mxPayoutService.normalizeStatus('IN_PROGRESS')).to.equal('PENDING');
      expect(mxPayoutService.normalizeStatus('RANDOM_STATUS')).to.equal('PENDING');
      expect(mxPayoutService.normalizeStatus(null)).to.equal('PENDING');
    });
  });

  describe('initiatePayout', () => {
    it('should make correct API call and return normalized response', async () => {
      const mockApiResponse = {
        success: true,
        status: 'PENDING',
        message: 'Payout request submitted',
        requestId: 'BXP-12345',
        payout: {
          payoutId: 987,
          requestId: 'BXP-12345',
          status: 'PENDING'
        }
      };

      axiosStub.resolves({ data: mockApiResponse });

      const payload = {
        accountNo: '1234567890',
        bankIfsc: 'HDFC0001234',
        payeeName: 'Test Beneficiary',
        bankName: 'HDFC Bank',
        amount: '100.00',
        customerMobile: '9876543210',
        transferMode: 'IMPS',
        remark: 'Test Payout'
      };

      const result = await mxPayoutService.initiatePayout(payload);

      expect(result.success).to.be.true;
      expect(result.status).to.equal('PENDING');
      expect(result.requestId).to.equal('BXP-12345');
      expect(result.payoutId).to.equal(987);

      expect(axiosStub.calledOnce).to.be.true;
      const requestConfig = axiosStub.firstCall.args[0];
      expect(requestConfig.method).to.equal('POST');
      expect(requestConfig.url).to.equal('https://merorecharge.com/api/payout-direct');
      expect(requestConfig.headers['X-payout-token']).to.equal('test-payout-token');
      expect(requestConfig.data.transactionPin).to.equal('9999');
    });
  });

  describe('getPayoutStatus', () => {
    it('should query status and normalize response', async () => {
      const mockApiResponse = {
        success: true,
        message: 'Payout status fetched',
        status: 'SUCCESS',
        requestId: 'BXP-12345',
        payout: {
          payoutId: 987,
          requestId: 'BXP-12345',
          status: 'SUCCESS'
        }
      };

      axiosStub.resolves({ data: mockApiResponse });

      const result = await mxPayoutService.getPayoutStatus('BXP-12345');

      expect(result.success).to.be.true;
      expect(result.status).to.equal('SUCCESS');
      expect(result.requestId).to.equal('BXP-12345');
      expect(result.payoutId).to.equal(987);

      expect(axiosStub.calledOnce).to.be.true;
      const requestConfig = axiosStub.firstCall.args[0];
      expect(requestConfig.method).to.equal('POST');
      expect(requestConfig.url).to.equal('https://merorecharge.com/api/payout-status');
      expect(requestConfig.headers['X-payout-token']).to.equal('test-payout-token');
      expect(requestConfig.data.requestId).to.equal('BXP-12345');
    });
  });
});
