/* barcodeService.js – decoded-text normalization for scanner pipeline
 * Depends on: TrackingParser
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../utils/trackingParser'));
  } else {
    root.BarcodeService = factory(root.TrackingParser);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TrackingParser) {
  'use strict';

  var READ_FORMATS = ['QR_CODE', 'CODE_128', 'PDF_417', 'DATA_MATRIX'];

  function normalizeDecodedText(raw) {
    return new Promise(function (resolve) {
      if (!raw || !TrackingParser) { resolve([]); return; }
      var parsed = TrackingParser.extractTracking(raw);
      if (parsed.length) { resolve(_prioritizeCandidates(parsed)); return; }
      var carrier = TrackingParser.detectCarrier(raw);
      resolve(carrier ? _prioritizeCandidates([{ tracking: raw.replace(/\s/g, ''), carrier: carrier }]) : []);
    });
  }

  function _prioritizeCandidates(candidates) {
    return (candidates || [])
      .filter(function (cand) {
        return cand && cand.tracking && cand.tracking.replace(/\s/g, '').length >= 10;
      })
      .sort(function (a, b) {
        var carrierRank = { UPS: 0, FedEx: 1, USPS: 2, DHL: 3, Amazon: 4 };
        var rankA = carrierRank[a.carrier] !== undefined ? carrierRank[a.carrier] : 9;
        var rankB = carrierRank[b.carrier] !== undefined ? carrierRank[b.carrier] : 9;
        if (rankA !== rankB) return rankA - rankB;
        return (b.tracking || '').length - (a.tracking || '').length;
      });
  }

  return {
    normalizeDecodedText: normalizeDecodedText,
    READ_FORMATS: READ_FORMATS,
  };
});
