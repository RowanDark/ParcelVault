/* ocrService.js – thin wrapper around Tesseract.js for label OCR
 * Requires Tesseract.js loaded as a browser global (CDN).
 * Exposes: OcrService.recognize(imageSource, onProgress)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.OcrService = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LOW_CONFIDENCE_THRESHOLD = 60;

  function _loadTesseract() {
    return new Promise(function(resolve, reject) {
      if (typeof Tesseract !== 'undefined') { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = resolve;
      s.onerror = function() {
        reject(new Error('Failed to load Tesseract.js'));
      };
      document.head.appendChild(s);
    });
  }

  /**
   * Run OCR on an image and return extracted text with a confidence score.
   *
   * @param {HTMLCanvasElement|HTMLImageElement|string} imageSource
   * @param {function(number): void} [onProgress]  called with 0–1 as text is recognised
   * @returns {Promise<{text: string, confidence: number, isLowConfidence: boolean}>}
   */
  async function recognize(imageSource, onProgress) {
    await _loadTesseract();

    const { data } = await Tesseract.recognize(imageSource, 'eng', {
      logger: function (m) {
        if (m.status === 'recognizing text' && typeof onProgress === 'function') {
          onProgress(Math.min(m.progress, 1));
        }
      },
    });

    const confidence = typeof data.confidence === 'number' ? data.confidence : 0;

    return {
      text: data.text || '',
      confidence,
      isLowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD,
    };
  }

  return { recognize, LOW_CONFIDENCE_THRESHOLD };
});
