const db = require('../config/database');
const User = require('../models/User');
const Company = require('../models/Company');
const AdminCcBillDailyLimit = require('../models/AdminCcBillDailyLimit');
const CcBillLimitReservation = require('../models/CcBillLimitReservation');
const { IST_OFFSET_MINUTES } = require('../utils/dateRange');

/**
 * Returns current business date in IST (Asia/Kolkata, UTC+5:30) as YYYY-MM-DD.
 */
function getBusinessDate(inputDate = new Date()) {
  const d = inputDate instanceof Date ? inputDate : new Date(inputDate);
  const istTime = new Date(d.getTime() + (IST_OFFSET_MINUTES || 330) * 60 * 1000);
  return istTime.toISOString().slice(0, 10);
}

/**
 * Monetary helpers for INR-safe integer paise arithmetic.
 */
function toPaise(amount) {
  const num = Number(amount);
  if (Number.isNaN(num)) return 0;
  return Math.round(num * 100);
}

function fromPaise(paise) {
  const num = Number(paise);
  if (Number.isNaN(num)) return 0;
  return Number((num / 100).toFixed(2));
}

const adminLocks = new Map();

/**
 * Sequential lock queue per Admin to serialize reservation evaluation,
 * protecting against database lock contention and SQLite single-connection constraints.
 */
async function withAdminLock(adminId, fn) {
  const key = String(adminId || 'global');
  const prev = adminLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const chained = prev.then(() => current, () => current);
  adminLocks.set(key, chained);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (adminLocks.get(key) === chained) {
      adminLocks.delete(key);
    }
  }
}

/**
 * Server-side trusted resolution of owning Admin from user hierarchy.
 * Never trusts client-supplied admin_id or ownership claims.
 *
 * Hierarchy:
 * Super Admin -> Admin -> Super Franchise -> Franchise -> Merchant (and Employee)
 */
async function resolveOwningAdmin(userOrUserId, options = {}) {
  const { transaction = null } = options;

  let user = userOrUserId;
  if (!user || typeof user !== 'object' || !user.role) {
    const userId = typeof userOrUserId === 'object' ? userOrUserId?.id : userOrUserId;
    if (!userId) {
      throw new Error('User identity is required to resolve Admin ownership.');
    }
    user = await User.findByPk(userId, { transaction });
  } else if (!user.company_id || !user.role) {
    // If partial user object was passed, refresh from database
    user = await User.findByPk(user.id, { transaction });
  }

  if (!user) {
    throw new Error('Authenticated user record not found in database.');
  }

  if (user.status && user.status !== 'active') {
    throw new Error('User account is inactive. CC bill operations are not allowed.');
  }

  const role = String(user.role || '').toLowerCase().trim();

  // 1. Direct Admin user
  if (role === 'admin') {
    let company = null;
    if (user.company_id) {
      company = await Company.findOne({ where: { company_id: user.company_id }, transaction });
    }
    if (!company) {
      company = await Company.findOne({ where: { user_id: user.id }, transaction });
    }
    return { adminUser: user, company };
  }

  // 2. Resolve via user.company_id (covers Super Franchise, Franchise, Merchant, Employee)
  let companyId = user.company_id || null;

  // 3. If user.company_id is null, traverse hierarchy upwards
  if (!companyId && user.franchaise_id) {
    const franchise = await User.findByPk(user.franchaise_id, { transaction });
    if (franchise && franchise.company_id) {
      companyId = franchise.company_id;
    }
  }

  if (!companyId && user.super_franchise_id) {
    const superFranchise = await User.findByPk(user.super_franchise_id, { transaction });
    if (superFranchise && superFranchise.company_id) {
      companyId = superFranchise.company_id;
    }
  }

  if (!companyId) {
    throw new Error(`Cannot resolve valid Admin mapping for user ${user.id} (${role}): missing company identifier.`);
  }

  // Look up Company and Admin user
  const company = await Company.findOne({ where: { company_id: companyId }, transaction });

  let adminUser = null;
  if (company && company.user_id) {
    adminUser = await User.findOne({
      where: { id: company.user_id, role: 'admin' },
      transaction,
    });
  }

  if (!adminUser) {
    adminUser = await User.findOne({
      where: { company_id: companyId, role: 'admin' },
      transaction,
    });
  }

  if (!adminUser) {
    throw new Error(`Cannot resolve valid Admin user for company '${companyId}'. CC bill operations require a valid Admin mapping.`);
  }

  if (adminUser.status !== 'active') {
    throw new Error(`Owning Admin (${adminUser.name || adminUser.id}) is inactive. CC bill operations are blocked.`);
  }

  return { adminUser, company };
}

