/**
 * Usage:
 *   node scripts/importBillAvenueBillersFromExcel.js <path-to-excel-file>
 *
 * Columns supported in sheet:
 *   billerId, billerName, category, serviceType, circle, state, isActive
 *
 * If you are missing xlsx dependency:
 *   npm install xlsx
 */

const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const BillAvenueBiller = require('../models/BillAvenueBiller');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Missing file path. Usage: node scripts/importBillAvenueBillersFromExcel.js <file.xlsx>');
    process.exit(1);
  }
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error('File not found:', absPath);
    process.exit(1);
  }

  const workbook = xlsx.readFile(absPath);
  const sheetName = workbook.SheetNames[0];
  const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });

  if (!rawRows.length) {
    console.log('No rows in sheet');
    process.exit(0);
  }

  let imported = 0;
  for (const row of rawRows) {
    const billerId = String(row.billerId || row.biller_id || row.blr_id || row.BLR_ID || '').trim();
    const billerName = String(row.billerName || row.biller_name || row.blr_name || row.BLR_NAME || '').trim();
    const aliasName = String(row.blr_alias_name || row.BLR_ALIAS_NAME || '').trim();
    const categoryName = String(row.blr_category_name || row.BLR_CATEGORY_NAME || '').trim();
    const coverage = String(row.blr_coverage || row.BLR_COVERAGE || '').trim();

    if (!billerId || !billerName) {
      continue;
    }

    await BillAvenueBiller.upsert({
      biller_id: billerId,
      biller_name: billerName,
      category: categoryName || row.category || row.Category || null,
      service_type: coverage || row.serviceType || row.service_type || row.ServiceType || null,
      circle: aliasName || row.circle || row.Circle || null,
      state: row.state || row.State || null,
      is_active: String(row.isActive || row.is_active || row.Active || 'true').toLowerCase() !== 'false',
      metadata: row,
    });
    imported += 1;
  }

  console.log(`Imported/updated ${imported} BillAvenue biller rows`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
