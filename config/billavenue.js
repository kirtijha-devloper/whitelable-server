require('dotenv').config();

module.exports = {
  apiKey:       process.env.BILLAVENUE_API_KEY       || '',
  accessCode:   process.env.BILLAVENUE_ACCESS_CODE   || '',
  instituteId:  process.env.BILLAVENUE_INSTITUTE_ID  || '',
  ver:          process.env.BILLAVENUE_VER           || '1.0',
  apiUrl:       process.env.BILLAVENUE_API_URL       || 'https://stgapi.billavenue.com/billpay/extBillPayCntrl',
  agentId:      process.env.BILLAVENUE_AGENT_ID      || 'CC01BA10000001',
  agentDeviceIp:process.env.BILLAVENUE_AGENT_IP      || '192.168.2.73',
  agentDeviceMac:process.env.BILLAVENUE_AGENT_MAC    || '01-23-45-67-89-ab',
};
