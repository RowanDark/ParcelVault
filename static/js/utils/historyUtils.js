/* ParcelVault – history grouping utilities */
'use strict';

const HistoryUtils = {
  /**
   * Groups an array of history entry objects by calendar day.
   * Preserves the order of first appearance for each date key.
   *
   * @param {Array}  entries    - flat list of history objects
   * @param {string} dateField  - property name holding the date string (default: 'ActionDate')
   * @returns {Array} - [{dateKey, label, entries}] in original date order
   */
  groupHistoryByDate(entries, dateField) {
    dateField = dateField || 'ActionDate';
    const groupMap = {};
    const order = [];

    entries.forEach(function (entry) {
      const raw = (entry[dateField] || '').toString();
      const key = raw.slice(0, 10) || 'unknown';
      if (!groupMap[key]) {
        groupMap[key] = [];
        order.push(key);
      }
      groupMap[key].push(entry);
    });

    return order.map(function (key) {
      return {
        dateKey: key,
        label:   HistoryUtils._formatDateLabel(key),
        entries: groupMap[key]
      };
    });
  },

  /* Returns true when dateKey (YYYY-MM-DD) matches today's local date. */
  isToday(dateKey) {
    if (!dateKey || dateKey === 'unknown') return false;
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return dateKey === `${y}-${m}-${d}`;
  },

  _formatDateLabel(dateKey) {
    if (!dateKey || dateKey === 'unknown') return 'Unknown';
    const parts = dateKey.split('-');
    if (parts.length !== 3) return dateKey;
    const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
};

if (typeof module !== 'undefined') module.exports = HistoryUtils;
