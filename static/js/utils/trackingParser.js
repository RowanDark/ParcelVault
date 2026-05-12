/* trackingParser.js – extract tracking numbers and recipients from OCR text
 * UMD-compatible: works in browser globals and Node.js (for tests).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TrackingParser = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Ordered by specificity: most-specific / least-ambiguous patterns first.
  const CARRIER_PATTERNS = [
    {
      carrier: 'UPS',
      // 1Z + exactly 16 alphanumeric chars
      regex: /\b(1Z[0-9A-Z]{16})\b/gi,
    },
    {
      carrier: 'Amazon',
      // TBA + 9-12 digits + optional US suffix
      regex: /\b(TBA\d{9,12}(?:US)?)\b/gi,
    },
    {
      carrier: 'USPS',
      // Intelligent Mail: 22-digit numbers starting with 94/92/93/95/70/23/82
      regex: /\b(9[234570]\d{20}|70\d{18}|23\d{18}|82\d{18})\b/g,
    },
    {
      carrier: 'FedEx',
      // FedEx Ground 34-digit solid barcode — tracking number is last 12 digits.
      // Must come before the general FedEx pattern to prevent the \d{22} branch
      // from partially consuming the 34-digit string.
      regex: /(?<!\d)(\d{34})(?!\d)/g,
      transform: function(m) { return m.slice(-12); },
    },
    {
      carrier: 'FedEx',
      // 12, 15, 20, or 22 pure-digit strings (ground/express/smartpost).
      // Use (?<!\d)/(?!\d) instead of \b: raw Code 128 barcode strings
      // contain spaces/parens adjacent to digits where \b fails to anchor.
      regex: /(?<!\d)(\d{22}|\d{20}|\d{15}|\d{12})(?!\d)/g,
    },
    {
      carrier: 'DHL',
      // International: 2 alpha + 8-15 digits + 2 alpha (e.g. JD014600006962DE)
      // Domestic: 10-11 digit numbers
      regex: /\b([A-Z]{2}\d{8,15}[A-Z]{2}|\d{10,11})\b/g,
    },
  ];

  // ── Text normalisation ───────────────────────────────────────
  function normalizeText(raw) {
    return raw
      .replace(/\|/g, 'I')          // pipe → I (common OCR substitution)
      .replace(/[ \t]+/g, ' ')      // collapse horizontal whitespace
      .replace(/\r\n/g, '\n')       // normalise line endings
      .trim();
  }

  // ── Compact spaced digit runs (e.g. USPS "9400 1118 9922 3456 7890 00") ──
  function compactDigits(text) {
    // Compact spaces between digits only within contiguous digit-and-space segments.
    // Splitting on non-digit non-space boundaries prevents routing-prefix digits from
    // bleeding across parentheses or letters into the tracking number across iterations.
    return text.replace(/[\d ]+/g, function(segment) {
      let s = segment;
      for (let i = 0; i < 4; i++) {
        s = s.replace(/(\d) (\d)/g, '$1$2');
      }
      return s;
    });
  }

  // ── FedEx barcode string pre-processors ──────────────────────

  // FedEx Code 128 barcodes decode with routing prefix and parenthesized groups,
  // e.g. "96220019 0 (000 000 0000) 0 00 2724 83686596" (Ground)
  //   or "0201 7946 4542 8546"                           (Express).
  // Collect all digit groups from the string and work backwards from the end,
  // concatenating groups until we hit a valid FedEx tracking-number length
  // (12, 15, 20, or 22 digits). This correctly isolates the tracking number
  // regardless of how many routing/filler digits precede it.
  function stripFedExPrefix(text) {
    var groups = text.replace(/[^\d\s]/g, ' ').match(/\d+/g);
    if (!groups) return text;
    var acc = '';
    for (var i = groups.length - 1; i >= 0; i--) {
      acc = groups[i] + acc;
      if (acc.length === 12 || acc.length === 15 ||
          acc.length === 20 || acc.length === 22) {
        return acc;
      }
      if (acc.length > 22) break;
    }
    return text;
  }

  // ── Extract all tracking-number candidates ───────────────────
  function extractTracking(text) {
    const normalized = normalizeText(text);
    const compacted  = compactDigits(normalized);
    // Apply FedEx prefix stripping to the un-compacted normalized text so that
    // space-separated digit groups (e.g. "2724 83686596") are still distinct
    // and can be combined correctly by stripFedExPrefix.
    const fedexStripped = stripFedExPrefix(normalized);

    const candidates = [];
    const seen = new Set();

    for (const { carrier, regex, transform } of CARRIER_PATTERNS) {
      // FedEx: use fedexStripped (rightmost-N-digit extraction) instead of
      // compacted to avoid merging routing-prefix zeros into the tracking number
      // (e.g. compacting "0 00 2724 83686596" would yield "000272483686596").
      const sources = carrier === 'FedEx'
        ? [normalized, fedexStripped]
        : [normalized, compacted];
      for (const src of sources) {
        const re = new RegExp(regex.source, regex.flags);
        let match;
        while ((match = re.exec(src)) !== null) {
          const raw_val = match[1];
          const value = (transform ? transform(raw_val) : raw_val)
            .toUpperCase().replace(/\s/g, '');
          if (!seen.has(value)) {
            seen.add(value);
            candidates.push({ tracking: value, carrier });
          }
        }
      }
    }

    // Longer = more specific; then remove any candidate that is a strict
    // substring of a longer candidate (avoids FedEx partial overlaps with USPS).
    candidates.sort((a, b) => b.tracking.length - a.tracking.length);
    return candidates.filter((cand, i) =>
      !candidates.some((other, j) =>
        i !== j &&
        other.tracking.includes(cand.tracking) &&
        other.tracking.length > cand.tracking.length
      )
    );
  }

  // ── Identify carrier from a single tracking number ───────────
  function detectCarrier(trackingNumber) {
    const t = trackingNumber.toUpperCase().replace(/\s/g, '');
    if (/^1Z[0-9A-Z]{16}$/.test(t))                      return 'UPS';
    if (/^TBA\d{9,12}(US)?$/i.test(t))                   return 'Amazon';
    if (/^9[234570]\d{20}$/.test(t))                      return 'USPS';
    if (/^(70|23|82)\d{18}$/.test(t))                     return 'USPS';
    if (/^[A-Z]{2}\d{8,15}[A-Z]{2}$/.test(t))             return 'DHL';
    if (/^(\d{22}|\d{20}|\d{15}|\d{12})$/.test(t))       return 'FedEx';
    if (/^\d{10,11}$/.test(t))                            return 'DHL';
    return null;
  }

  // ── Extract recipient name from OCR text ─────────────────────
  function extractRecipient(text) {
    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    // Strategy 1: "Ship To: John Smith" or "Recipient: Jane Doe" on one line.
    const inlineLabelRe = /^(?:ship\s*to|recipient|deliver\s*to|to|attn|attention)\s*[:\-]\s*(.+)$/i;
    for (const line of lines) {
      const m = line.match(inlineLabelRe);
      if (m && isLikelyName(m[1].trim())) return m[1].trim();
    }

    // Strategy 2: Label alone on a line; name follows on the next non-empty line.
    const standaloneRe = /^(?:ship\s*to|recipient|deliver\s*to|to|attn|attention)\s*[:\-]?$/i;
    for (let i = 0; i < lines.length; i++) {
      if (!standaloneRe.test(lines[i])) continue;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (isLikelyName(lines[j])) return lines[j];
      }
    }

    // Strategy 3: Locate city/state/zip line and work backwards to find the name.
    // The name is typically 2-4 lines above the zip line.
    const zipLineRe = /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/;
    const streetRe  = /\b\d+\s+[A-Z].*\b(ST|AVE|BLVD|DR|RD|LN|WAY|CT|PL|CIR|HWY|STE|SUITE|APT|UNIT|FL|FLOOR)\b/i;

    for (let i = 0; i < lines.length; i++) {
      if (!zipLineRe.test(lines[i])) continue;

      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (streetRe.test(lines[j])) continue;
        if (isLikelyName(lines[j])) return lines[j];
      }
    }

    // Strategy 4: First name-like line in the upper portion of the label,
    // before any tracking number appears.
    const trackingRe = /\b(1Z[0-9A-Z]{16}|9[234570]\d{20}|\d{12}|\d{20})\b/;
    const upperLines = [];
    for (const line of lines) {
      if (trackingRe.test(line)) break;
      upperLines.push(line);
    }
    for (let i = upperLines.length - 1; i >= 0; i--) {
      if (isLikelyName(upperLines[i])) return upperLines[i];
    }

    return null;
  }

  // ── Heuristic: does a string look like a person / department name? ──
  function isLikelyName(s) {
    if (!s || s.length < 3 || s.length > 60) return false;
    // Reject strings that start with a digit (addresses, zip codes, tracking numbers).
    if (/^\d/.test(s)) return false;
    // Reject strings that are mostly digits.
    if ((s.match(/\d/g) || []).length / s.length > 0.35) return false;
    // Reject pure zip codes.
    if (/^\d{5}(-\d{4})?$/.test(s)) return false;
    // Reject known carrier / logistics keywords.
    if (/^(tracking|barcode|usps|ups|fedex|amazon|dhl|postal|parcel|package|priority|express|ground|weight|lb\b|oz\b|kg\b|ship\s+date|order\s*#?|ref\s*#?)/i.test(s)) return false;
    // Must contain at least two consecutive letters (names have words).
    return /[A-Za-z]{2,}/.test(s);
  }

  return {
    extractTracking,
    detectCarrier,
    extractRecipient,
    normalizeText,
    // exposed for unit tests only
    _isLikelyName: isLikelyName,
  };
});
