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

  var READ_FORMATS = ['CODE_128', 'QR_CODE', 'PDF_417', 'DATA_MATRIX', 'CODE_39', 'ITF', 'EAN_13'];

  function normalizeDecodedText(raw) {
    return new Promise(function (resolve) {
      if (!raw || !TrackingParser) { resolve([]); return; }

      // Extract tracking number from URL-encoded QR codes (Amazon, some USPS labels
      // encode URLs rather than raw tracking numbers)
      var textToSearch = raw;
      try {
        var url = new URL(raw);
        var fromParam = url.searchParams.get('trackingId') ||
                        url.searchParams.get('orderId')    ||
                        url.searchParams.get('itemId');
        if (fromParam) textToSearch = fromParam;
      } catch (_) {
        // Not a URL — use raw text as-is
      }

      var parsed = TrackingParser.extractTracking(textToSearch);
      if (parsed.length) { resolve(_prioritizeCandidates(parsed)); return; }
      var carrier = TrackingParser.detectCarrier(textToSearch);
      resolve(carrier ? _prioritizeCandidates([{ tracking: textToSearch.replace(/\s/g, ''), carrier: carrier }]) : []);
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
