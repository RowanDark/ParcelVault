/* ParcelVault – frontend JS */

// ── Real-time duplicate tracking number check ────────────────
(function () {
  const field = document.getElementById('tracking_number');
  if (!field) return;

  const warning = document.getElementById('dup-warning');
  let debounce;

  field.addEventListener('input', function () {
    clearTimeout(debounce);
    const val = this.value.trim();
    if (!val) { if (warning) warning.style.display = 'none'; return; }

    debounce = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/check-duplicate?tn=${encodeURIComponent(val)}`);
        const data = await res.json();
        if (warning) {
          warning.style.display = data.duplicate ? 'block' : 'none';
        }
      } catch (_) {}
    }, 350);
  });
})();


// ── Signature pad ─────────────────────────────────────────────
(function () {
  const canvas = document.getElementById('signature-canvas');
  if (!canvas) return;

  const ctx         = canvas.getContext('2d');
  const hiddenInput = document.getElementById('signature_data');
  const clearBtn    = document.getElementById('sig-clear');
  let drawing = false;
  let lastX = 0, lastY = 0;

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * (canvas.width / r.width),
             y: (src.clientY - r.top)  * (canvas.height / r.height) };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    const p = pos(e);
    lastX = p.x; lastY = p.y;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
  }

  function draw(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  }

  function stop() {
    drawing = false;
    if (hiddenInput) hiddenInput.value = canvas.toDataURL('image/png');
  }

  canvas.addEventListener('mousedown',  start);
  canvas.addEventListener('mousemove',  draw);
  canvas.addEventListener('mouseup',    stop);
  canvas.addEventListener('mouseleave', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove',  draw,  { passive: false });
  canvas.addEventListener('touchend',   stop);

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (hiddenInput) hiddenInput.value = '';
    });
  }

  // Fix canvas resolution for retina / device pixel ratio
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = (rect.width  || 500) * dpr;
  canvas.height = (rect.height || 180) * dpr;
  ctx.scale(dpr, dpr);
})();


// ── Camera scan ────────────────────────────────────────────
(function () {
  const triggerBtn = document.getElementById('scan-trigger-btn');
  if (!triggerBtn) return;

  const fileInput   = document.getElementById('scan-file-input');
  const statusEl    = document.getElementById('scan-status');
  const previewWrap = document.getElementById('scan-preview-wrap');
  const previewImg  = document.getElementById('scan-preview');

  triggerBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;

    previewImg.src = URL.createObjectURL(file);
    previewWrap.style.display = 'block';

    const b64 = await compressToJpeg(file, 1200, 0.85);

    triggerBtn.disabled = true;
    setStatus('Scanning label…', 'text-muted');

    try {
      const res  = await fetch('/api/scan-package', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image: b64 }),
      });
      const data = await res.json();

      if (data.error) {
        setStatus('Scan failed: ' + data.error, 'text-danger');
        return;
      }

      let filled = 0;
      if (data.tracking_number) { fillField('tracking_number', data.tracking_number); filled++; }
      if (data.carrier)         { fillSelect('shipper', data.carrier); filled++; }
      if (data.recipient)       { fillField('recipient', data.recipient); filled++; }

      const tnField = document.getElementById('tracking_number');
      if (tnField) tnField.dispatchEvent(new Event('input'));

      setStatus(
        filled ? 'Label scanned — review the fields below.' : 'No data detected — enter details manually.',
        filled ? 'text-success' : 'text-warning'
      );
    } catch (_) {
      setStatus('Network error. Please try again.', 'text-danger');
    } finally {
      triggerBtn.disabled = false;
      fileInput.value = '';
    }
  });

  function setStatus(msg, cls) {
    statusEl.textContent   = msg;
    statusEl.className     = 'small ' + cls;
    statusEl.style.display = 'inline';
  }

  function fillField(id, value) {
    const el = document.getElementById(id);
    if (!el || !value) return;
    el.value = value;
    el.classList.add('scan-filled');
    setTimeout(() => el.classList.remove('scan-filled'), 3000);
  }

  function fillSelect(id, value) {
    const el = document.getElementById(id);
    if (!el || !value) return;
    const v = value.toLowerCase();
    for (const opt of el.options) {
      if (opt.value.toLowerCase() === v || v.includes(opt.value.toLowerCase())) {
        el.value = opt.value;
        el.classList.add('scan-filled');
        setTimeout(() => el.classList.remove('scan-filled'), 3000);
        return;
      }
    }
  }

  function compressToJpeg(file, maxDim, quality) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else       { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = URL.createObjectURL(file);
    });
  }
})();


// ── Auto-dismiss success alerts after 4 s ────────────────────
document.querySelectorAll('.pv-alert-success').forEach(function (el) {
  setTimeout(function () {
    const bsAlert = bootstrap.Alert.getOrCreateInstance(el);
    if (bsAlert) bsAlert.close();
  }, 4000);
});