/**
 * Ensures daily counter exists in the database.
 * If called without a transaction before starting the row-level lock transaction,
 * a unique constraint race between multi-process workers is cleanly resolved without
 * placing any outer transaction into Postgres aborted-state.
 */
async function ensureDailyCounterExists(adminId, businessDate, company = null) {
  let counter = await AdminCcBillDailyLimit.findOne({
    where: { admin_id: adminId, business_date: businessDate },
  });
  if (counter) return counter;

  let configuredDailyLimit = 0.00;
  if (company?.bill_payment_limit !== undefined && company?.bill_payment_limit !== null) {
    configuredDailyLimit = parseFloat(company.bill_payment_limit);
  } else {
    const adminUser = await User.findByPk(adminId);
    let comp = null;
    if (adminUser?.company_id) {
      comp = await Company.findOne({ where: { company_id: adminUser.company_id } });
    }
    if (!comp && adminId) {
      comp = await Company.findOne({ where: { user_id: adminId } });
    }
    if (comp?.bill_payment_limit !== undefined && comp?.bill_payment_limit !== null) {
      configuredDailyLimit = parseFloat(comp.bill_payment_limit);
    }
  }

  try {
    counter = await AdminCcBillDailyLimit.create({
      admin_id: adminId,
      company_id: company?.company_id || null,
      business_date: businessDate,
      daily_limit: configuredDailyLimit,
      consumed_amount: 0.00,
      reserved_amount: 0.00,
    });
  } catch (_err) {
    counter = await AdminCcBillDailyLimit.findOne({
      where: { admin_id: adminId, business_date: businessDate },
    });
  }
  return counter;
}

/**
 * Load or initialize daily counter for an Admin and business date.
 */
async function getOrCreateDailyCounter(adminId, businessDate, options = {}) {
  const { transaction = null, lock = false } = options;

  let counter = await AdminCcBillDailyLimit.findOne({
    where: { admin_id: adminId, business_date: businessDate },
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });

  if (counter) {
    return counter;
  }

  // If not found, initialize from Company configured bill_payment_limit
  const adminUser = await User.findByPk(adminId, { transaction });
  let company = null;
  if (adminUser?.company_id) {
    company = await Company.findOne({ where: { company_id: adminUser.company_id }, transaction });
  }
  if (!company && adminId) {
    company = await Company.findOne({ where: { user_id: adminId }, transaction });
  }

  const configuredDailyLimit = company?.bill_payment_limit !== undefined && company?.bill_payment_limit !== null
    ? parseFloat(company.bill_payment_limit)
    : 0.00;

  try {
    counter = await AdminCcBillDailyLimit.create({
      admin_id: adminId,
      company_id: company?.company_id || adminUser?.company_id || null,
      business_date: businessDate,
      daily_limit: configuredDailyLimit,
      consumed_amount: 0.00,
      reserved_amount: 0.00,
    }, { transaction });
  } catch (_err) {
    // If concurrent insert created it, re-query
    counter = await AdminCcBillDailyLimit.findOne({
      where: { admin_id: adminId, business_date: businessDate },
      transaction,
      ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    });
  }

  return counter;
}

/**
 * Atomically validate capacity and reserve requested amount before provider call.
 */
