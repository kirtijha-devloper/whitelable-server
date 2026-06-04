require('dotenv').config();

module.exports = {
  apiKey:       process.env.BILLAVENUE_API_KEY       || '',
  accessCode:   process.env.BILLAVENUE_ACCESS_CODE   || '',
  instituteId:  process.env.BILLAVENUE_INSTITUTE_ID  || '',
  ver:          process.env.BILLAVENUE_API_VER       || '1.0',
  apiUrl:       process.env.BILLAVENUE_API_URL       || 'https://api.billavenue.com/billpay',
  agentId:      process.env.BILLAVENUE_INSTITUTE_ID  || 'CC01CC01513515340681',
  mac:          process.env.BILLAVENUE_MAC           || '01-23-45-67-89-ab',
};
