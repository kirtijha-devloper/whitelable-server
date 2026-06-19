const db = require('../config/database');
const RefSequence = require('../models/RefSequence');
const PayoutReferenceLog = require('../models/PayoutReferenceLog');

const DEFAULT_SERVICE = 'payout';
const DIGIT_COUNT = 10;
const PROVIDER_PREFIX = {
  branchx: 'APB',
  vimo: 'APV',
  credxpay: 'APC',
  sevenpay: 'APS',
};
const DEFAULT_PREFIX = 'APT';

function formatReference(nextNumber, provider) {
  const prefix = PROVIDER_PREFIX[(provider || '').toLowerCase()] || DEFAULT_PREFIX;
  return `${prefix}${String(nextNumber).padStart(DIGIT_COUNT, '0')}`;
}

async function reserveNextSequence({ service = DEFAULT_SERVICE, transaction } = {}) {
  if (!transaction) {
    return db.transaction(async (trx) => reserveNextSequence({ service, transaction: trx }));
  }

  let seqRow = await RefSequence.findOne({
    where: { service },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!seqRow) {
    // Create fallback sequence row if missing. This should be initialized via migrations.
    seqRow = await RefSequence.create({
      service,
      current_number: 2,
      updated_at: new Date(),
    }, { transaction });

    // Return first number.
    return 1;
  }

  const nextNumber = parseInt(seqRow.current_number, 10);
  if (Number.isNaN(nextNumber)) {
    throw new Error(`Invalid reference sequence number for ${service}`);
  }

  seqRow.current_number = nextNumber + 1;
  seqRow.updated_at = new Date();
  await seqRow.save({ transaction });

  return nextNumber;
}

async function getNextPayoutReference(opts = {}) {
  const next = await reserveNextSequence({ service: DEFAULT_SERVICE, ...opts });
  const reference = formatReference(next, opts.provider);

  // Record who generated this reference so transactions can be traced
  // even if the corresponding PayoutTransaction record was never committed.
  await PayoutReferenceLog.create({
    reference,
    sequence_number: next,
    provider: opts.provider || null,
    user_id: opts.userId || null,
  });

  return reference;
}

module.exports = {
  getNextPayoutReference,
  reserveNextSequence,
  formatReference,
};
