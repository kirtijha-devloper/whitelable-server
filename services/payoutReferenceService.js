const db = require('../config/database');
const RefSequence = require('../models/RefSequence');

const DEFAULT_SERVICE = 'payout';
const PREFIX = 'APT';
const DIGIT_COUNT = 10;

function formatReference(nextNumber) {
  return `${PREFIX}${String(nextNumber).padStart(DIGIT_COUNT, '0')}`;
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
  return formatReference(next);
}

module.exports = {
  getNextPayoutReference,
  reserveNextSequence,
  formatReference,
};
