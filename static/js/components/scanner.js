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
    '            <div id="pv-zoom-control" style="display:none;padding: 0 16px 8px;">',
    '              <label class="form-label small text-secondary mb-1">',
    '                <i class="bi bi-zoom-in me-1"></i>',
    '                Zoom: <span id="pv-zoom-value">1.0x</span>',
    '              </label>',
    '              <input type="range" class="form-range" id="pv-zoom-slider" min="1" max="3" step="0.1" value="1">',
    '            </div>',
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
  var HTML5QRCODE_CDN = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
  var ZBAR_CDN = 'https://cdn.jsdelivr.net/npm/zbar-wasm@0.10.1/dist/zbar.min.js';
  var _libraryLoadPromise = null;
  var _zbarLoadPromise = null;
  var _stream         = null;
  var _capturedDataUrl = null;
  var _fieldConfig    = null;
  var _mode           = 'barcode'; // 'barcode' | 'qr' | 'any' | 'photo'
  var _onResult       = null;
  var _scanLoopHandle = null;
  var _frameLoopActive = false;
  var _html5Scanner = null;
  var _lastScanAt = 0;
  var _startupTimeoutHandle = null;
  var _diag = { attempts: 0, failures: 0, successes: 0, fps: 0, lastFpsAt: 0, frames: 0, startAt: 0, firstDecodeMs: null, lastFormat: '-' };

  function _ensureLibrary() {
    if (window.Html5Qrcode) {
      return Promise.resolve();
    }
    if (_libraryLoadPromise) {
      return _libraryLoadPromise;
    }
    _libraryLoadPromise = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = HTML5QRCODE_CDN;
      script.onload = function() {
        _libraryLoadPromise = null;
        resolve();
      };
      script.onerror = function() {
        _libraryLoadPromise = null;
        reject(new Error(
          'Failed to load scanning library. ' +
          'Check your internet connection and try again.'
        ));
      };
      document.head.appendChild(script);
    });
    return _libraryLoadPromise;
  }

  function _ensureZbar() {
    if (window.ZBar) return Promise.resolve();
    if (_zbarLoadPromise) return _zbarLoadPromise;
    _zbarLoadPromise = new Promise(function(resolve) {
      var s = document.createElement('script');
      s.src = ZBAR_CDN;
      s.onload = function() {
        _zbarLoadPromise = null;
        resolve();
      };
      s.onerror = function() {
        _zbarLoadPromise = null;
        resolve(); // Don't reject — BarcodeDetector may still work
      };
      document.head.appendChild(s);
    });
    return _zbarLoadPromise;
  }

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
      _updateModalTitle();
      requestAnimationFrame(function () {
        setTimeout(_startCamera, 80);
      });
    });
  }

  // ── Public: open scanner wired to a form ─────────────────────
  function open(fieldConfig) {
    _fieldConfig = fieldConfig || {};
    _mode = _fieldConfig.mode || 'barcode';
    _onResult = typeof _fieldConfig.onResult === 'function'
      ? _fieldConfig.onResult
      : null;
    _init();
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('pv-scanner-modal')
    ).show();
  }

  function _updateModalTitle() {
    var el = document.getElementById('pvScannerLabel');
    if (!el) return;
    var titles = {
      barcode: '<i class="bi bi-upc-scan me-2"></i>Scan Package Barcode',
      qr:      '<i class="bi bi-qr-code-scan me-2"></i>Scan Location QR Code',
      any:     '<i class="bi bi-camera me-2"></i>Scan Label',
    };
    el.innerHTML = titles[_mode] || titles.barcode;
  }

  // ── Camera lifecycle ─────────────────────────────────────────
  function _startCamera() {
    _showState('preview');
    _diag.startAt = performance.now();
    _diag.firstDecodeMs = null;
    _diag.lastFormat = '-';
    _frameLoopActive = false;
    _stream = true; // sentinel — signals camera is active to _captureAndApplyCandidate
    var statusEl = document.getElementById('pv-barcode-status');
    if (statusEl) statusEl.textContent = 'Loading scanner…';
    if (_mode === 'photo') {
      _startPhotoCamera();
      return;
    }
    _diag.attempts = 0; _diag.failures = 0; _diag.successes = 0; _diag.frames = 0; _diag.lastFpsAt = performance.now();
    _ensureLibrary()
      .then(function() {
        var readerEl = document.getElementById('pv-scan-reader');
        if (!readerEl) { _showError('Scanner reader element not found.'); return; }
        var rect = readerEl.getBoundingClientRect();
        console.info('[Scanner] scanner init start');
        console.info('[Scanner] reader dimensions', { width: Math.round(rect.width), height: Math.round(rect.height) });
        if (rect.width <= 0 || rect.height <= 0) {
          _showError('Scanner reader element has no dimensions — check CSS.');
          return;
        }

        _updateDebugOverlay('html5-starting');
        _html5Scanner = new Html5Qrcode('pv-scan-reader', { verbose: false });

        var settled = false;
        if (_startupTimeoutHandle) clearTimeout(_startupTimeoutHandle);
        _startupTimeoutHandle = setTimeout(function() {
          if (settled) return;
          console.error('[Scanner] start() timed out after 5 seconds');
          _showError('Scanner failed to initialize');
        }, 5000);

        console.info('[Scanner] start() invocation');
        _html5Scanner.start(
          { facingMode: 'environment' },
          { fps: 1, qrbox: function(vw, vh) {
              if (_mode === 'qr') {
                var size = Math.floor(Math.min(vw, vh) * 0.60);
                return { width: size, height: size };
              }
              var w = Math.min(Math.floor(vw * 0.90), vw - 20);
              var h = Math.max(Math.floor(vh * 0.25), 80);
              return { width: w, height: h };
          }},
          function() {}, // no-op — we handle decoding in _beginDecodeLoop
          function() {}  // no-op — suppress frame errors
        ).then(function() {
          settled = true;
          if (_startupTimeoutHandle) { clearTimeout(_startupTimeoutHandle); _startupTimeoutHandle = null; }
          console.info('[Scanner] start() resolved — rear camera');
          if (_mode === 'barcode') {
            setTimeout(function() {
              _applyZoomIfSupported();
              _initZoomControl();
            }, 500);
          }
          setTimeout(function() {
            _beginDecodeLoop();
          }, 300);
        }).catch(function(err) {
          settled = true;
          if (_startupTimeoutHandle) { clearTimeout(_startupTimeoutHandle); _startupTimeoutHandle = null; }
          console.error('[Scanner] start() rejection', err);
          _showError('Camera failed to start: ' + err);
        });
      })
      .catch(function(err) {
        _stream = null;
        _showError(err.message);
      });
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
    _frameLoopActive = false;
    var photoVideo = document.getElementById('pv-photo-video');
    if (photoVideo) {
      photoVideo.srcObject = null;
      photoVideo.remove();
    }
    var overlay = document.querySelector('.pv-scan-overlay');
    if (overlay) overlay.style.display = '';
    if (_stream && typeof _stream === 'object' && _stream.getTracks) {
      _stream.getTracks().forEach(function (t) { t.stop(); });
    }
    _stream = null;
    var zoomVideo = document.querySelector('#pv-scan-reader video');
    if (zoomVideo && zoomVideo.srcObject) {
      var zoomTracks = zoomVideo.srcObject.getVideoTracks();
      if (zoomTracks && zoomTracks.length) {
        var zoomTrack = zoomTracks[0];
        if (zoomTrack.getCapabilities) {
          var zoomCaps = zoomTrack.getCapabilities();
          if (zoomCaps.zoom) {
            zoomTrack.applyConstraints({
              advanced: [{ zoom: zoomCaps.zoom.min || 1 }]
            }).catch(function() {});
          }
        }
      }
    }
    if (_html5Scanner && _html5Scanner.stop) {
      _html5Scanner.stop().catch(function () {}).finally(function () {
        if (_html5Scanner && _html5Scanner.clear) _html5Scanner.clear().catch(function () {});
        _html5Scanner = null;
      });
    }
  }

  function _startPhotoCamera() {
    _showState('preview');
    var statusEl = document.getElementById('pv-barcode-status');
    if (statusEl) statusEl.textContent = 'Camera ready — press Capture to take photo.';

    var overlay = document.querySelector('.pv-scan-overlay');
    if (overlay) overlay.style.display = 'none';

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    })
    .then(function(stream) {
      _stream = stream;
      var readerEl = document.getElementById('pv-scan-reader');
      var video = document.createElement('video');
      video.id = 'pv-photo-video';
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      if (readerEl) {
        readerEl.innerHTML = '';
        readerEl.appendChild(video);
      }
      video.srcObject = stream;
    })
    .catch(function(err) {
      var msg = err.name === 'NotAllowedError'
        ? 'Camera access denied. Please allow camera permissions.'
        : 'Could not access camera: ' + err.message;
      _showError(msg);
    });

    var captureBtn = document.getElementById('pv-capture-btn');
    if (captureBtn) {
      captureBtn.replaceWith(captureBtn.cloneNode(true));
      captureBtn = document.getElementById('pv-capture-btn');
      captureBtn.addEventListener('click', function() {
        var video = document.getElementById('pv-photo-video');
        var canvas = document.getElementById('pv-scan-canvas');
        if (!video || !video.videoWidth) {
          _showError('Camera not ready. Please wait and try again.');
          return;
        }
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        _capturedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        _stopCamera();

        if (_onResult) {
          var cb = _onResult;
          _onResult = null;
          bootstrap.Modal.getOrCreateInstance(
            document.getElementById('pv-scanner-modal')
          ).hide();
          cb(_capturedDataUrl);
        }
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
    if (_mode === 'photo' && _onResult) {
      var cb = _onResult;
      _onResult = null;
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById('pv-scanner-modal')
      ).hide();
      cb(_capturedDataUrl);
    } else {
      _runOcr();
    }
  }

  function _beginDecodeLoop() {
    var video = document.querySelector('#pv-scan-reader video');
    if (!video) {
      _showError('Camera feed not available.');
      return;
    }

    var statusEl = document.getElementById('pv-barcode-status');
    if (statusEl) statusEl.textContent = 'Scanning…';
    _updateDebugOverlay('decode-loop-start');

    var hasNativeDetector = typeof BarcodeDetector !== 'undefined';
    var hasZbar = typeof window.ZBar !== 'undefined';

    if (!hasNativeDetector && !hasZbar) {
      _ensureZbar().then(function() {
        _beginDecodeLoop();
      });
      return;
    }

    var detector = null;

    if (hasNativeDetector) {
      try {
        detector = new BarcodeDetector({
          formats: _mode === 'qr'
            ? ['qr_code', 'data_matrix']
            : ['code_128', 'code_39', 'pdf417',
               'itf', 'ean_13', 'qr_code', 'data_matrix']
        });
      } catch(e) {
        detector = null;
      }
    }

    _frameLoopActive = true;
    _scanLoopHandle = null;

    function scheduleFrame() {
      if (!_frameLoopActive) return;
      _scanLoopHandle = requestAnimationFrame(decodeFrame);
    }

    function decodeFrame() {
      if (!_frameLoopActive) return;
      if (!video.videoWidth || video.readyState < 2) {
        scheduleFrame();
        return;
      }

      _diag.frames += 1;
      _diag.attempts += 1;

      var now = performance.now();
      if (now - _diag.lastFpsAt >= 1000) {
        _diag.fps = Math.round(
          _diag.frames * 1000 / (now - _diag.lastFpsAt)
        );
        _diag.frames = 0;
        _diag.lastFpsAt = now;
        _updateDebugOverlay('fps-update');
      }

      if (detector) {
        detector.detect(video)
          .then(function(results) {
            if (!_frameLoopActive) return;
            if (results && results.length > 0) {
              var raw = results[0].rawValue;
              _diag.successes += 1;
              if (_diag.firstDecodeMs == null) {
                _diag.firstDecodeMs = Math.round(performance.now() - _diag.startAt);
              }
              _frameLoopActive = false;
              _handleDecodeResult(raw);
            } else {
              _diag.failures += 1;
              scheduleFrame();
            }
          })
          .catch(function() {
            _diag.failures += 1;
            scheduleFrame();
          });
      } else if (hasZbar) {
        var canvas = document.getElementById('pv-scan-canvas');
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        window.ZBar.scanImageData(imageData)
          .then(function(results) {
            if (!_frameLoopActive) return;
            if (results && results.length > 0) {
              var raw = results[0].decode();
              _diag.successes += 1;
              if (_diag.firstDecodeMs == null) {
                _diag.firstDecodeMs = Math.round(performance.now() - _diag.startAt);
              }
              _frameLoopActive = false;
              _handleDecodeResult(raw);
            } else {
              _diag.failures += 1;
              scheduleFrame();
            }
          })
          .catch(function() {
            _diag.failures += 1;
            scheduleFrame();
          });
      } else {
        scheduleFrame();
      }
    }

    // Load zbar in background for fallback readiness even if BarcodeDetector is available
    _ensureZbar();

    _diag.lastFpsAt = performance.now();
    _diag.frames = 0;
    scheduleFrame();
  }

  function _handleDecodeResult(raw) {
    _signalScanSuccess();
    // QR/photo mode with onResult: pass raw decoded text directly to caller
    if (_onResult && (_mode === 'qr' || _mode === 'photo')) {
      _stopCamera();
      var cb = _onResult;
      _onResult = null;
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById('pv-scanner-modal')
      ).hide();
      cb(raw);
      return;
    }
    BarcodeService.normalizeDecodedText(raw)
      .then(function(candidates) {
        if (!candidates || !candidates.length) {
          _frameLoopActive = true;
          setTimeout(function() {
            _beginDecodeLoop();
          }, 500);
          return;
        }
        _captureAndApplyCandidate(candidates[0]);
      });
  }

  function _applyZoomIfSupported() {
    var video = document.querySelector('#pv-scan-reader video');
    if (!video || !video.srcObject) return;
    var tracks = video.srcObject.getVideoTracks();
    if (!tracks || !tracks.length) return;
    var track = tracks[0];
    if (!track.getCapabilities || !track.applyConstraints) return;
    var caps = track.getCapabilities();
    if (!caps.zoom) return;
    var targetZoom = Math.min(1.8, caps.zoom.max);
    targetZoom = Math.max(targetZoom, caps.zoom.min || 1);
    track.applyConstraints({
      advanced: [{ zoom: targetZoom }]
    }).catch(function() {});
  }

  function _initZoomControl() {
    var video = document.querySelector('#pv-scan-reader video');
    if (!video || !video.srcObject) return;
    var tracks = video.srcObject.getVideoTracks();
    if (!tracks || !tracks.length) return;
    var track = tracks[0];
    if (!track.getCapabilities) return;
    var caps = track.getCapabilities();
    if (!caps.zoom) return;

    var slider = document.getElementById('pv-zoom-slider');
    var valueLabel = document.getElementById('pv-zoom-value');
    var control = document.getElementById('pv-zoom-control');
    if (!slider || !control) return;

    slider.min   = caps.zoom.min || 1;
    slider.max   = Math.min(caps.zoom.max || 3, 3);
    slider.value = 1.8;
    if (valueLabel) valueLabel.textContent = '1.8x';
    control.style.display = '';

    slider.addEventListener('input', function() {
      var zoom = parseFloat(slider.value);
      if (valueLabel) valueLabel.textContent = zoom.toFixed(1) + 'x';
      track.applyConstraints({
        advanced: [{ zoom: zoom }]
      }).catch(function() {});
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

    if (_onResult) {
      var trackingEl = document.querySelector('.pv-result-tracking');
      var cb = _onResult;
      _onResult = null;
      cb(trackingEl ? trackingEl.value : '');
    }
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
    var modeFormats = { barcode: 'CODE_128, PDF_417, CODE_39, DATA_MATRIX, ITF, EAN_13', qr: 'QR_CODE, DATA_MATRIX', any: 'CODE_128, QR_CODE, PDF_417, DATA_MATRIX, CODE_39, ITF, EAN_13' };
    if (fmts) fmts.textContent = modeFormats[_mode] || modeFormats.barcode;
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
