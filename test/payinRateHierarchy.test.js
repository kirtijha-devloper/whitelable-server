const { expect } = require('chai');
const sinon = require('sinon');
const db = require('../config/database');
const ChargeService = require('../services/chargeService');
const ledgerService = require('../services/ledgerService');
const Ledger = require('../models/Ledger');
const User = require('../models/User');
const RazorpayNotification = require('../models/RazorpayNotification');
const PosMachine = require('../models/posMachine');
const MerchantTransactionCharge = require('../models/MerchantTransactionCharge');
const { adminProcessNotificationWithCustomCharge } = require('../controllers/razorpay/webhook/notificationController');

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

    it('Creates pos_admin_earning ledger entry and auto-activates start_ledger if false', async () => {
      let updateCalled = false;
      sinon.stub(User, 'findByPk').resolves({
        id: 2,
        start_ledger: false,
        company_id: 'COMP_1',
        wallet: 500,
        update: async function (fields) {
          if (fields.start_ledger) updateCalled = true;
          Object.assign(this, fields);
        },
        save: async () => {}
      });
      sinon.stub(Ledger, 'findOne').resolves({ balance: 500.0 });
      const createStub = sinon.stub(Ledger, 'create').resolves({
        id: 1000,
        user_id: 2,
        transaction_type: 'pos_admin_earning',
        credit: 25.0,
        balance: 525.0
      });

      const entry = await ledgerService.createAdminEarningEntry({
        userId: 2,
        razorpayTransactionId: 'txn_test_456',
        amount: 25.0,
        description: 'Admin auto-activate test',
        metadata: { admin_id: 2 }
      });

      expect(entry).to.not.be.null;
      expect(updateCalled).to.be.true;
      expect(createStub.calledOnce).to.be.true;
    });
  });

  describe('4. Custom Charge Notification Processing & Floor Validation', () => {
    it('Blocks whitelabel admin if custom rate is lower than Super Admin cost rate', async () => {
      sinon.stub(RazorpayNotification, 'findByPk').resolves({
        id: 101,
        txn_id: 'rzp_txn_floor_test',
        mid: '123',
        tid: '456',
        amount: 1000,
        company_id: 'COMP_1',
        payment_mode: 'CARD',
        event_json: {},
        update: async () => {}
      });
      sinon.stub(MerchantTransactionCharge, 'findOne').resolves(null);
      sinon.stub(PosMachine, 'findAll').resolves([{
        id: 5,
        assigned_to: 10,
        mid_number: '123',
        tid_number: '456',
        company_name: 'POS_CO'
      }]);
      sinon.stub(User, 'findByPk').callsFake(async (id) => {
        if (id === 10) {
          return { id: 10, role: 'merchant', company_id: 'COMP_1', franchaise_id: null, admin_id: 2 };
        }
        if (id === 2) {
          return { id: 2, role: 'admin', company_id: 'COMP_1' };
        }
        return null;
      });
      // Super admin cost for Admin is 1.8% (₹18)
      sinon.stub(ChargeService, 'getSuperAdminChargeRuleForAdmin').resolves({
        charge_percent: 1.8,
        charge_flat: 0
      });

      const req = {
        user: { id: 2, role: 'admin', company_id: 'COMP_1' },
        company: 'COMP_1',
        params: { id: 101 },
        body: { charge_percent: 1.0 } // 1.0% < 1.8%
      };
      let responseStatus = null;
      let responseJson = null;
      const res = {
        status: (code) => { responseStatus = code; return res; },
        json: (data) => { responseJson = data; return res; }
      };

      await adminProcessNotificationWithCustomCharge(req, res);

      expect(responseStatus).to.equal(400);
      expect(responseJson.success).to.be.false;
      expect(responseJson.message).to.include('cannot be less than Super Admin base cost');
    });

    it('Allows whitelabel admin when custom rate >= base cost and distributes earnings', async () => {
      const mockNotification = {
        id: 102,
        txn_id: 'rzp_txn_success_test',
        mid: '123',
        tid: '456',
        amount: 1000,
        company_id: 'COMP_1',
        payment_mode: 'CARD',
        event_json: {},
        update: sinon.stub().resolves()
      };
      sinon.stub(RazorpayNotification, 'findByPk').resolves(mockNotification);
      sinon.stub(MerchantTransactionCharge, 'findOne').resolves(null);
      sinon.stub(MerchantTransactionCharge, 'create').resolves({ id: 888 });
      sinon.stub(PosMachine, 'findAll').resolves([{
        id: 5,
        assigned_to: 10,
        mid_number: '123',
        tid_number: '456',
        company_name: 'POS_CO'
      }]);
      sinon.stub(User, 'findByPk').callsFake(async (id) => {
        if (id === 10) {
          return { id: 10, role: 'merchant', company_id: 'COMP_1', franchaise_id: 20, admin_id: 2 };
        }
        if (id === 20) {
          return { id: 20, role: 'franchise', company_id: 'COMP_1', super_franchise_id: null };
        }
        if (id === 2) {
          return { id: 2, role: 'admin', company_id: 'COMP_1' };
        }
        return null;
      });

      // Franchise buy rate is 1.5% (₹15)
      sinon.stub(ChargeService, 'getAdminChargeRuleForFranchise').resolves({
        charge_percent: 1.5,
        charge_flat: 0
      });
      // Super admin cost for Admin is 1.0% (₹10)
      sinon.stub(ChargeService, 'getSuperAdminChargeRuleForAdmin').resolves({
        charge_percent: 1.0,
        charge_flat: 0
      });

      const razorpayChargeStub = sinon.stub(ledgerService, 'createRazorpayChargeEntry').resolves();
      const franchiseEarnStub = sinon.stub(ledgerService, 'createFranchiseEarningEntry').resolves();
      const adminEarnStub = sinon.stub(ledgerService, 'createAdminEarningEntry').resolves();

      const req = {
        user: { id: 2, role: 'admin', company_id: 'COMP_1' },
        company: 'COMP_1',
        params: { id: 102 },
        body: { charge_percent: 2.0 } // 2% on 1000 = ₹20
      };
      let responseStatus = null;
      let responseJson = null;
      const res = {
        status: (code) => { responseStatus = code; return res; },
        json: (data) => { responseJson = data; return res; }
      };

      await adminProcessNotificationWithCustomCharge(req, res);

      expect(responseStatus).to.equal(200);
      expect(responseJson.success).to.be.true;
      expect(responseJson.data.breakdown.merchantCharge).to.equal(20);
      expect(responseJson.data.breakdown.franchiseEarning).to.equal(5); // 20 - 15 = 5
      expect(responseJson.data.breakdown.adminEarning).to.equal(5);     // 15 - 10 = 5
      expect(responseJson.data.breakdown.superAdminShare).to.equal(10); // 10

      expect(razorpayChargeStub.calledOnce).to.be.true;
      expect(franchiseEarnStub.calledOnce).to.be.true;
      expect(adminEarnStub.calledOnce).to.be.true;
      expect(adminEarnStub.firstCall.args[0].amount).to.equal(5);
    });

    it('Blocks whitelabel admin if custom rate is lower than Franchise rate', async () => {
      sinon.stub(RazorpayNotification, 'findByPk').resolves({
        id: 103,
        txn_id: 'rzp_txn_franchise_floor_test',
        mid: '123',
        tid: '456',
        amount: 1000,
        company_id: 'COMP_1',
        payment_mode: 'CARD',
        event_json: {},
        update: async () => {}
      });
      sinon.stub(MerchantTransactionCharge, 'findOne').resolves(null);
      sinon.stub(PosMachine, 'findAll').resolves([{
        id: 5,
        assigned_to: 10,
        mid_number: '123',
        tid_number: '456',
        company_name: 'POS_CO'
      }]);
      sinon.stub(User, 'findByPk').callsFake(async (id) => {
        if (id === 10) {
          return { id: 10, role: 'merchant', company_id: 'COMP_1', franchaise_id: 20, admin_id: 2 };
        }
        if (id === 20) {
          return { id: 20, role: 'franchise', company_id: 'COMP_1', super_franchise_id: null };
        }
        if (id === 2) {
          return { id: 2, role: 'admin', company_id: 'COMP_1' };
        }
        return null;
      });

      // Super admin cost for Admin is 1.0% (₹10)
      sinon.stub(ChargeService, 'getSuperAdminChargeRuleForAdmin').resolves({
        charge_percent: 1.0,
        charge_flat: 0
      });
      // Franchise buy rate is 1.6% (₹16)
      sinon.stub(ChargeService, 'getAdminChargeRuleForFranchise').resolves({
        charge_percent: 1.6,
        charge_flat: 0
      });

      const req = {
        user: { id: 2, role: 'admin', company_id: 'COMP_1' },
        company: 'COMP_1',
        params: { id: 103 },
        body: { charge_percent: 1.2 } // 1.2% > 1.0% (admin cost) BUT 1.2% < 1.6% (franchise rate)
      };
      let responseStatus = null;
      let responseJson = null;
      const res = {
        status: (code) => { responseStatus = code; return res; },
        json: (data) => { responseJson = data; return res; }
      };

      await adminProcessNotificationWithCustomCharge(req, res);

      expect(responseStatus).to.equal(400);
      expect(responseJson.success).to.be.false;
      expect(responseJson.message).to.include('cannot be less than Franchise rate');
    });

    it('Allows super admin to process custom charge even if below admin rate', async () => {
      const mockNotification = {
        id: 104,
        txn_id: 'rzp_txn_super_admin_test',
        mid: '123',
        tid: '456',
        amount: 1000,
        company_id: 'COMP_1',
        payment_mode: 'CARD',
        event_json: {},
        update: sinon.stub().resolves()
      };
      sinon.stub(RazorpayNotification, 'findByPk').resolves(mockNotification);
      sinon.stub(MerchantTransactionCharge, 'findOne').resolves(null);
      sinon.stub(MerchantTransactionCharge, 'create').resolves({ id: 889 });
      sinon.stub(PosMachine, 'findAll').resolves([{
        id: 5,
        assigned_to: 10,
        mid_number: '123',
        tid_number: '456',
        company_name: 'POS_CO'
      }]);
      sinon.stub(User, 'findByPk').callsFake(async (id) => {
        if (id === 10) {
          return { id: 10, role: 'merchant', company_id: 'COMP_1', franchaise_id: null, admin_id: 2 };
        }
        if (id === 2) {
          return { id: 2, role: 'admin', company_id: 'COMP_1' };
        }
        return null;
      });
      sinon.stub(ChargeService, 'getSuperAdminChargeRuleForAdmin').resolves({
        charge_percent: 1.8,
        charge_flat: 0
      });

      sinon.stub(ledgerService, 'createRazorpayChargeEntry').resolves();

      const req = {
        user: { id: 1, role: 'super_admin' },
        company: null,
        params: { id: 104 },
        body: { charge_percent: 1.0 } // Super admin overrides
      };
      let responseStatus = null;
      let responseJson = null;
      const res = {
        status: (code) => { responseStatus = code; return res; },
        json: (data) => { responseJson = data; return res; }
      };

      await adminProcessNotificationWithCustomCharge(req, res);

      expect(responseStatus).to.equal(200);
      expect(responseJson.success).to.be.true;
    });
  });
});
