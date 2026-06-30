const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const db = require('../../config/database');
const PayoutTransaction = require('../../models/PayoutTransaction');
const PayoutAuditLog = require('../../models/PayoutAuditLog');
const Ledger = require('../../models/Ledger');
const ledgerService = require('../../services/ledgerService');

const BRANCHX_CALLBACK_FORWARD_URL = process.env.BRANCHX_CALLBACK_FORWARD_URL || 'https://api.abheepay.com/api/branchx/callback';
const BRANCHX_CALLBACK_FORWARD_TIMEOUT_MS = Number(process.env.BRANCHX_CALLBACK_FORWARD_TIMEOUT_MS || 10000);
const callbackLogFile = path.resolve(__dirname, '../../logs/branchx-payout-callback.log');
const branchxRedirectLogFile = path.resolve(__dirname, '../../logs/branchx_api_redirect.log');

function ensureLogDir() {
  const logDir = path.dirname(callbackLogFile);
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to ensure callback log directory exists:', err);
  }
}

function logBranchxCallback(data, req) {
  try {
    ensureLogDir();
    const branchxStatusCode = data.statuscode || data.statusCode || data.status_code || data.code || data.responseCode || data.response_code || null;
    const entry = {
      receivedAt: new Date().toISOString(),
      method: req?.method || null,
      path: req?.originalUrl || null,
      ip: req?.ip || (req?.connection?.remoteAddress || null),
      branchxStatusCode,
      rawPayload: data,
    };
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(callbackLogFile, line, 'utf8');
  } catch (err) {
    console.error('Failed to write BranchX callback log:', err);
    // fallback to webhook auth log if branchx callback log can't be written
    try {
      const fallback = path.join(__dirname, '../../logs/webhookAuth.log');
      const fallbackEntry = {
        receivedAt: new Date().toISOString(),
        fallback: true,
        rawPayload: data,
      };
      fs.appendFileSync(fallback, `${JSON.stringify(fallbackEntry)}\n`, 'utf8');
    } catch (fallbackErr) {
      console.error('Failed to write fallback webhookAuth log:', fallbackErr);
    }
  }
}

function logBranchxEvent(message) {
  try {
    ensureLogDir();
    const line = `${new Date().toISOString()} - [EVENT] ${message}\n`;
    fs.appendFileSync(callbackLogFile, line, 'utf8');
  } catch (err) {
    console.error('Failed to write BranchX event log:', err);
  }
}