async function reserveLimit({ userId, amount, flow, referenceId, transaction = null }) {
  const parsedAmount = Number(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    const err = new Error('Invalid payment amount. Amount must be a positive number.');
    err.statusCode = 400;
    err.code = 'INVALID_AMOUNT';
    throw err;
  }

  if (!flow || !referenceId) {
    const err = new Error('Flow and referenceId are required for CC bill limit reservation.');
    err.statusCode = 400;
    err.code = 'INVALID_RESERVATION_PARAMS';
    throw err;
  }

  const { adminUser, company } = await resolveOwningAdmin(userId, { transaction });
  const businessDate = getBusinessDate();
  const requestedPaise = toPaise(parsedAmount);

  // Pre-seed row outside transaction to prevent Postgres aborted-transaction states under cross-worker concurrency
  if (!transaction) {
    await ensureDailyCounterExists(adminUser.id, businessDate, company);
  }

  const executeReservation = async (t) => {
    // 1. Idempotency check: see if this transaction already has a reservation
    const existingReservation = await CcBillLimitReservation.findOne({
      where: { flow, reference_id: String(referenceId) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (existingReservation) {
      if (existingReservation.status === 'RESERVED') {
        return {
          reservation: existingReservation,
          alreadyReserved: true,
          adminId: adminUser.id,
          businessDate: existingReservation.business_date,
        };
      }
      if (existingReservation.status === 'CONSUMED') {
        const err = new Error(`Transaction ${referenceId} in flow ${flow} has already consumed daily limit capacity.`);
        err.statusCode = 409;
        err.code = 'TRANSACTION_ALREADY_CONSUMED';
        throw err;
      }
    }

    // 2. Lock or initialize the daily counter for (admin_id, business_date)
    const counter = await getOrCreateDailyCounter(adminUser.id, businessDate, { transaction: t, lock: true });

    const dailyLimitPaise = toPaise(counter.daily_limit);
    const consumedPaise = toPaise(counter.consumed_amount);
    const reservedPaise = toPaise(counter.reserved_amount);
    const availablePaise = dailyLimitPaise - consumedPaise - reservedPaise;

    if (requestedPaise > availablePaise) {
      const err = new Error(
        `Daily CC bill limit exceeded for Admin '${adminUser.name || adminUser.username || adminUser.id}'. Available capacity: ₹${fromPaise(Math.max(0, availablePaise)).toFixed(2)}, Requested: ₹${parsedAmount.toFixed(2)}.`
      );
      err.code = 'CC_BILL_DAILY_LIMIT_EXCEEDED';
      err.statusCode = 400;
      err.data = {
        admin_id: adminUser.id,
        business_date: businessDate,
        daily_limit: fromPaise(dailyLimitPaise),
        consumed_amount: fromPaise(consumedPaise),
        reserved_amount: fromPaise(reservedPaise),
        available_amount: fromPaise(Math.max(0, availablePaise)),
        requested_amount: parsedAmount,
      };
      throw err;
    }

    // 3. Atomically increment reserved amount
    const newReservedPaise = reservedPaise + requestedPaise;
    counter.reserved_amount = fromPaise(newReservedPaise);
    if (!counter.company_id && company?.company_id) {
      counter.company_id = company.company_id;
    }
    await counter.save({ transaction: t });

    // 4. Create reservation entry
    const reservation = await CcBillLimitReservation.create({
      admin_id: adminUser.id,
      business_date: businessDate,
      flow,
      reference_id: String(referenceId),
      amount: parsedAmount,
      status: 'RESERVED',
      metadata: {
        userId,
        adminId: adminUser.id,
        companyId: company?.company_id || null,
      },
    }, { transaction: t });

    return {
      reservation,
      alreadyReserved: false,
      adminId: adminUser.id,
      businessDate,
      availableRemaining: fromPaise(availablePaise - requestedPaise),
    };
  };

  const run = async () => {
    if (transaction) {
      return executeReservation(transaction);
    }
    return db.transaction((t) => executeReservation(t));
  };

  return withAdminLock(adminUser.id, run);
}

/**
 * Convert an active reservation into consumed capacity exactly once (on successful payment).
 */
async function commitReservation({ flow, referenceId, transaction = null }) {
  if (!flow || !referenceId) return null;

  const executeCommit = async (t) => {
    const reservation = await CcBillLimitReservation.findOne({
      where: { flow, reference_id: String(referenceId) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!reservation) {
      return null;
    }

    if (reservation.status === 'CONSUMED') {
      // Idempotent: already consumed
      return reservation;
    }

    if (reservation.status === 'RELEASED') {
      throw new Error(`Cannot commit reservation for ${flow}:${referenceId}: reservation was already released.`);
    }

    // Lock the Admin daily counter for the business date that owns this reservation
    const counter = await AdminCcBillDailyLimit.findOne({
      where: {
        admin_id: reservation.admin_id,
        business_date: reservation.business_date,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (counter) {
      const reservedPaise = toPaise(counter.reserved_amount);
      const consumedPaise = toPaise(counter.consumed_amount);
      const amountPaise = toPaise(reservation.amount);

      counter.reserved_amount = fromPaise(Math.max(0, reservedPaise - amountPaise));
      counter.consumed_amount = fromPaise(consumedPaise + amountPaise);
      await counter.save({ transaction: t });
    }

    reservation.status = 'CONSUMED';
    await reservation.save({ transaction: t });

    return reservation;
  };

  if (transaction) {
    return executeCommit(transaction);
  }
  return db.transaction((t) => executeCommit(t));
}

/**
 * Release an active reservation safely (on definitive payment failure).
 */
async function releaseReservation({ flow, referenceId, transaction = null }) {
  if (!flow || !referenceId) return null;

  const executeRelease = async (t) => {
    const reservation = await CcBillLimitReservation.findOne({
      where: { flow, reference_id: String(referenceId) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!reservation) {
      return null;
    }

    if (reservation.status === 'RELEASED') {
      // Idempotent: already released
      return reservation;
    }

    if (reservation.status === 'CONSUMED') {
      // Releasing a consumed reservation (e.g. manual or automated refund): restore consumed capacity
      const counter = await AdminCcBillDailyLimit.findOne({
        where: {
          admin_id: reservation.admin_id,
          business_date: reservation.business_date,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (counter) {
        const consumedPaise = toPaise(counter.consumed_amount);
        const amountPaise = toPaise(reservation.amount);
        counter.consumed_amount = fromPaise(Math.max(0, consumedPaise - amountPaise));
        await counter.save({ transaction: t });
      }

      reservation.status = 'RELEASED';
      await reservation.save({ transaction: t });
      return reservation;
    }

    // Lock the Admin daily counter for the business date that owns this reservation
    const counter = await AdminCcBillDailyLimit.findOne({
      where: {
        admin_id: reservation.admin_id,
        business_date: reservation.business_date,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (counter) {
      const reservedPaise = toPaise(counter.reserved_amount);
      const amountPaise = toPaise(reservation.amount);

      counter.reserved_amount = fromPaise(Math.max(0, reservedPaise - amountPaise));
      await counter.save({ transaction: t });
    }

    reservation.status = 'RELEASED';
    await reservation.save({ transaction: t });

    return reservation;
  };

  if (transaction) {
    return executeRelease(transaction);
  }
  return db.transaction((t) => executeRelease(t));
}

/**
 * Get configured daily limit, current usage, and remaining capacity for an Admin.
 */
async function getAdminLimitStatus({ adminId, businessDate = null }) {
  if (!adminId) {
    throw new Error('adminId is required to fetch CC bill limit status.');
  }

  const effectiveBusinessDate = businessDate || getBusinessDate();
  const counter = await getOrCreateDailyCounter(adminId, effectiveBusinessDate);

  const dailyLimitPaise = toPaise(counter.daily_limit);
  const consumedPaise = toPaise(counter.consumed_amount);
  const reservedPaise = toPaise(counter.reserved_amount);
  const availablePaise = Math.max(0, dailyLimitPaise - consumedPaise - reservedPaise);

  return {
    admin_id: Number(counter.admin_id),
    company_id: counter.company_id || null,
    business_date: counter.business_date,
    daily_limit: fromPaise(dailyLimitPaise),
    consumed_amount: fromPaise(consumedPaise),
    reserved_amount: fromPaise(reservedPaise),
    remaining_amount: fromPaise(availablePaise),
  };
}

/**
 * Super Admin updates an Admin's daily CC bill limit.
 * Stores configured limit on Company and immediately updates the current business date counter.
 * Does not erase or reset historical usage.
 */
async function updateAdminDailyLimit({ adminId, dailyLimit }) {
  const parsedLimit = Number(dailyLimit);
  if (Number.isNaN(parsedLimit) || parsedLimit < 0) {
    const err = new Error('daily_limit must be a valid non-negative number.');
    err.statusCode = 400;
    err.code = 'INVALID_LIMIT';
    throw err;
  }

  const adminUser = await User.findByPk(adminId);
  if (!adminUser || String(adminUser.role).toLowerCase() !== 'admin') {
    const err = new Error(`Admin user with id ${adminId} not found.`);
    err.statusCode = 404;
    err.code = 'ADMIN_NOT_FOUND';
    throw err;
  }

  return db.transaction(async (t) => {
    // 1. Update Company configured limit
    let company = null;
    if (adminUser.company_id) {
      company = await Company.findOne({ where: { company_id: adminUser.company_id }, transaction: t });
    }
    if (!company) {
      company = await Company.findOne({ where: { user_id: adminUser.id }, transaction: t });
    }

    if (company) {
      company.bill_payment_limit = parsedLimit;
      await company.save({ transaction: t });
    }

    // 2. Update current business date's daily counter
    const businessDate = getBusinessDate();
    const counter = await getOrCreateDailyCounter(adminUser.id, businessDate, { transaction: t, lock: true });
    counter.daily_limit = parsedLimit;
    if (company?.company_id && !counter.company_id) {
      counter.company_id = company.company_id;
    }
    await counter.save({ transaction: t });

    const dailyLimitPaise = toPaise(counter.daily_limit);
    const consumedPaise = toPaise(counter.consumed_amount);
    const reservedPaise = toPaise(counter.reserved_amount);
    const availablePaise = Math.max(0, dailyLimitPaise - consumedPaise - reservedPaise);

    return {
      admin_id: Number(counter.admin_id),
      company_id: counter.company_id || null,
      business_date: counter.business_date,
      daily_limit: fromPaise(dailyLimitPaise),
      consumed_amount: fromPaise(consumedPaise),
      reserved_amount: fromPaise(reservedPaise),
      remaining_amount: fromPaise(availablePaise),
    };
  });
}

module.exports = {
  getBusinessDate,
  toPaise,
  fromPaise,
  resolveOwningAdmin,
  getOrCreateDailyCounter,
  reserveLimit,
  commitReservation,
  releaseReservation,
  getAdminLimitStatus,
  updateAdminDailyLimit,
};

