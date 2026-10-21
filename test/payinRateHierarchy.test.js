const { expect } = require('chai');
const sinon = require('sinon');
const db = require('../config/database');
const ChargeService = require('../services/chargeService');
const ledgerService = require('../services/ledgerService');
const Ledger = require('../models/Ledger');
const User = require('../models/User');

describe('Pay-In Rate Hierarchy & Earning Engine Tests', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('1. Rule Specificity and Hierarchy Precedence', () => {
    it('Specific Merchant Override beats Super Admin Global Default', async () => {
      const mockRules = [
        {
          id: 1,
          scope: 'admin_merchant',
          user_id: 30,
          charge_percent: 2.5,
          specificity: 19084
        },
        {
          id: 2,
          scope: 'super_admin_default',
          user_id: null,
          charge_percent: 1.8,
          specificity: 19016
        }
      ];

      sinon.stub(db, 'query').resolves(mockRules);

      const resolved = await ChargeService.getTransactionChargeRule({
        userId: 30,
        userRole: 'merchant',
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'VISA',
        amount: 1000
      });

      expect(resolved).to.not.be.null;
      expect(resolved.id).to.equal(1);
      expect(resolved.scope).to.equal('admin_merchant');
      expect(parseFloat(resolved.charge_percent)).to.equal(2.5);
    });

    it('Franchise Merchant Override beats Admin Merchant Override', async () => {
      const mockRules = [
        {
          id: 10,
          scope: 'franchise_merchant',
          user_id: 30,
          charge_percent: 2.8,
          specificity: 19096
        },
        {
          id: 11,
          scope: 'admin_merchant',
          user_id: 30,
          charge_percent: 2.5,
          specificity: 19084
        }
      ];

      sinon.stub(db, 'query').resolves(mockRules);

      const resolved = await ChargeService.getTransactionChargeRule({
        userId: 30,
        userRole: 'merchant',
        franchiseId: 20,
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'VISA',
        amount: 1000
      });

      expect(resolved).to.not.be.null;
      expect(resolved.id).to.equal(10);
      expect(resolved.scope).to.equal('franchise_merchant');
      expect(parseFloat(resolved.charge_percent)).to.equal(2.8);
    });
  });

  describe('2. Super Admin Charge Rule for Admin Resolution', () => {
    it('Resolves super_admin_admin override when configured for Admin', async () => {
      const mockRules = [
        {
          id: 50,
          scope: 'super_admin_admin',
          user_id: 2,
          charge_percent: 1.4,
          specificity: 19024
        }
      ];

      sinon.stub(db, 'query').resolves(mockRules);

      const resolved = await ChargeService.getSuperAdminChargeRuleForAdmin({
        adminId: 2,
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'VISA',
        amount: 1000
      });

      expect(resolved).to.not.be.null;
      expect(resolved.id).to.equal(50);
      expect(resolved.scope).to.equal('super_admin_admin');
      expect(parseFloat(resolved.charge_percent)).to.equal(1.4);
    });

    it('Falls back to super_admin_default when no override exists for Admin', async () => {
      const mockRules = [
        {
          id: 51,
          scope: 'super_admin_default',
          user_id: null,
          charge_percent: 1.6,
          specificity: 19008
        }
      ];

      sinon.stub(db, 'query').resolves(mockRules);

      const resolved = await ChargeService.getSuperAdminChargeRuleForAdmin({
        adminId: 2,
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'VISA',
        amount: 1000
      });

      expect(resolved).to.not.be.null;
      expect(resolved.id).to.equal(51);
      expect(resolved.scope).to.equal('super_admin_default');
      expect(parseFloat(resolved.charge_percent)).to.equal(1.6);
    });
  });

  describe('3. Admin Earning Ledger Entry Creation', () => {
    it('Creates pos_admin_earning ledger entry with correct amount', async () => {
      sinon.stub(User, 'findByPk').resolves({
        id: 2,
        start_ledger: true,
        company_id: 'COMP_1',
        wallet: 500,
        save: async () => {}
      });
      sinon.stub(Ledger, 'findOne').resolves({ balance: 500.0 });
      const createStub = sinon.stub(Ledger, 'create').resolves({
        id: 999,
        user_id: 2,
        transaction_type: 'pos_admin_earning',
        credit: 30.0,
        balance: 530.0
      });

      const entry = await ledgerService.createAdminEarningEntry({
        userId: 2,
        razorpayTransactionId: 'txn_test_123',
        amount: 30.0,
        description: 'Admin earning test',
        metadata: { admin_id: 2 }
      });

      expect(entry).to.not.be.null;
      expect(createStub.calledOnce).to.be.true;
      const calledArgs = createStub.firstCall.args[0];
      expect(calledArgs.user_id).to.equal(2);
      expect(calledArgs.transaction_type).to.equal('pos_admin_earning');
      expect(calledArgs.credit).to.equal(30.0);
    });
  });
});
