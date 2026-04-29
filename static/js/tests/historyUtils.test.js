/* historyUtils.test.js – unit tests for history grouping utilities
 * Run with Node.js:  node static/js/tests/historyUtils.test.js
 */
'use strict';

const HistoryUtils = require('../utils/historyUtils');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓  ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗  ' + name);
    console.error('     ' + e.message);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || 'Expected equality') +
      '\n     expected: ' + JSON.stringify(expected) +
      '\n     actual:   ' + JSON.stringify(actual)
    );
  }
}

// ── groupHistoryByDate ───────────────────────────────────────────
console.log('\ngroupHistoryByDate:');

test('returns empty array for empty input', function () {
  assertEqual(HistoryUtils.groupHistoryByDate([]).length, 0);
});

test('groups two entries on the same day into one group', function () {
  const entries = [
    { ActionDate: '2026-04-29 10:00:00' },
    { ActionDate: '2026-04-29 14:30:00' },
  ];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups.length, 1);
  assertEqual(groups[0].dateKey, '2026-04-29');
  assertEqual(groups[0].entries.length, 2);
});

test('creates separate groups for different days', function () {
  const entries = [
    { ActionDate: '2026-04-29 10:00:00' },
    { ActionDate: '2026-04-28 09:15:00' },
    { ActionDate: '2026-04-27 08:00:00' },
  ];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups.length, 3);
  assertEqual(groups[0].dateKey, '2026-04-29');
  assertEqual(groups[1].dateKey, '2026-04-28');
  assertEqual(groups[2].dateKey, '2026-04-27');
});

test('mixed dates: entries on some days grouped correctly', function () {
  const entries = [
    { ActionDate: '2026-04-29 10:00:00' },
    { ActionDate: '2026-04-29 14:30:00' },
    { ActionDate: '2026-04-28 09:15:00' },
  ];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups.length, 2);
  assertEqual(groups[0].entries.length, 2);
  assertEqual(groups[1].entries.length, 1);
});

test('preserves entry order within a group', function () {
  const entries = [
    { ActionDate: '2026-04-29 14:00:00', id: 1 },
    { ActionDate: '2026-04-29 12:00:00', id: 2 },
    { ActionDate: '2026-04-29 08:00:00', id: 3 },
  ];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups[0].entries[0].id, 1);
  assertEqual(groups[0].entries[1].id, 2);
  assertEqual(groups[0].entries[2].id, 3);
});

test('handles null ActionDate', function () {
  const entries = [{ ActionDate: null }];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups.length, 1);
  assertEqual(groups[0].dateKey, 'unknown');
});

test('handles empty string ActionDate', function () {
  const entries = [{ ActionDate: '' }];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups[0].dateKey, 'unknown');
});

test('groups multiple null/empty dates into one unknown group', function () {
  const entries = [{ ActionDate: null }, { ActionDate: '' }, { ActionDate: null }];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups.length, 1);
  assertEqual(groups[0].entries.length, 3);
});

test('handles single entry', function () {
  const entries = [{ ActionDate: '2026-01-15 08:00:00' }];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups.length, 1);
  assertEqual(groups[0].dateKey, '2026-01-15');
});

test('stress: 1000 entries across 10 days, 100 per day', function () {
  const entries = [];
  for (let day = 1; day <= 10; day++) {
    const d = String(day).padStart(2, '0');
    for (let i = 0; i < 100; i++) {
      entries.push({ ActionDate: `2026-01-${d} 10:00:00` });
    }
  }
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assertEqual(groups.length, 10);
  groups.forEach(function (g) {
    assertEqual(g.entries.length, 100, 'Each day-group should have 100 entries');
  });
});

test('uses custom dateField when specified', function () {
  const entries = [
    { timestamp: '2026-04-29 10:00:00' },
    { timestamp: '2026-04-28 10:00:00' },
  ];
  const groups = HistoryUtils.groupHistoryByDate(entries, 'timestamp');
  assertEqual(groups.length, 2);
  assertEqual(groups[0].dateKey, '2026-04-29');
  assertEqual(groups[1].dateKey, '2026-04-28');
});

test('each group has a non-empty label', function () {
  const entries = [{ ActionDate: '2026-04-29 10:00:00' }];
  const groups = HistoryUtils.groupHistoryByDate(entries);
  assert(typeof groups[0].label === 'string' && groups[0].label.length > 0);
});

test('total entry count preserved across all groups', function () {
  const entries = [];
  for (let i = 0; i < 50; i++) entries.push({ ActionDate: `2026-01-${String((i % 5) + 1).padStart(2,'0')} 10:00:00` });
  const groups = HistoryUtils.groupHistoryByDate(entries);
  const total = groups.reduce(function (sum, g) { return sum + g.entries.length; }, 0);
  assertEqual(total, 50);
});

// ── isToday ──────────────────────────────────────────────────────
console.log('\nisToday:');

test('returns false for a well-known past date', function () {
  assert(!HistoryUtils.isToday('2000-01-01'));
});

test('returns false for a far-future date', function () {
  assert(!HistoryUtils.isToday('2099-12-31'));
});

test('returns true for today\'s date', function () {
  const t = new Date();
  const key = t.getFullYear() + '-' +
    String(t.getMonth() + 1).padStart(2, '0') + '-' +
    String(t.getDate()).padStart(2, '0');
  assert(HistoryUtils.isToday(key), 'isToday should return true for ' + key);
});

test('returns false for null', function () {
  assert(!HistoryUtils.isToday(null));
});

test('returns false for empty string', function () {
  assert(!HistoryUtils.isToday(''));
});

test('returns false for unknown key', function () {
  assert(!HistoryUtils.isToday('unknown'));
});

// ── _formatDateLabel ─────────────────────────────────────────────
console.log('\n_formatDateLabel:');

test('formats April 29 2026 correctly', function () {
  const label = HistoryUtils._formatDateLabel('2026-04-29');
  assert(label.includes('2026'), 'Should include year 2026');
  assert(label.includes('April'), 'Should include month name April');
  assert(label.includes('29'), 'Should include day 29');
});

test('formats January 1 correctly', function () {
  const label = HistoryUtils._formatDateLabel('2026-01-01');
  assert(label.includes('January'), 'Should include January');
  assert(label.includes('2026'), 'Should include 2026');
});

test('returns "Unknown" for null', function () {
  assertEqual(HistoryUtils._formatDateLabel(null), 'Unknown');
});

test('returns "Unknown" for empty string', function () {
  assertEqual(HistoryUtils._formatDateLabel(''), 'Unknown');
});

test('returns "Unknown" for the "unknown" sentinel', function () {
  assertEqual(HistoryUtils._formatDateLabel('unknown'), 'Unknown');
});

// ── Summary ──────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
