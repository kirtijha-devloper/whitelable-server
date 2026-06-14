const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../controllers/ledgerController.js');
let content = fs.readFileSync(filePath, 'utf8');

// Normalize everything to \n
content = content.replace(/\r\n/g, '\n');

const target1 = `    // Format entries with metadata parsing
    const formattedEntries = entries.map(entry => {`.replace(/\r\n/g, '\n');

const replacement1 = `    // Fetch missing RRNs on the fly for previous franchise earning entries
    const RazorpayNotification = require("../models/RazorpayNotification");
    const franchiseEarningTxnIds = entries
      .filter(e => e.transaction_type === 'pos_franchise_earning' && e.transaction_id && e.description && !e.description.includes('| RRN:'))
      .map(e => e.transaction_id);

    let notificationMap = {};
    if (franchiseEarningTxnIds.length > 0) {
      const notifications = await RazorpayNotification.findAll({
        where: { txn_id: { [Op.in]: franchiseEarningTxnIds } }
      });
      for (const notif of notifications) {
        let rrNumber = notif.rr_number;
        if (!rrNumber && notif.event_json) {
          try {
            const eventData = typeof notif.event_json === 'string' ? JSON.parse(notif.event_json) : notif.event_json;
            rrNumber = eventData.rrNumber || null;
          } catch(e) {}
        }
        if (rrNumber || notif.txn_id) {
          notificationMap[notif.txn_id] = rrNumber || 'N/A';
        }
      }
    }

    // Format entries with metadata parsing
    const formattedEntries = entries.map(entry => {`.replace(/\r\n/g, '\n');

const target2 = `      return {
        id: entry.id,
        transaction_type: entry.transaction_type,
        transaction_id: entry.transaction_id,
        reference_id: entry.reference_id,
        reference_table: entry.reference_table,
        description: entry.description,`.replace(/\r\n/g, '\n');

const replacement2 = `      let description = entry.description;
      if (entry.transaction_type === 'pos_franchise_earning' && description && !description.includes('| RRN:') && notificationMap[entry.transaction_id]) {
        description = \`\${description} | Txn: \${entry.transaction_id} | RRN: \${notificationMap[entry.transaction_id]}\`;
      }

      return {
        id: entry.id,
        transaction_type: entry.transaction_type,
        transaction_id: entry.transaction_id,
        reference_id: entry.reference_id,
        reference_table: entry.reference_table,
        description: description,`.replace(/\r\n/g, '\n');

content = content.split(target1).join(replacement1);
content = content.split(target2).join(replacement2);

// Optionally convert back to CRLF if needed
// content = content.replace(/\n/g, '\r\n');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Patched ledgerController.js successfully.');
