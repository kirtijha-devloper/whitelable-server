const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const Tpin = require('../models/Tpin');

async function getLatestTpinRecord(userId, { activeOnly = false } = {}) {
  if (!userId) return null;

  const where = { user_id: userId };
  if (activeOnly) {
    where.expires_at = { [Op.gt]: new Date() };
  }

  return Tpin.findOne({
    where,
    order: [
      ['expires_at', 'DESC'],
      ['updatedAt', 'DESC'],
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });
}

async function hasActiveTpin(userId) {
  const record = await getLatestTpinRecord(userId, { activeOnly: true });
  return !!record;
}

async function replaceTpin(userId, plainTpin, expiresAt) {
  await Tpin.destroy({ where: { user_id: userId } });
  const hashTpin = await bcrypt.hash(String(plainTpin), 10);

  return Tpin.create({
    user_id: userId,
    tpin: hashTpin,
    expires_at: expiresAt,
  });
}

async function verifyTpinForUser(userId, submittedTpin) {
  const record = await getLatestTpinRecord(userId);
  if (!record) {
    return { ok: false, reason: 'not_found', record: null };
  }

  if (new Date(record.expires_at) < new Date()) {
    return { ok: false, reason: 'expired', record };
  }

  const normalizedInput = String(submittedTpin).trim();
  let isMatch = false;

  try {
    isMatch = await bcrypt.compare(normalizedInput, record.tpin);
  } catch (_error) {
    isMatch = false;
  }

  // Legacy safety: old rows may have been stored unhashed.
  if (!isMatch && String(record.tpin) === normalizedInput) {
    isMatch = true;
    record.tpin = await bcrypt.hash(normalizedInput, 10);
    await record.save();
  }

  return {
    ok: isMatch,
    reason: isMatch ? 'ok' : 'invalid',
    record,
  };
}

module.exports = {
  getLatestTpinRecord,
  hasActiveTpin,
  replaceTpin,
  verifyTpinForUser,
};
