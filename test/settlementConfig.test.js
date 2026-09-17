const { expect } = require('chai');
const {
  checkIsCutoffPassed,
  getUsableMainWalletBalance,
  deductUsableBalance,
} = require('../services/settlementService');

describe('Settlement Config & Cutoff Logic Unit Tests', () => {
  describe('checkIsCutoffPassed', () => {
    it('should return true if no cutoff is provided', () => {
      expect(checkIsCutoffPassed(null)).to.equal(true);
      expect(checkIsCutoffPassed('')).to.equal(true);
    });

    it('should return true when current time is after cutoff time', () => {
      const now = new Date('2026-09-17T11:00:00+05:30'); // 11:00 AM IST
      expect(checkIsCutoffPassed('10:00', now)).to.equal(true);
    });

    it('should return false when current time is before cutoff time', () => {
      const now = new Date('2026-09-17T09:00:00+05:30'); // 09:00 AM IST
      expect(checkIsCutoffPassed('10:00', now)).to.equal(false);
    });
  });

  describe('getUsableMainWalletBalance', () => {
    it('should return full wallet balance after cutoff time', async () => {
      const mockUser = {
        id: 1,
        wallet: 5000.00,
        prev_day_settled_balance: 1000.00,
        cutoff_timestamp: '10:00',
      };
      const afterCutoff = new Date('2026-09-17T11:00:00+05:30');
      const usable = await getUsableMainWalletBalance(mockUser, afterCutoff);
      expect(usable).to.equal(5000.00);
    });

    it('should return Math.min(wallet, prev_day_settled_balance) before cutoff time', async () => {
      const mockUser = {
        id: 1,
        wallet: 5000.00,
        prev_day_settled_balance: 1500.00,
        cutoff_timestamp: '10:00',
      };
      const beforeCutoff = new Date('2026-09-17T09:00:00+05:30');
      const usable = await getUsableMainWalletBalance(mockUser, beforeCutoff);
      expect(usable).to.equal(1500.00);
    });
  });
});
