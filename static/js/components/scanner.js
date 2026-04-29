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
    '            <video id="pv-scan-video" autoplay playsinline muted></video>',
    '            <div class="pv-scan-overlay">',
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
    '            <button type="button" class="btn btn-primary px-5" id="pv-capture-btn">',
    '              <i class="bi bi-camera-fill me-2"></i>Capture',
    '            </button>',
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
  var _lastScanAt = 0;

  // ── Bootstrap the modal DOM once ────────────────────────────
  function _init() {
    if (document.getElementById('pv-scanner-modal')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = MODAL_HTML;
    document.body.appendChild(wrap);

    document.getElementById('pv-capture-btn').addEventListener('click', _captureFrame);
    document.getElementById('pv-retake-btn').addEventListener('click', _resetToPreview);
    document.getElementById('pv-use-btn').addEventListener('click', _applyResults);

    document.getElementById('pv-scanner-modal').addEventListener('hidden.bs.modal', _stopCamera);
  }

  // ── Public: open scanner wired to a form ─────────────────────
  function open(fieldConfig) {
    // fieldConfig: { tracking: 'element-id', shipper: 'element-id', recipient: 'element-id' }
    _fieldConfig = fieldConfig || {};
    _init();
    _startCamera();
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('pv-scanner-modal')
    ).show();
  }

  // ── Camera lifecycle ─────────────────────────────────────────
  function _startCamera() {
    _showState('preview');
    var video = document.getElementById('pv-scan-video');
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      .then(function (stream) {
        _stream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = function () {
          _beginBarcodeLoop();
        };
      })
      .catch(function (err) {
        var msg = err.name === 'NotAllowedError'
          ? 'Camera access was denied. Please allow camera permissions and try again.'
          : 'Could not access camera: ' + err.message;
        _showError(msg);
      });
  }

  function _stopCamera() {
    if (_scanLoopHandle) {
      cancelAnimationFrame(_scanLoopHandle);
      _scanLoopHandle = null;
    }
    if (_stream) {
      _stream.getTracks().forEach(function (t) { t.stop(); });
      _stream = null;
    }
  }

  // ── Capture a frame from the video feed ──────────────────────
  function _captureFrame() {
    var video  = document.getElementById('pv-scan-video');
    var canvas = document.getElementById('pv-scan-canvas');

    if (!video.videoWidth) {
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

  

  function _beginBarcodeLoop() {
    var video = document.getElementById('pv-scan-video');
    var status = document.getElementById('pv-barcode-status');

    function tick(ts) {
      if (!_stream || !video.videoWidth) return;
      if (ts - _lastScanAt >= 250) {
        _lastScanAt = ts;
        _scanBarcodeFrame();
      }
      _scanLoopHandle = requestAnimationFrame(tick);
    }

    if (status) status.textContent = 'Scanning barcode…';
    _scanLoopHandle = requestAnimationFrame(tick);
  }

  function _scanBarcodeFrame() {
    var video = document.getElementById('pv-scan-video');
    var canvas = document.getElementById('pv-scan-canvas');
    if (!video.videoWidth || !BarcodeService) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    var frame = canvas.toDataURL('image/jpeg', 0.85);

    BarcodeService.decodeFromImageDataUrl(frame).then(function (candidates) {
      if (!candidates || !candidates.length || !_stream) return;
      _capturedDataUrl = frame;
      document.getElementById('pv-scan-result-img').src = _capturedDataUrl;
      _stopCamera();
      _signalScanSuccess();
      _showResults(candidates[0], null, false);
      _applyResults();
    });
  }

  function _signalScanSuccess() {
    var preview = document.getElementById('pv-scan-preview');
    var status = document.getElementById('pv-barcode-status');
    if (status) status.textContent = 'Barcode detected ✓';
    if (preview) {
      preview.classList.add('pv-scan-success');
      setTimeout(function () { preview.classList.remove('pv-scan-success'); }, 600);
    }
    if (navigator.vibrate) navigator.vibrate(120);
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

  function _esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Expose public API ─────────────────────────────────────────
  window.PvScanner = { open: open };
})();
