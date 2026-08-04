const WEBHOOK_SOURCES = Object.freeze({
  AGRO_AXIS: 'agro_axis',
  AGRO_HDFC: 'agro_hdfc',
  EVERLIFE: 'everlife',
  PINELAB_MANUAL: 'pinelab_manual',
  YESBANK_MANUAL: 'yesbank_manual',
  PAYTM_MANUAL: 'paytm_manual',
  UNKNOWN: 'UNKNOWN',
});

const LEGACY_AGRO_SOURCE = 'agro';

function extractCardClassification(payload) {
  if (!payload || typeof payload !== 'object') return null;

  return (
    payload.cardClassification ||
    payload.card_classification ||
    payload.cardClassificationType ||
    null
  );
}

module.exports = {
  LEGACY_AGRO_SOURCE,
  WEBHOOK_SOURCES,
  extractCardClassification,
};
