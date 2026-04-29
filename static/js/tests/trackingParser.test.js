/* trackingParser.test.js – unit tests for tracking number extraction and recipient detection
 * Run with Node.js:  node static/js/tests/trackingParser.test.js
 */
'use strict';

const TrackingParser = require('../utils/trackingParser');

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

// ── normalizeText ────────────────────────────────────────────
console.log('\nnormalizeText:');

test('collapses multiple spaces to one', function () {
  assertEqual(TrackingParser.normalizeText('foo   bar'), 'foo bar');
});

test('normalises CRLF to LF', function () {
  assertEqual(TrackingParser.normalizeText('foo\r\nbar'), 'foo\nbar');
});

test('trims leading and trailing whitespace', function () {
  assertEqual(TrackingParser.normalizeText('  hello  '), 'hello');
});

test('replaces pipe character with I', function () {
  const result = TrackingParser.normalizeText('1Z|99');
  assert(result.includes('I'), 'pipe should become I');
});

// ── extractTracking ──────────────────────────────────────────
console.log('\nextractTracking:');

test('extracts a UPS tracking number', function () {
  const r = TrackingParser.extractTracking('Package 1Z999AA10123456784 received today');
  assert(r.length >= 1, 'should find at least one candidate');
  assert(r.some(function (c) { return c.tracking === '1Z999AA10123456784' && c.carrier === 'UPS'; }),
    'should find the UPS number with correct carrier');
});

test('extracts an Amazon TBA tracking number', function () {
  const r = TrackingParser.extractTracking('Your Amazon delivery TBA123456789000US is out for delivery');
  assert(r.some(function (c) { return c.tracking === 'TBA123456789000US' && c.carrier === 'Amazon'; }),
    'should find Amazon TBA number');
});

test('extracts a USPS tracking number with spaces', function () {
  const r = TrackingParser.extractTracking('9400 1118 9922 3456 7890 00 delivered');
  const found = r.some(function (c) { return c.tracking.replace(/\s/g, '') === '9400111899223456789000'; });
  assert(found, 'should compact and extract the USPS number');
});

test('extracts a USPS tracking number without spaces', function () {
  const r = TrackingParser.extractTracking('9400111899223456789000');
  assert(r.some(function (c) { return c.tracking === '9400111899223456789000' && c.carrier === 'USPS'; }),
    'should extract USPS without spaces');
});

test('extracts a FedEx 12-digit tracking number', function () {
  const r = TrackingParser.extractTracking('FedEx: 123456789012');
  assert(r.some(function (c) { return c.tracking === '123456789012'; }),
    'should extract 12-digit FedEx number');
});

test('extracts a FedEx 15-digit tracking number', function () {
  const r = TrackingParser.extractTracking('Tracking: 123456789012345');
  assert(r.some(function (c) { return c.tracking === '123456789012345'; }),
    'should extract 15-digit FedEx number');
});

test('extracts a DHL international tracking number', function () {
  const r = TrackingParser.extractTracking('DHL ref JD014600006962DE');
  assert(r.some(function (c) { return c.tracking === 'JD014600006962DE'; }),
    'should extract DHL JD number');
});

test('returns an empty array when no tracking number is present', function () {
  const r = TrackingParser.extractTracking('Hello world, no numbers here at all.');
  assertEqual(r.length, 0, 'should return empty array');
});

test('longer match is preferred over a substring match', function () {
  // The 22-char USPS number should survive; any shorter digit subset should be removed.
  const r = TrackingParser.extractTracking('9400111899223456789000 end');
  assert(r.length >= 1 && r[0].tracking.length >= 22,
    'longest candidate should be first');
});

test('deduplicates the same number extracted from both sources', function () {
  // "1Z999AA10123456784" should not appear twice.
  const r = TrackingParser.extractTracking('1Z999AA10123456784');
  const ups = r.filter(function (c) { return c.tracking === '1Z999AA10123456784'; });
  assertEqual(ups.length, 1, 'UPS number should appear exactly once');
});

