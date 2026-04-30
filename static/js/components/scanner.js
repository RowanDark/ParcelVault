/* scanner.js – camera-based label scanner component
 * Depends on: TrackingParser (trackingParser.js), BarcodeService (barcodeService.js),
 *             OcrService (ocrService.js),
 *             Bootstrap 5 (modal), Tesseract.js (CDN).
 *
 * Public API (attached to window):
 *   PvScanner.open({ tracking, shipper, recipient })
 *     Opens the scanner modal and wires extracted values to the given field IDs.
 */
(function () {
  'use strict';

  // ── Scanner modal markup ─────────────────────────────────────
  var MODAL_HTML = [
    '<div class="modal fade" id="pv-scanner-modal" tabindex="-1" aria-labelledby="pvScannerLabel" aria-hidden="true">',
    '  <div class="modal-dialog modal-dialog-centered modal-lg">',
    '    <div class="modal-content">',

    '      <div class="modal-header">',
    '        <h5 class="modal-title" id="pvScannerLabel">',
    '          <i class="bi bi-camera me-2"></i>Scan Package Label',
    '        </h5>',
    '        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>',
    '      </div>',

    '      <div class="modal-body p-0">',

    '        <!-- live camera preview -->',
    '        <div id="pv-scan-preview">',
    '          <div class="pv-scanner-viewfinder">',
    '            <div id="pv-scan-reader" style="width:100%;min-height:300px;"></div>',
    '            <div class="pv-scan-overlay">',
    '              <div class="pv-scan-mask"></div>',
    '              <div class="pv-scan-frame">',
    '                <div class="pv-scan-corner tl"></div>',
    '                <div class="pv-scan-corner tr"></div>',
    '                <div class="pv-scan-corner bl"></div>',
    '                <div class="pv-scan-corner br"></div>',
    '                <div class="pv-scan-line"></div>',
    '              </div>',
    '            </div>',
    '          </div>',
    '          <div class="p-3 text-center">',
    '            <p class="text-secondary small mb-2">Position the shipping label within the frame for auto barcode scanning. If needed, tap Capture for OCR fallback.</p>',
    '            <p id="pv-barcode-status" class="small text-secondary mb-2">Initializing camera…</p>',
    '            <div id="pv-debug-overlay" class="small text-start border rounded p-2 mb-2 bg-light">',
    '              <div><strong>Resolution:</strong> <span id="pv-debug-resolution">-</span></div>',
    '              <div><strong>Scan FPS:</strong> <span id="pv-debug-fps">0</span></div>',
    '              <div><strong>Formats:</strong> <span id="pv-debug-formats">-</span></div>',
    '              <div><strong>TTFD:</strong> <span id="pv-debug-ttfd">-</span></div>',
    '              <div><strong>Status:</strong> <span id="pv-debug-status">idle</span></div>',
    '            </div>',
    '            <div class="d-flex justify-content-center gap-2">',
    '            <button type="button" class="btn btn-primary px-5" id="pv-capture-btn">',
    '              <i class="bi bi-camera-fill me-2"></i>Capture',
    '            </button>',
    '            </div>',
    '          </div>',
    '        </div>',

    '        <!-- OCR in progress -->',
    '        <div id="pv-scan-processing" style="display:none">',
    '          <div class="pv-scanner-viewfinder">',
    '            <img id="pv-scan-captured-img" class="pv-captured-img" alt="Captured label">',
    '          </div>',
    '          <div class="p-3">',
    '            <div class="d-flex align-items-center gap-3 mb-2">',
    '              <div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Processing…</span></div>',
    '              <span id="pv-ocr-status" class="text-secondary small">Initialising OCR engine…</span>',
    '            </div>',
    '            <div class="progress" style="height:4px">',
    '              <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" id="pv-ocr-progress" style="width:0%"></div>',
    '            </div>',
    '          </div>',
    '        </div>',

    '        <!-- parsed results confirmation -->',
    '        <div id="pv-scan-results" style="display:none">',
    '          <div class="pv-scanner-viewfinder">',
    '            <img id="pv-scan-result-img" class="pv-captured-img" alt="Scanned label">',
    '          </div>',
    '          <div class="p-3">',
    '            <div id="pv-low-conf-warning" class="alert alert-warning d-none py-2">',
    '              <i class="bi bi-exclamation-triangle-fill me-1"></i>',
    '              OCR confidence is low — please verify the extracted values before saving.',
    '            </div>',
    '            <div id="pv-no-tracking-warning" class="alert alert-danger d-none py-2">',
    '              <i class="bi bi-x-circle-fill me-1"></i>',
    '              No tracking number detected. Retake the photo or enter it manually.',
    '            </div>',
    '            <div id="pv-result-fields"></div>',
    '          </div>',
    '        </div>',

    '        <!-- ambiguous: multiple tracking numbers found -->',
    '        <div id="pv-scan-ambiguous" style="display:none">',
    '          <div class="p-3">',
    '            <div class="alert alert-warning py-2 mb-3">',
    '              <i class="bi bi-question-circle-fill me-1"></i>',
    '              Multiple tracking numbers found. Select the correct one:',
    '            </div>',
    '            <div id="pv-candidate-list" class="list-group"></div>',
    '          </div>',
    '        </div>',

    '        <!-- camera / OCR error -->',
    '        <div id="pv-scan-error" style="display:none">',
    '          <div class="p-4 text-center">',
    '            <i class="bi bi-camera-video-off display-4 text-secondary mb-3 d-block"></i>',
    '            <p id="pv-error-message" class="text-secondary mb-0"></p>',
    '          </div>',
    '        </div>',

    '      </div>',

    '      <div class="modal-footer">',
    '        <button type="button" class="btn btn-outline-secondary" id="pv-retake-btn" style="display:none">',
    '          <i class="bi bi-arrow-counterclockwise me-1"></i>Retake',
    '        </button>',
    '        <button type="button" class="btn btn-primary" id="pv-use-btn" style="display:none">',
    '          <i class="bi bi-check-lg me-1"></i>Use These Values',
    '        </button>',
    '        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>',
    '      </div>',

    '    </div>',
    '  </div>',
    '</div>',
    '<canvas id="pv-scan-canvas" style="display:none"></canvas>',
  ].join('\n');

  // ── Module state ─────────────────────────────────────────────
  var _stream         = null;
  var _capturedDataUrl = null;
  var _fieldConfig    = null;
  var _scanLoopHandle = null;
  var _html5Scanner = null;
  var _lastScanAt = 0;
  var _startupTimeoutHandle = null;
  var _diag = { attempts: 0, failures: 0, successes: 0, fps: 0, lastFpsAt: 0, frames: 0, startAt: 0, firstDecodeMs: null, lastFormat: '-' };

  function _safeBind(id, event, handler) {
    var el = document.getElementById(id);
    if (!el) {
      console.warn('Missing element: ' + id);
      return null;
    }
    el.addEventListener(event, handler);
    return el;
  }

  // ── Bootstrap the modal DOM once ────────────────────────────
  function _init() {
    if (document.getElementById('pv-scanner-modal')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = MODAL_HTML;
    document.body.appendChild(wrap);

    _safeBind('pv-capture-btn', 'click', _captureFrame);
    _safeBind('pv-retake-btn', 'click', _resetToPreview);
    _safeBind('pv-use-btn', 'click', _applyResults);

    _safeBind('pv-scanner-modal', 'hidden.bs.modal', _stopCamera);
    _safeBind('pv-scanner-modal', 'shown.bs.modal', function () {
      requestAnimationFrame(function () {
        setTimeout(_startCamera, 80);
      });
    });
  }

  // ── Public: open scanner wired to a form ─────────────────────
  function open(fieldConfig) {
    // fieldConfig: { tracking: 'element-id', shipper: 'element-id', recipient: 'element-id' }
    _fieldConfig = fieldConfig || {};
    _init();
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('pv-scanner-modal')
    ).show();
  }

  // ── Camera lifecycle ─────────────────────────────────────────
  function _startCamera() {
    _showState('preview');
    _diag.startAt = performance.now();
    _diag.firstDecodeMs = null;
    _diag.lastFormat = '-';
    _stream = true; // sentinel — signals camera is active to _captureAndApplyCandidate
    _beginHtml5Loop();
  }

  function _stopCamera() {
    if (_startupTimeoutHandle) {
      clearTimeout(_startupTimeoutHandle);
      _startupTimeoutHandle = null;
    }
    if (_scanLoopHandle) {
      cancelAnimationFrame(_scanLoopHandle);
      _scanLoopHandle = null;
    }
    if (_stream && typeof _stream === 'object' && _stream.getTracks) {
      _stream.getTracks().forEach(function (t) { t.stop(); });
    }
    _stream = null;
    if (_html5Scanner && _html5Scanner.stop) {
      _html5Scanner.stop().catch(function () {}).finally(function () {
        if (_html5Scanner && _html5Scanner.clear) _html5Scanner.clear().catch(function () {});
        _html5Scanner = null;
      });
    }
  }

  // ── Capture a frame from the video feed ──────────────────────
  function _captureFrame() {
    var video  = document.querySelector('#pv-scan-reader video');
    var canvas = document.getElementById('pv-scan-canvas');

    if (!video || !video.videoWidth) {
      _showError('Camera is not ready yet. Please wait a moment and try again.');
      return;
    }

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    _capturedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

    document.getElementById('pv-scan-captured-img').src = _capturedDataUrl;
    document.getElementById('pv-scan-result-img').src   = _capturedDataUrl;

    _stopCamera();
    _runOcr();
  }

  function _beginHtml5Loop() {
    var status = document.getElementById('pv-barcode-status');
    var container = document.getElementById('pv-scan-preview');
    if (!window.Html5Qrcode) { _showError('html5-qrcode is not available.'); return; }
    if (!container) { _showError('Scanner container is missing.'); return; }

    var readerEl = document.getElementById('pv-scan-reader');
    if (!readerEl) {
      _showError('Scanner reader element not found.');
      return;
    }
    var rect = readerEl.getBoundingClientRect();
    console.info('[Scanner] scanner init start');
    console.info('[Scanner] reader dimensions', { width: Math.round(rect.width), height: Math.round(rect.height) });
    if (rect.width <= 0 || rect.height <= 0) {
      _showError('Scanner reader element has no dimensions — check CSS.');
      return;
    }

    _diag.attempts = 0; _diag.failures = 0; _diag.successes = 0; _diag.frames = 0; _diag.lastFpsAt = performance.now();
    if (status) status.textContent = 'Scanning barcode…';
    _updateDebugOverlay('html5-starting');
    _html5Scanner = new Html5Qrcode('pv-scan-reader');
    var formats = [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.PDF_417,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.EAN_13,
    ];
    var settled = false;

    if (_startupTimeoutHandle) clearTimeout(_startupTimeoutHandle);
    _startupTimeoutHandle = setTimeout(function () {
      if (settled) return;
      console.error('[Scanner] start() timed out after 5 seconds');
      _showError('Scanner failed to initialize');
    }, 5000);

    console.info('[Scanner] start() invocation');
    _html5Scanner.start({ facingMode: "environment" }, { fps: 10, formatsToSupport: formats, qrbox: function (vw, vh) { var w = Math.floor(vw * 0.85); var h = Math.floor(vh * 0.55); return { width: w, height: h }; } },
      function (decodedText, decodedResult) {
        _diag.attempts += 1; _diag.successes += 1;
        if (_diag.firstDecodeMs == null) _diag.firstDecodeMs = Math.round(performance.now() - _diag.startAt);
        _diag.lastFormat = decodedResult && decodedResult.result && decodedResult.result.format ? decodedResult.result.format.formatName : _diag.lastFormat;
        _updateDebugOverlay('decode-success');
        BarcodeService.normalizeDecodedText(decodedText).then(function (candidates) {
          if (!candidates || !candidates.length || !_html5Scanner) return;
          _captureAndApplyCandidate(candidates[0]);
        });
      },
      function () { _diag.failures += 1; _updateDebugOverlay('decode-failed'); }
    ).then(function () {
      settled = true;
      if (_startupTimeoutHandle) { clearTimeout(_startupTimeoutHandle); _startupTimeoutHandle = null; }
      console.info('[Scanner] start() resolution');
    }).catch(function (err) {
      settled = true;
      if (_startupTimeoutHandle) { clearTimeout(_startupTimeoutHandle); _startupTimeoutHandle = null; }
      console.error('[Scanner] start() rejection', err);
      _showError('Failed to start html5-qrcode scanner: ' + err);
    });
  }

  function _captureAndApplyCandidate(candidate) {
    var video = document.querySelector('#pv-scan-reader video');
    var canvas = document.getElementById('pv-scan-canvas');
    if (!video) {
      // No video frame to capture — apply results without a thumbnail
      _stopCamera();
      _signalScanSuccess();
      _showResults(candidate, null, false);
      _applyResults();
      return;
    }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    _capturedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    document.getElementById('pv-scan-result-img').src = _capturedDataUrl;
    _stopCamera(); _signalScanSuccess(); _showResults(candidate, null, false); _applyResults();
  }

  function _signalScanSuccess() {
    var preview = document.getElementById('pv-scan-preview');
    var status = document.getElementById('pv-barcode-status');
    if (status) status.textContent = 'Barcode detected ✓';
    if (preview) {
      preview.classList.add('pv-scan-success');
      setTimeout(function () { preview.classList.remove('pv-scan-success'); }, 900);
    }
    if (navigator.vibrate) {
      navigator.vibrate([120, 40, 120]);
    }
    try {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1046;
      gain.gain.value = 0.03;
      osc.connect(gain); gain.connect(ac.destination);
      osc.start();
      setTimeout(function () { osc.stop(); ac.close(); }, 90);
    } catch (_) {}
  }
// ── OCR pipeline ─────────────────────────────────────────────
  function _runOcr() {
    _showState('processing');
    var progressBar = document.getElementById('pv-ocr-progress');
    var statusText  = document.getElementById('pv-ocr-status');

    statusText.textContent = 'Loading OCR engine…';

    OcrService.recognize(_capturedDataUrl, function (p) {
      statusText.textContent = 'Recognising text… ' + Math.round(p * 100) + '%';
      progressBar.style.width = (p * 100) + '%';
    })
    .then(function (result) {
      var candidates = TrackingParser.extractTracking(result.text);
      var recipient  = TrackingParser.extractRecipient(result.text);

      if (candidates.length === 0) {
        _showNoTracking(result.isLowConfidence);
      } else if (candidates.length === 1) {
        _showResults(candidates[0], recipient, result.isLowConfidence);
      } else {
        _showAmbiguous(candidates, recipient, result.isLowConfidence);
      }
    })
    .catch(function (err) {
      _showError('OCR failed: ' + err.message);
    });
  }

  // ── Result states ─────────────────────────────────────────────
  function _showResults(candidate, recipient, isLowConf) {
    var carrier = TrackingParser.detectCarrier(candidate.tracking) || candidate.carrier;
    var html = [
      '<div class="mb-2">',
      '  <label class="form-label">Tracking Number</label>',
      '  <input type="text" class="form-control pv-result-tracking" value="' + _esc(candidate.tracking) + '" readonly>',
      '</div>',
      '<div class="mb-2">',
      '  <label class="form-label">Carrier</label>',
      '  <input type="text" class="form-control pv-result-carrier" value="' + _esc(carrier) + '" readonly>',
      '</div>',
    ];

    if (recipient) {
      html.push(
        '<div class="mb-2">',
        '  <label class="form-label">Recipient</label>',
        '  <input type="text" class="form-control pv-result-recipient" value="' + _esc(recipient) + '" readonly>',
        '</div>'
      );
    }

    document.getElementById('pv-result-fields').innerHTML = html.join('\n');
    document.getElementById('pv-low-conf-warning').classList.toggle('d-none', !isLowConf);
    document.getElementById('pv-no-tracking-warning').classList.add('d-none');

    _showState('results');
    document.getElementById('pv-retake-btn').style.display = '';
    document.getElementById('pv-use-btn').style.display    = '';
  }

  function _showNoTracking(isLowConf) {
    document.getElementById('pv-result-fields').innerHTML = '';
    document.getElementById('pv-no-tracking-warning').classList.remove('d-none');
    document.getElementById('pv-low-conf-warning').classList.toggle('d-none', !isLowConf);

    _showState('results');
    document.getElementById('pv-retake-btn').style.display = '';
    document.getElementById('pv-use-btn').style.display    = 'none';
  }

  function _showAmbiguous(candidates, recipient, isLowConf) {
    var listDiv = document.getElementById('pv-candidate-list');
    listDiv.innerHTML = candidates.map(function (c, idx) {
      return [
        '<button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-idx="' + idx + '">',
        '  <code style="color:var(--pv-accent)">' + _esc(c.tracking) + '</code>',
        '  <span class="badge bg-secondary">' + _esc(c.carrier) + '</span>',
        '</button>',
      ].join('');
    }).join('');

    listDiv.querySelectorAll('button[data-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _showResults(candidates[parseInt(btn.dataset.idx, 10)], recipient, isLowConf);
      });
    });

    _showState('ambiguous');
    document.getElementById('pv-retake-btn').style.display = '';
    document.getElementById('pv-use-btn').style.display    = 'none';
  }

  // ── Apply extracted values to the intake form ─────────────────
  function _applyResults() {
    var trackingEl  = document.querySelector('.pv-result-tracking');
    var carrierEl   = document.querySelector('.pv-result-carrier');
    var recipientEl = document.querySelector('.pv-result-recipient');

    if (trackingEl && _fieldConfig.tracking) {
      var tf = document.getElementById(_fieldConfig.tracking);
      if (tf) {
        tf.value = trackingEl.value;
        tf.dispatchEvent(new Event('input')); // trigger duplicate-check debounce
      }
    }

    if (carrierEl && _fieldConfig.shipper) {
      var sf = document.getElementById(_fieldConfig.shipper);
      if (sf) {
        var target = carrierEl.value.toLowerCase();
        var opt = Array.from(sf.options).find(function (o) {
          return o.value.toLowerCase() === target;
        });
        if (opt) sf.value = opt.value;
      }
    }

    // Only autofill recipient when the field is currently empty.
    if (recipientEl && _fieldConfig.recipient) {
      var rf = document.getElementById(_fieldConfig.recipient);
      if (rf && !rf.value.trim()) rf.value = recipientEl.value;
    }

    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('pv-scanner-modal')
    ).hide();
  }

  // ── UI helpers ────────────────────────────────────────────────
  var ALL_STATES = ['preview', 'processing', 'results', 'ambiguous', 'error'];

  function _showState(state) {
    ALL_STATES.forEach(function (s) {
      var el = document.getElementById('pv-scan-' + s);
      if (el) el.style.display = s === state ? '' : 'none';
    });
    // Footer buttons are managed per-state by the callers above.
    if (state === 'preview' || state === 'processing') {
      document.getElementById('pv-retake-btn').style.display = 'none';
      document.getElementById('pv-use-btn').style.display    = 'none';
    }
  }

  function _showError(message) {
    document.getElementById('pv-error-message').textContent = message;
    _showState('error');
    document.getElementById('pv-retake-btn').style.display = '';
  }

  function _resetToPreview() {
    document.getElementById('pv-retake-btn').style.display = 'none';
    document.getElementById('pv-use-btn').style.display    = 'none';
    _startCamera();
  }


  function _updateDebugOverlay(status) {
    var video = document.querySelector('#pv-scan-reader video');
    var res = document.getElementById('pv-debug-resolution');
    var fps = document.getElementById('pv-debug-fps');
    var fmts = document.getElementById('pv-debug-formats');
    var st = document.getElementById('pv-debug-status');
    var ttfd = document.getElementById('pv-debug-ttfd');
    if (res && video) res.textContent = (video.videoWidth || 0) + 'x' + (video.videoHeight || 0);
    if (fps) fps.textContent = String(_diag.fps || 0);
    if (fmts) fmts.textContent = 'CODE_128, QR_CODE, PDF_417, DATA_MATRIX, CODE_39, ITF, EAN_13';
    if (ttfd) ttfd.textContent = _diag.firstDecodeMs == null ? '-' : (_diag.firstDecodeMs + ' ms');
    if (st) st.textContent = status + ' | attempts:' + _diag.attempts + ' failures:' + _diag.failures + ' successes:' + _diag.successes + ' format:' + _diag.lastFormat;
  }

  function _esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Expose public API ─────────────────────────────────────────
  window.PvScanner = { open: open };
})();
