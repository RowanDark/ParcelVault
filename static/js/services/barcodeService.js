/* barcodeService.js – barcode-first label scanner using @zxing/browser
 * Depends on: window.ZXingBrowser (UMD build from CDN), TrackingParser
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../utils/trackingParser'));
  } else {
    root.BarcodeService = factory(root.TrackingParser);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TrackingParser) {
  'use strict';

  var READ_FORMATS = [
    'QRCode',
    'Code128',
    'PDF417',
    'DataMatrix',
  ];

  function _buildHints(zx) {
    var hints = new Map();
    var formats = READ_FORMATS
      .map(function (name) { return zx.BarcodeFormat[name]; })
      .filter(Boolean);
    hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(zx.DecodeHintType.TRY_HARDER, true);
    return hints;
  }

  function decodeFromImageDataUrl(dataUrl, options) {
    return new Promise(function (resolve) {
      if (!TrackingParser || !window.ZXingBrowser || !window.ZXing) {
        resolve([]);
        return;
      }

      var zxBrowser = window.ZXingBrowser;
      var zx = window.ZXing;
      var reader = new zxBrowser.BrowserMultiFormatReader(_buildHints(zx));
      var onAttempt = options && typeof options.onAttempt === 'function' ? options.onAttempt : null;
      var onFailure = options && typeof options.onFailure === 'function' ? options.onFailure : null;
      var onSuccess = options && typeof options.onSuccess === 'function' ? options.onSuccess : null;
      var img = new Image();
      img.onload = function () {
        try {
          if (onAttempt) onAttempt();
          var result = reader.decodeFromImageElement(img);
          var raw = result && result.getText ? result.getText() : '';
          var format = result && result.getBarcodeFormat ? String(result.getBarcodeFormat()) : '';
          if (!raw) {
            if (onFailure) onFailure('empty-result');
            resolve([]);
            return;
          }
          var parsed = TrackingParser.extractTracking(raw);
          if (parsed.length) {
            var prioritized = _prioritizeCandidates(parsed);
            if (onSuccess) onSuccess(prioritized, { format: format });
            resolve(prioritized);
            return;
          }
          var carrier = TrackingParser.detectCarrier(raw);
          var normalized = carrier ? _prioritizeCandidates([{ tracking: raw.replace(/\s/g, ''), carrier: carrier }]) : [];
          if (normalized.length && onSuccess) onSuccess(normalized, { format: format });
          if (!normalized.length && onFailure) onFailure('unparsed-result');
          resolve(normalized);
        } catch (e) {
          if (onFailure) onFailure(e && e.message ? e.message : 'decode-exception');
          resolve([]);
        }
      };
      img.onerror = function () { if (onFailure) onFailure('image-load-error'); resolve([]); };
      img.src = dataUrl;
    });
  }

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
    decodeFromImageDataUrl: decodeFromImageDataUrl,
    normalizeDecodedText: normalizeDecodedText,
    READ_FORMATS: READ_FORMATS,
  };
});
