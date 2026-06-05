require('dotenv').config();

module.exports = {
  apiKey: process.env.BILLAVENUE_API_KEY || '',
  accessCode: process.env.BILLAVENUE_ACCESS_CODE || '',
  instituteId: process.env.BILLAVENUE_INSTITUTE_ID || '',
  ver: '2.4',
  apiUrl: process.env.BILLAVENUE_API_URL || 'https://api.billavenue.com/billpay',
  agentId: 'CC01RP54AGTU00000001',
  mac: process.env.BILLAVENUE_MAC || '01-23-45-67-89-ab',
};
