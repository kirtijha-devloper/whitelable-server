const IST_OFFSET_MINUTES = 330;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getTodayInIst() {
  return new Date(Date.now() + IST_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function parseDateParts(dateText) {
  if (!DATE_PATTERN.test(dateText)) {
    return null;
  }

  const [year, month, day] = dateText.split('-').map(Number);
  if (month < 1 || month > 12) {
    return null;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    return null;
  }

  return { year, month, day };
}

function toUtcDateForIstBoundary(parts, isEnd) {
  const hour = isEnd ? 23 : 0;
  const minute = isEnd ? 59 : 0;
  const second = isEnd ? 59 : 0;
  const millisecond = isEnd ? 999 : 0;

  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute - IST_OFFSET_MINUTES,
    second,
    millisecond
  ));
}

function parseIstBusinessDateRange(fromDateInput, toDateInput, options = {}) {
  const { defaultToToday = true } = options;
  const fallbackDate = getTodayInIst();
  const fromDateText = fromDateInput || (defaultToToday ? fallbackDate : null);
  const toDateText = toDateInput || (defaultToToday ? fallbackDate : null);

  let fromDate = null;
  let toDate = null;

  if (fromDateText) {
    const parts = parseDateParts(String(fromDateText).trim());
    if (!parts) {
      return { error: 'Invalid date format. Use YYYY-MM-DD.' };
    }
    fromDate = toUtcDateForIstBoundary(parts, false);
  }

  if (toDateText) {
    const parts = parseDateParts(String(toDateText).trim());
    if (!parts) {
      return { error: 'Invalid date format. Use YYYY-MM-DD.' };
    }
    toDate = toUtcDateForIstBoundary(parts, true);
  }

  if (fromDate && toDate && fromDate > toDate) {
    return { error: 'from_date must not be after to_date' };
  }

  return { fromDate, toDate };
}

module.exports = {
  IST_OFFSET_MINUTES,
  parseIstBusinessDateRange,
};
