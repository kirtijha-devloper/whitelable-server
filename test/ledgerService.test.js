'use strict';

const { expect } = require('chai');
const { Op } = require('sequelize');

const ledgerService = require('../services/ledgerService');
const Ledger = require('../models/Ledger');

describe('ledgerService.getLedgerEntries', () => {
  let originalFindAndCountAll;

  beforeEach(() => {
    originalFindAndCountAll = Ledger.findAndCountAll;
  });

  afterEach(() => {
    Ledger.findAndCountAll = originalFindAndCountAll;
  });

  it('uses IST business-day boundaries for startDate and endDate', async () => {
    let capturedWhere;
    Ledger.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };

    await ledgerService.getLedgerEntries({
      userId: 33,
      startDate: '2026-04-22',
      endDate: '2026-04-22',
    });

    expect(capturedWhere.user_id).to.equal(33);
    expect(capturedWhere.createdAt[Op.gte].toISOString()).to.equal('2026-04-21T18:30:00.000Z');
    expect(capturedWhere.createdAt[Op.lte].toISOString()).to.equal('2026-04-22T18:29:59.999Z');
  });

  it('throws a 400-style error for invalid date input', async () => {
    try {
      await ledgerService.getLedgerEntries({
        userId: 33,
        startDate: '2026-13-22',
      });
      throw new Error('Expected getLedgerEntries to reject invalid dates');
    } catch (error) {
      expect(error.statusCode).to.equal(400);
      expect(error.message).to.match(/invalid date format/i);
    }
  });
});
