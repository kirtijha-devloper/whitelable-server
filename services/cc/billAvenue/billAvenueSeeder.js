/**
 * BillAvenue Auto-Seeder Module for Credit Card Billers
 * Automatically seeds 36 Credit Card Billers along with rich Metadata (input parameters, regex, etc.)
 * into POS-SERVER PostgreSQL DB on startup.
 */

const fs = require('fs');
const path = require('path');
const BillAvenueBiller = require('../../../models/BillAvenueBiller');

const METADATA_CACHE_FILE = path.join(__dirname, '../../../biller_metadata_cache.json');

const CREDIT_CARD_BILLERS = [
  { billerId: "AUBA00000NAT3Q", billerName: "AU Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "AU Bank Credit Card" },
  { billerId: "AXIS00000NATKF", billerName: "Axis Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "Axis Bank Credit Card" },
  { billerId: "BAND00010NATWS", billerName: "Bandhan Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "Bandhan Bank Credit Card" },
  { billerId: "BANK00000NATKB", billerName: "BoB Credit Card", category: "Credit Card", serviceType: "IND", circle: "BFSL" },
  { billerId: "BANK00026NATRG", billerName: "Bank of India Credit Card", category: "Credit Card", serviceType: "IND", circle: "Bank of India" },
  { billerId: "CANA00000NATDO", billerName: "Canara Credit Card", category: "Credit Card", serviceType: "IND", circle: "Canara Credit Card" },
  { billerId: "CUBC00000NATGR", billerName: "CUB Credit Card", category: "Credit Card", serviceType: "IND", circle: "CUB Credit Card" },
  { billerId: "DBSB00000NATPR", billerName: "DBS Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "DBS Bank Credit Card" },
  { billerId: "DCBB00017NATCL", billerName: "DCB Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "DCB Bank Credit Card" },
  { billerId: "DHAN00000NAT6X", billerName: "Dhanlaxmi Bank Limited", category: "Credit Card", serviceType: "IND", circle: "DB" },
  { billerId: "EDGE00000NATWS", billerName: "Edge CSB Bank RuPay Credit Card", category: "Credit Card", serviceType: "IND", circle: "Edge CSB Bank RuPay Credit Card" },
  { billerId: "ESAF00000NATPB", billerName: "ESAF Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "ESAF Bank Credit Card" },
  { billerId: "FEDE00000NATDL", billerName: "Federal Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "Fed Credit card" },
  { billerId: "HDFC00000NATBH", billerName: "HDFC Bank Pixel Credit Card", category: "Credit Card", serviceType: "IND", circle: "HDFC Bank Pixel Credit Card" },
  { billerId: "HDFC00000NATW1", billerName: "HDFC Credit Card", category: "Credit Card", serviceType: "IND", circle: "HDFC Credit Card" },
  { billerId: "HSBC00000NAT4M", billerName: "HSBC Credit Card", category: "Credit Card", serviceType: "IND", circle: "HSBC Credit Card" },
  { billerId: "ICIC00000NATSI", billerName: "ICICI Credit card", category: "Credit Card", serviceType: "IND", circle: "ICICI Credit card" },
  { billerId: "IDBI00000NAT7G", billerName: "IDBI Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "IDBI Bank Credit Card" },
  { billerId: "IDFC00000NATFQ", billerName: "IDFC FIRST Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "IDFC FIRST Bank Credit Card" },
  { billerId: "INDI00000NAT8I", billerName: "One - Indian Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "One - Indian Bank Credit Card" },
  { billerId: "INDI00000NATFA", billerName: "Indian bank credit card", category: "Credit Card", serviceType: "IND", circle: "IB credit card" },
  { billerId: "INDU00000NATL1", billerName: "IndusInd Credit Card", category: "Credit Card", serviceType: "IND", circle: "IndusInd Credit Card" },
  { billerId: "IOBC00000NATI3", billerName: "IOB Credit Card", category: "Credit Card", serviceType: "IND", circle: "IOB Credit Card" },
  { billerId: "JAND00020NAT9D", billerName: "J And K Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "J And K Bank Credit Card" },
  { billerId: "KOTA00000NATED", billerName: "Kotak Mahindra Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "Kotak Mahindra Bank Credit Card" },
  { billerId: "ONEB00000NATS1", billerName: "One - BOBCARD Credit Card", category: "Credit Card", serviceType: "IND", circle: "One - BOBCARD Credit Card" },
  { billerId: "PUNJ00000NATEY", billerName: "Punjab National Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "PNB Credit Card" },
  { billerId: "RBLB00000NATN3", billerName: "RBL Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "RBL Bank Credit Card" },
  { billerId: "SARA00000NAT16", billerName: "Saraswat Co-Operative Bank Ltd", category: "Credit Card", serviceType: "IND", circle: "Saraswat Co-Operative Bank Ltd" },
  { billerId: "SBIC00000NATDN", billerName: "SBI Card", category: "Credit Card", serviceType: "IND", circle: "SBI Card" },
  { billerId: "SBMB00000NATX5", billerName: "SBM Bank India Limited", category: "Credit Card", serviceType: "IND", circle: "SBM Bank India Limited" },
  { billerId: "SOUT00000NAT68", billerName: "One - South Indian Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "One - South Indian Bank Credit Card" },
  { billerId: "SURY00000NATNX", billerName: "Suryoday Small Finance Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "Suryoday SFB Credit Card" },
  { billerId: "TAMI00027NAT9C", billerName: "Tamilnad Mercantile Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "Tamilnad Mercantile Bank Credit Card" },
  { billerId: "UNIO00000NATG9", billerName: "Union Bank of India Credit Card", category: "Credit Card", serviceType: "IND", circle: "UBI CREDIT CARD" },
  { billerId: "YESB00000NAT8U", billerName: "Yes Bank Credit Card", category: "Credit Card", serviceType: "IND", circle: "Yes Bank Credit Card" }
];

function buildFallbackMetadata(b) {
  return {
    billerId: b.billerId,
    mode: "ONLINE",
    acceptsAdhoc: "T",
    paymentAmountExactness: "ANY",
    fetchRequirement: "MANDATORY",
    supportValidation: "NOT_SUPPORTED",
    billerInfo: {
      type: "OFFUS",
      name: b.billerName,
      description: "NULL",
      ownership: "Private"
    },
    category: { key: "C15", name: "Credit Card" },
    parameters: [
      {
        name: "param1",
        desc: "Registered Mobile Number",
        minLength: 10,
        maxLength: 10,
        inputType: "NUMERIC",
        mandatory: 1,
        regex: "^[5-9][0-9]{9}$"
      },
      {
        name: "param2",
        desc: "Last 4 digits of Credit Card Number",
        minLength: 4,
        maxLength: 4,
        inputType: "NUMERIC",
        mandatory: 1,
        regex: "^[0-9]{4}$"
      }
    ]
  };
}

async function autoSeedBillAvenueBillers() {
  try {
    let metadataCache = {};
    if (fs.existsSync(METADATA_CACHE_FILE)) {
      try {
        const raw = fs.readFileSync(METADATA_CACHE_FILE, 'utf8');
        metadataCache = JSON.parse(raw);
      } catch (err) {
        console.error('[BillAvenue AutoSeeder] Failed to read metadata cache:', err.message);
      }
    }

    console.log(`[BillAvenue AutoSeeder] Seeding/Updating ${CREDIT_CARD_BILLERS.length} Credit Card billers with rich metadata...`);

    let seededCount = 0;
    for (const b of CREDIT_CARD_BILLERS) {
      const meta = metadataCache[b.billerId] || buildFallbackMetadata(b);

      await BillAvenueBiller.upsert({
        biller_id: b.billerId,
        biller_name: b.billerName,
        category: b.category,
        service_type: b.serviceType,
        circle: b.circle,
        state: null,
        metadata: meta,
        is_active: true,
      });
      seededCount++;
    }

    console.log(`[BillAvenue AutoSeeder] Successfully seeded ${seededCount} BillAvenue billers with metadata.`);
  } catch (err) {
    console.error('[BillAvenue AutoSeeder Error]:', err.message || err);
  }
}

module.exports = {
  autoSeedBillAvenueBillers,
  CREDIT_CARD_BILLERS,
};
