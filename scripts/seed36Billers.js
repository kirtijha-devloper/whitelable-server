/**
 * Script to seed 36 Credit Card Billers into POS-SERVER database (BillAvenueBillers table)
 * Run: node scripts/seed36Billers.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const BillAvenueBiller = require('../models/BillAvenueBiller');

async function seed() {
  console.log('--- Starting Seeding of 36 Credit Card Billers ---');
  const filePath = 'C:/Users/mukun/Downloads/thunder-file_4fcff274.txt';

  if (!fs.existsSync(filePath)) {
    console.error('Log file not found at:', filePath);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' })
  });

  let billers = [];

  for await (const line of rl) {
    if (line.includes('"billers":[')) {
      const idx = line.indexOf('{"billers":[');
      if (idx !== -1) {
        const jsonSub = line.substring(idx);
        const endIdx = jsonSub.indexOf(']}');
        if (endIdx !== -1) {
          try {
            const parsed = JSON.parse(jsonSub.substring(0, endIdx + 2));
            billers = parsed.billers || [];
            break;
          } catch (e) {
            console.error('Parsing error:', e.message);
          }
        }
      }
    }
  }

  if (billers.length === 0) {
    console.error('No billers found in log file.');
    process.exit(1);
  }

  console.log(`Found ${billers.length} billers to seed.`);

  let inserted = 0;
  let updated = 0;

  for (const biller of billers) {
    try {
      const [record, created] = await BillAvenueBiller.findOrCreate({
        where: { biller_id: biller.billerId },
        defaults: {
          biller_id: biller.billerId,
          biller_name: biller.billerName,
          category: biller.category || 'Credit Card',
          service_type: biller.serviceType || 'IND',
          circle: biller.circle || biller.billerName,
          state: biller.state || null,
          metadata: biller.metadata || biller,
          is_active: true,
        },
      });

      if (created) {
        inserted++;
      } else {
        await record.update({
          biller_name: biller.billerName,
          category: biller.category || 'Credit Card',
          service_type: biller.serviceType || 'IND',
          circle: biller.circle || biller.billerName,
          is_active: true,
        });
        updated++;
      }
    } catch (err) {
      console.error(`Failed to seed ${biller.billerId}:`, err.message);
    }
  }

  console.log(`Successfully completed! Created: ${inserted}, Updated: ${updated}`);
  process.exit(0);
}

seed();
