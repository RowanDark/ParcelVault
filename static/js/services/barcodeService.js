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

  function decodeFromImageDataUrl(dataUrl) {
    return new Promise(function (resolve) {
      if (!TrackingParser || !window.ZXingBrowser || !window.ZXing) {
        resolve([]);
        return;
      }

      var zxBrowser = window.ZXingBrowser;
      var zx = window.ZXing;
      var reader = new zxBrowser.BrowserMultiFormatReader(_buildHints(zx));
      var img = new Image();
      img.onload = function () {
        try {
          var result = reader.decodeFromImageElement(img);
          var raw = result && result.getText ? result.getText() : '';
          if (!raw) {
            resolve([]);
            return;
          }
          var parsed = TrackingParser.extractTracking(raw);
          if (parsed.length) {
            resolve(_prioritizeCandidates(parsed));
            return;
          }
          var carrier = TrackingParser.detectCarrier(raw);
          resolve(carrier ? _prioritizeCandidates([{ tracking: raw.replace(/\s/g, ''), carrier: carrier }]) : []);
        } catch (e) {
          resolve([]);
        }
      };
      img.onerror = function () { resolve([]); };
      img.src = dataUrl;
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
    READ_FORMATS: READ_FORMATS,
  };
});