function logBranchxRedirect(entry) {
  try {
    ensureLogDir();
    const payload = {
      receivedAt: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(branchxRedirectLogFile, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write BranchX redirect log:', error);
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Buffer.isBuffer(value) && !Array.isArray(value);
}

function tryParseJson(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return null;
  }
}

function deriveKey(secret, size = 32) {
  const secretText = String(secret || '');
  if (!secretText) {
    return null;
  }

  const secretBuffer = Buffer.from(secretText, 'utf8');
  if (secretBuffer.length === size) {
    return secretBuffer;
  }

  return crypto.createHash('sha256').update(secretBuffer).digest().subarray(0, size);
}

function deriveIv(ivValue) {
  const ivText = String(ivValue || '');
  if (!ivText) {
    return null;
  }

  const ivBuffer = Buffer.from(ivText, 'utf8');
  if (ivBuffer.length === 16) {
    return ivBuffer;
  }

  return crypto.createHash('sha256').update(ivBuffer).digest().subarray(0, 16);
}

function decryptAes256Cbc(base64CipherText, secret, ivValue) {
  const key = deriveKey(secret, 32);
  const iv = deriveIv(ivValue);

  if (!key || !iv) {
    return null;
  }

  const normalized = String(base64CipherText || '').trim();
  if (!normalized) {
    return null;
  }

  const encryptedBuffer = Buffer.from(normalized, 'base64');
  if (!encryptedBuffer.length) {
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decryptedBuffer = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decryptedBuffer.toString('utf8');
  } catch (error) {
    return null;
  }
}

function decodeBase64Text(text) {
  const normalized = String(text || '').trim();
  if (!normalized || normalized.length % 4 !== 0) {
    return null;
  }

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(normalized)) {
    return null;
  }

  try {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim();
    return decoded || null;
  } catch (error) {
    return null;
  }
}

function resolveBranchxCallbackPayload(req) {
  const rawBody = req.method === 'GET' ? req.query : req.body;

  if (isPlainObject(rawBody)) {
    return rawBody;
  }

  const rawText = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8').trim()
    : String(rawBody || '').trim();

  if (!rawText) {
    return {};
  }

  const parsedJson = tryParseJson(rawText);
  if (parsedJson !== null) {
    return parsedJson;
  }

  const secret = process.env.BRANCHX_CALLBACK_ENCRYPTION_KEY || process.env.BRANCHX_CALLBACK_SECRET || '';
  const ivValue = process.env.BRANCHX_CALLBACK_ENCRYPTION_IV || process.env.BRANCHX_CALLBACK_IV || '';

  const aesDecrypted = decryptAes256Cbc(rawText, secret, ivValue);
  if (aesDecrypted) {
    const decryptedJson = tryParseJson(aesDecrypted);
    return decryptedJson !== null ? decryptedJson : aesDecrypted;
  }

  const base64Decoded = decodeBase64Text(rawText);
  if (base64Decoded) {
    const decodedJson = tryParseJson(base64Decoded);
    return decodedJson !== null ? decodedJson : base64Decoded;
  }

  return rawText;
}

function buildForwardHeaders(req) {
  const headers = { ...(req.headers || {}) };
  delete headers.host;
  delete headers['content-length'];
  delete headers.connection;
  delete headers['transfer-encoding'];
  return headers;
}

function forwardBranchxCallbackToApi(req, payload) {
  const method = String(req.method || 'POST').toLowerCase();
  const outboundHeaders = buildForwardHeaders(req);
  const config = {
    method,
    url: BRANCHX_CALLBACK_FORWARD_URL,
    headers: outboundHeaders,
    timeout: BRANCHX_CALLBACK_FORWARD_TIMEOUT_MS,
    validateStatus: () => true,
  };

  if (method === 'get') {
    config.params = payload;
  } else {
    config.data = payload;
  }

  logBranchxRedirect({
    event: 'FORWARD_ATTEMPT',
    source: {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip || req.socket?.remoteAddress || null,
    },
    targetUrl: BRANCHX_CALLBACK_FORWARD_URL,
    forwardedHeaders: outboundHeaders,
    forwardedPayload: payload,
  });

  return axios.request(config);
}

function normalizeBranchxStatus(statusRaw) {
  if (!statusRaw) return 'PENDING';
  const s = statusRaw.toString().trim().toUpperCase();
  if (['SUCCESS', 'COMPLETED'].includes(s)) return 'SUCCESS';
  if (['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'REVERSED'].includes(s)) return 'FAILED';
  if (['PENDING', 'PROCESSING', 'IN_PROGRESS'].includes(s)) return 'PENDING';
  return s;
}

function getBranchxStatusCode(payload) {
  return payload.statuscode || payload.statusCode || payload.status_code || payload.code || payload.responseCode || payload.response_code || null;
}

function getCallbackResponseCode(status) {
  return status === 'PENDING' ? 119 : 200;
}

function getCallbackResponseMessage(status) {
  return status === 'PENDING' ? 'Pending' : 'Callback received successfully';
}

const handleBranchxPayoutCallback = asyncHandler(async (req, res) => {
  const payload = resolveBranchxCallbackPayload(req);
  logBranchxCallback(payload, req);

  void forwardBranchxCallbackToApi(req, payload).then((response) => {
    logBranchxRedirect({
      event: 'FORWARD_SUCCESS',
      source: {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip || req.socket?.remoteAddress || null,
      },
      targetUrl: BRANCHX_CALLBACK_FORWARD_URL,
      downstreamStatus: response?.status ?? null,
      downstreamData: response?.data ?? null,
    });
    logBranchxEvent(`FORWARDED branchx callback to ${BRANCHX_CALLBACK_FORWARD_URL} status=${response?.status ?? 'unknown'}`);
  }).catch((error) => {
    logBranchxRedirect({
      event: 'FORWARD_FAILED',
      source: {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip || req.socket?.remoteAddress || null,
      },
      targetUrl: BRANCHX_CALLBACK_FORWARD_URL,
      error: error.message || String(error),
      errorResponse: error?.response?.data ?? null,
    });
    logBranchxEvent(`FORWARD_FAILED branchx callback to ${BRANCHX_CALLBACK_FORWARD_URL}: ${error.message || error}`);
  });

  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return res.status(400).json({ success: false, message: 'Empty callback payload' });
  }

  const status = normalizeBranchxStatus(payload.status || payload.Status);
  const referenceCandidates = [payload.requestId, payload.requestid, payload.opRefId, payload.oprefid, payload.apiTxnId, payload.apitxnid].filter(Boolean);

  if (!referenceCandidates.length) {
    return res.status(400).json({ success: false, message: 'Missing identifier in callback payload' });
  }

  let payoutTransaction = null;
  for (const ref of referenceCandidates) {
    if (payoutTransaction) break;
    payoutTransaction = await PayoutTransaction.findOne({ where: { reference_id: ref } });
  }

  if (!payoutTransaction) {
    logBranchxEvent(`NOT PROCESSED — no payout transaction found for refs: ${referenceCandidates.join(', ')}`);
    return res.status(getCallbackResponseCode(status)).json({
      success: true,
      message: getCallbackResponseMessage(status),
      payoutTransactionFound: false,
      callbackPayload: payload,
      branchxStatusCode: getBranchxStatusCode(payload),
      status
    });
  }

  logBranchxEvent(`Found payout transaction id=${payoutTransaction.id} ref=${payoutTransaction.reference_id} currentStatus=${payoutTransaction.status} incomingStatus=${status}`);

  const trx = await db.transaction();
  try {
    const locked = await PayoutTransaction.findByPk(payoutTransaction.id, { transaction: trx, lock: trx.LOCK.UPDATE });
    if (!locked) {
      await trx.rollback();
      return res.status(500).json({ success: false, message: 'Failed to lock payout transaction' });
    }

    const previousStatus = (locked.status || '').toString().toUpperCase();
    const newStatus = status;

    if (previousStatus === newStatus) {
      logBranchxEvent(`SKIPPED — payout id=${locked.id} already in status=${previousStatus}`);
    } else {
      logBranchxEvent(`PROCESSING — payout id=${locked.id} status change: ${previousStatus} → ${newStatus}`);
    }

    let parsedData = {};
    try {
      parsedData = locked.data ? JSON.parse(locked.data) : {};
    } catch (ignore) {
      parsedData = { original: locked.data };
    }

    if (parsedData.branchxCronResolved) {
      await PayoutAuditLog.create({
        payout_id: locked.id,
        action: 'BRANCHX_CALLBACK_SKIPPED_BY_CRON',
        details: {
          reference_id: locked.reference_id,
          previousStatus,
          incomingStatus: newStatus,
          reason: 'Ignored because cron already resolved this payout'
        }
      }, { transaction: trx });

      const skippedMsg = `SKIPPED_BY_CRON — payout id=${locked.id} ref=${locked.reference_id} previousStatus=${previousStatus} incomingStatus=${newStatus}`;
      logBranchxEvent(skippedMsg);
      await trx.commit();
      return res.status(200).json({
        success: true,
        message: 'Callback ignored because cron already resolved this payout',
        payoutTransactionId: locked.id,
        payoutTransactionFound: true,
        status: previousStatus,
        skippedByCron: true
      });
    }

    parsedData.callback = payload;

    const payloadStr = JSON.stringify(payload);

    await locked.update({
      status: newStatus,
      callback_status: newStatus,
      callback_data: payloadStr,
      callback_received_at: new Date(),
      data: JSON.stringify(parsedData)
    }, { transaction: trx });

    if ((previousStatus === 'PENDING' || previousStatus === 'SUCCESS') && newStatus === 'FAILED') {
      const existingRefund = await Ledger.findOne({
        where: {
          transaction_type: 'payout_refund',
          reference_id: locked.id,
          reference_table: 'PayoutTransactions',
        },
        transaction: trx,
      });

      if (!existingRefund) {
        const refundAmount = parseFloat(locked.amount || 0) + parseFloat(locked.service_charge || 0);
        await ledgerService.createLedgerEntry({
          userId: locked.merchant_id,
          transactionType: 'payout_refund',
          referenceId: locked.id,
          referenceTable: 'PayoutTransactions',
          description: `Refund for failed BranchX payout ${locked.reference_id || locked.id}`,
          credit: refundAmount,
        }, { transaction: trx });
      }
    }

    if (previousStatus !== newStatus) {
      await PayoutAuditLog.create({
        payout_id: locked.id,
        action: 'BRANCHX_CALLBACK_STATUS_UPDATE',
        details: {
          reference_id: locked.reference_id,
          from: previousStatus,
          to: newStatus,
          callback: payload,
          callbackResponse: {
            statusCode: getCallbackResponseCode(newStatus),
            message: getCallbackResponseMessage(newStatus)
          }
        }
      }, { transaction: trx });
    }

    await trx.commit();

    logBranchxEvent(`PROCESSED successfully — payout id=${locked.id} finalStatus=${newStatus}`);

    const branchxStatusCode = getBranchxStatusCode(payload);
    return res.status(getCallbackResponseCode(newStatus)).json({
      success: true,
      message: getCallbackResponseMessage(newStatus),
      payoutTransactionId: locked.id,
      payoutTransactionFound: true,
      status: newStatus,
      branchxStatusCode,
      callbackPayload: payload,
      previousStatus,
      newStatus
    });
  } catch (error) {
    await trx.rollback();
    logBranchxEvent(`FAILED — payout id=${payoutTransaction.id} error: ${error.message || error}`);
    return res.status(500).json({ success: false, message: error.message || 'Callback processing failed', error });
  }
});

module.exports = {
  handleBranchxPayoutCallback,
};