// ── detectCarrier ────────────────────────────────────────────
console.log('\ndetectCarrier:');

test('detects UPS', function () {
  assertEqual(TrackingParser.detectCarrier('1Z999AA10123456784'), 'UPS');
});

test('detects Amazon', function () {
  assertEqual(TrackingParser.detectCarrier('TBA123456789000US'), 'Amazon');
});

test('detects USPS (94-prefix)', function () {
  assertEqual(TrackingParser.detectCarrier('9400111899223456789000'), 'USPS');
});

test('detects USPS (92-prefix)', function () {
  assertEqual(TrackingParser.detectCarrier('9261290100830121501429'), 'USPS');
});

test('detects FedEx 12-digit', function () {
  assertEqual(TrackingParser.detectCarrier('123456789012'), 'FedEx');
});

test('detects FedEx 15-digit', function () {
  assertEqual(TrackingParser.detectCarrier('123456789012345'), 'FedEx');
});

test('detects DHL international (2-letter prefix)', function () {
  assertEqual(TrackingParser.detectCarrier('JD014600006962DE'), 'DHL');
});

test('returns null for an unrecognised format', function () {
  assertEqual(TrackingParser.detectCarrier('ABC123'), null);
});

// ── extractRecipient ─────────────────────────────────────────
console.log('\nextractRecipient:');

test('extracts recipient from "Ship To: Name" on same line', function () {
  assertEqual(
    TrackingParser.extractRecipient('Ship To: John Smith\n123 Main St\nAnytown CA 90210'),
    'John Smith'
  );
});

test('extracts recipient from "Ship To" label followed by name on next line', function () {
  assertEqual(
    TrackingParser.extractRecipient('Ship To\nJane Doe\n456 Oak Ave'),
    'Jane Doe'
  );
});

test('extracts recipient from "Recipient:" label on same line', function () {
  assertEqual(
    TrackingParser.extractRecipient('Recipient: Bob Johnson\nDept: Engineering'),
    'Bob Johnson'
  );
});

test('extracts recipient from "ATTN:" label', function () {
  assertEqual(
    TrackingParser.extractRecipient('ATTN: Sarah Williams\nSome Company'),
    'Sarah Williams'
  );
});

test('returns null when no labelled recipient is found', function () {
  assertEqual(
    TrackingParser.extractRecipient('9400111899223456789000\nFedEx Ground'),
    null
  );
});

test('does not return an address line starting with a digit as recipient', function () {
  const r = TrackingParser.extractRecipient('Ship To\n123 Main Street\nJohn Smith');
  assert(r !== '123 Main Street', 'address line should not be returned as recipient');
});

// ── _isLikelyName ────────────────────────────────────────────
console.log('\n_isLikelyName:');

test('accepts a typical full name', function () {
  assert(TrackingParser._isLikelyName('John Smith'));
});

test('accepts a department name', function () {
  assert(TrackingParser._isLikelyName('Engineering Department'));
});

test('accepts an all-caps name', function () {
  assert(TrackingParser._isLikelyName('JANE DOE'));
});

test('rejects a 5-digit zip code', function () {
  assert(!TrackingParser._isLikelyName('90210'));
});

test('rejects a string starting with a digit', function () {
  assert(!TrackingParser._isLikelyName('123 Main Street'));
});

test('rejects a mostly-numeric string', function () {
  assert(!TrackingParser._isLikelyName('1Z999AA10123456784'));
});

test('rejects known carrier keywords', function () {
  assert(!TrackingParser._isLikelyName('FedEx Express'));
  assert(!TrackingParser._isLikelyName('USPS Priority Mail'));
});

test('rejects a string shorter than 3 characters', function () {
  assert(!TrackingParser._isLikelyName('Ab'));
});

// ── Summary ──────────────────────────────────────────────────
console.log('\n' + '-'.repeat(40));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
