const { Op } = require('sequelize');
const PayoutAuditLog = require('../../models/PayoutAuditLog');

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

function extractRequestId(details) {
  if (!details || typeof details !== 'object') return null;
  if (details.request_id) return details.request_id;
  if (details.requestId) return details.requestId;
  if (details.reference_id) return details.reference_id;
  if (details.branchxResponse && typeof details.branchxResponse === 'object') {
    if (details.branchxResponse.requestId) return details.branchxResponse.requestId;
    if (details.branchxResponse.data && details.branchxResponse.data.requestId) {
      return details.branchxResponse.data.requestId;
    }
  }
  return null;
}

function normalizeAuditLogEntry(log) {
  return {
    id: log.id,
    payout_id: log.payout_id,
    action: log.action,
    details: log.details,
    request_id: extractRequestId(log.details),
    created_at: log.created_at,
    updated_at: log.updated_at
  };
}

function normalizeRequestId(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim();
}

function matchesRequestId(details, requestId) {
  if (!details || typeof details !== 'object') return false;
  const normalized = normalizeRequestId(requestId);
  if (!normalized) return false;

  const candidates = [];
  if (details.requestId) candidates.push(details.requestId);
  if (details.request_id) candidates.push(details.request_id);
  if (details.reference_id) candidates.push(details.reference_id);
  if (details.branchxResponse && typeof details.branchxResponse === 'object') {
    if (details.branchxResponse.requestId) candidates.push(details.branchxResponse.requestId);
    if (details.branchxResponse.data && details.branchxResponse.data.requestId) {
      candidates.push(details.branchxResponse.data.requestId);
    }
  }

  return candidates.some((candidate) => normalizeRequestId(candidate) === normalized);
}

async function getPayoutAuditLogs(req, res) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { fromDate, toDate } = req.query;
    const today = new Date();
    const startDate = fromDate ? parseDate(fromDate, false) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endDate = toDate ? parseDate(toDate, true) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Invalid fromDate or toDate' });
    }

    const logs = await PayoutAuditLog.findAll({
      where: {
        created_at: {
          [Op.gte]: startDate,
          [Op.lte]: endDate
        }
      },
      order: [['created_at', 'ASC']]
    });

    const grouped = logs.reduce((acc, log) => {
      const payoutIdKey = log.payout_id === null || log.payout_id === undefined ? 'null' : String(log.payout_id);
      if (!acc[payoutIdKey]) acc[payoutIdKey] = [];
      acc[payoutIdKey].push(normalizeAuditLogEntry(log));
      return acc;
    }, {});

    const groupedLogs = Object.keys(grouped)
      .sort((a, b) => {
        if (a === 'null') return 1;
        if (b === 'null') return -1;
        return parseInt(a, 10) - parseInt(b, 10);
      })
      .map((payoutIdKey) => ({
        payout_id: payoutIdKey === 'null' ? null : parseInt(payoutIdKey, 10),
        logs: grouped[payoutIdKey]
      }));

    return res.json({
      success: true,
      message: 'Payout audit logs retrieved successfully',
      fromDate: startDate.toISOString().slice(0, 10),
      toDate: endDate.toISOString().slice(0, 10),
      totalGroups: groupedLogs.length,
      data: groupedLogs
    });
  } catch (error) {
    console.error('Get payout audit logs error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
}

async function getPayoutAuditLogsByRequest(req, res) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { payout_id, requestId, fromDate, toDate } = req.query;
    if (!payout_id && !requestId) {
      return res.status(400).json({ success: false, message: 'Either payout_id or requestId is required' });
    }

    const today = new Date();
    const startDate = fromDate ? parseDate(fromDate, false) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endDate = toDate ? parseDate(toDate, true) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Invalid fromDate or toDate' });
    }

    const where = {
      created_at: {
        [Op.gte]: startDate,
        [Op.lte]: endDate
      }
    };

    if (payout_id) {
      where.payout_id = payout_id;
    }

    let logs = await PayoutAuditLog.findAll({
      where,
      order: [['created_at', 'ASC']]
    });

    if (!payout_id && requestId) {
      logs = logs.filter((log) => matchesRequestId(log.details, requestId));
    }

    if (payout_id && requestId) {
      logs = logs.filter((log) => matchesRequestId(log.details, requestId));
    }

    const normalizedLogs = logs.map(normalizeAuditLogEntry);

    return res.json({
      success: true,
      message: 'Payout audit logs retrieved successfully',
      payout_id: payout_id ? parseInt(payout_id, 10) : null,
      requestId: requestId || null,
      totalLogs: normalizedLogs.length,
      data: normalizedLogs
    });
  } catch (error) {
    console.error('Get payout audit logs by id error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
}

module.exports = {
  getPayoutAuditLogs,
  getPayoutAuditLogsByRequest
};
