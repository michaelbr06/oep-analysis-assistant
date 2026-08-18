/* =====================================================================
   OEP VISUAL ANALYSIS ASSISTANT
   Vanilla-JS, modular PWA architecture, no CDN dependencies.
   ---------------------------------------------------------------------
   SIGNED PHORIA AXIS
   All phoria tests (#8, #13b, #13b+1.00, #15a, #15b) share ONE signed
   number line:
       Exophoria   = POSITIVE   (+6.0 = 6Δ Exo)
       Orthophoria = ZERO       (0.0)
       Esophoria   = NEGATIVE   (-2.0 = 2Δ Eso)
   The value typed into each phoria input IS the coordinate — no
   separate direction selector — and every downstream calculation
   (Gradient AC/A, Cross-Cylinder Shift, case chaining) operates on
   plain signed subtraction/addition of that coordinate.
   ---------------------------------------------------------------------
   CONTENTS
   1. Field configuration (data-driven form + norm generation)
   2. Rendering: build the three data-entry tables from FIELDS
   2b. Clinical reference tooltips for #4 / #5 / #6 (hover + tap popover)
   3. Live input handling + signed-phoria preview / interpretation labels
   4. Diagnostic calculations (Gradient AC/A, Cross-Cyl Shift, Hofstetter)
   5. Case-chaining / syndrome classification engine
   6. Preset patients (B1 / B2 / C) + reset
   7. PWA bootstrap (service worker + install prompt)
===================================================================== */

const fmt = (v, d = 2) => (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toFixed(d);

/* ---------------------------------------------------------------------
   1. FIELD CONFIGURATION
------------------------------------------------------------------- */

// Reserve threshold evaluator (unchanged from the base OEP minimums).
function reserveStatus(value, expected) {
  if (value === null || value === '' || isNaN(value)) return { status: 'idle', note: '—' };
  if (value < expected) return { status: 'low', note: `< ${expected}Δ expected` };
  if (value >= expected * 1.5) return { status: 'high', note: `≥ 1.5× expected` };
  return { status: 'wnl', note: `meets ${expected}Δ expected` };
}

// Signed phoria evaluator against the unified Exo(+)/Ortho(0)/Eso(−) axis.
// `highAbove` / `lowBelow` are the two literal thresholds from the
// OEP Table of Expecteds for that specific point.
function phoriaNormStatus(value, highAbove, lowBelow) {
  if (value === null || isNaN(value)) return { status: 'idle', note: '—' };
  if (value > highAbove) return { status: 'high', note: `> +${highAbove}Δ (High Exo)` };
  if (value < lowBelow) return { status: 'low', note: `< +${lowBelow}Δ (Low / Eso trend)` };
  return { status: 'wnl', note: 'within OEP range' };
}

function diopterTargetStatus(value, target, direction) {
  if (value === null || isNaN(value)) return { status: 'idle', note: '—' };
  if (direction === 'atLeastNegative') {
    return value <= target ? { status: 'wnl', note: `meets ${target}D` } : { status: 'low', note: `short of ${target}D` };
  }
  return value >= target ? { status: 'wnl', note: `meets +${target}D` } : { status: 'low', note: `short of +${target}D` };
}

const STATE = {};   // STATE[id] = numeric value (or null)
const FLAGS = {};   // FLAGS[id] = {status, note}

const FIELDS = [
  // ---- Refractive baseline -----------------------------------------
  {
    id: 'age', section: 'baseline', oep: '—', label: 'Age', sub: 'years', kind: 'num', unit: 'yrs', step: '1',
    evaluate: () => ({ status: 'idle', note: 'reference for #19' }), normText: () => 'Sets amplitude/AC-A norms'
  },

  {
    id: 'ret4', section: 'baseline', oep: '#4', label: 'Static Retinoscopy', sub: 'Objective, distance — net finding', kind: 'num', unit: 'D', step: '0.25',
    hasTooltip: true, hasInterp: true,
    evaluate: (v) => {
      const sub7 = STATE.sub7;
      if (v === null || isNaN(v) || sub7 === null || isNaN(sub7)) return { status: 'idle', note: 'needs #7' };
      const delta = v - sub7;
      if (delta > 0.50) return { status: 'high', note: `+${fmt(delta)}D over #7 (high)` };
      if (delta < 0.50) return { status: 'low', note: `+${fmt(delta)}D over #7 (low)` };
      return { status: 'wnl', note: 'meets +0.50D over #7' };
    }, normText: () => '#7 + 0.50D (net)',
    interpretation: (status) => ({
      high: 'Latent Hyperopia / Pseudomyopia / Plus Rejection',
      low: 'Uncompensated Far Strain / Low Plus Acceptance',
      wnl: 'Balanced Static Distance Baseline'
    }[status] || '')
  },

  {
    id: 'ret5', section: 'baseline', oep: '#5', label: 'Dynamic Retinoscopy', sub: '50 cm — High Neutral', kind: 'num', unit: 'D', step: '0.25',
    hasTooltip: true, hasInterp: true,
    evaluate: (v) => {
      const base = STATE.ret4;
      if (v === null || isNaN(v) || base === null || isNaN(base)) return { status: 'idle', note: 'needs #4' };
      const delta = v - base;
      if (delta < 0.75) return { status: 'low', note: `+${fmt(delta)}D over net #4 (low)` };
      if (delta > 1.00) return { status: 'high', note: `+${fmt(delta)}D over net #4 (high)` };
      return { status: 'wnl', note: `+${fmt(delta)}D over net #4` };
    }, normText: () => 'Net #4 + 0.75 to +1.00D',
    interpretation: (status) => ({
      high: 'Type B Accommodative Fatigue / Relieving Plus Indicated',
      low: 'Accommodative Hyper-Reactivity / Spasm',
      wnl: 'Normal High Neutral Response'
    }[status] || '')
  },

  {
    id: 'ret6', section: 'baseline', oep: '#6', label: 'MEM / Dynamic Retinoscopy', sub: '1 m — Low Neutral', kind: 'num', unit: 'D', step: '0.25',
    hasTooltip: true, hasInterp: true,
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v > 0.75) return { status: 'high', note: 'lag > +0.75D (high)' };
      if (v <= 0)   return { status: 'low', note: 'plano / lead / minus (low)' };
      return { status: 'wnl', note: 'within expected lag' };
    }, normText: () => '+0.25 to +0.50D lag',
    interpretation: (status) => ({
      high: 'High Accommodative Lag (Under-Accommodating)',
      low: 'Accommodative Lead / Ciliary Spasm (Over-Accommodating)',
      wnl: 'Physiological Lag (+0.25 to +0.50 D)'
    }[status] || '')
  },

  {
    id: 'sub7', section: 'baseline', oep: '#7/7a', label: 'Subjective Refraction', sub: 'MPMVA sphere', kind: 'num', unit: 'D', step: '0.25',
    evaluate: () => ({ status: 'idle', note: 'baseline value' }), normText: () => 'Clinical baseline'
  },

  // ---- Distance findings (6m) — #8 uses the signed phoria axis -----
  {
    id: 'd8', section: 'distance', oep: '#8', label: 'Induced Phoria', sub: 'Von Graefe, distance', kind: 'phoria', unit: 'Δ',
    evaluate: (v) => phoriaNormStatus(v, 0.5, 0.0), normText: () => 'Norm +0.5Δ (H > +0.5, L < 0.0)'
  },

  {
    id: 'd9', section: 'distance', oep: '#9', label: 'PRV Blur', sub: 'Base-out to blur', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 7), normText: () => '7–9Δ'
  },

  {
    id: 'd10break', section: 'distance', oep: '#10', label: 'PRV Break', sub: 'Base-out to break', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 19), normText: () => '19Δ'
  },

  {
    id: 'd10rec', section: 'distance', oep: '#10', label: 'PRV Recovery', sub: 'Base-out recovery', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 10), normText: () => '10Δ'
  },

  {
    id: 'd11break', section: 'distance', oep: '#11', label: 'NRV Break', sub: 'Base-in to break', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 9), normText: () => '9Δ'
  },

  {
    id: 'd11rec', section: 'distance', oep: '#11', label: 'NRV Recovery', sub: 'Base-in recovery', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 5), normText: () => '5Δ'
  },

  // ---- Nearpoint findings (40cm) — signed-axis phorias below --------
  {
    id: 'n13b', section: 'near', oep: '#13b', label: 'Induced Phoria', sub: 'Von Graefe, near', kind: 'phoria', unit: 'Δ',
    evaluate: (v) => phoriaNormStatus(v, 6.0, 5.0), normText: () => 'Norm +6.0Δ (H > +6.0, L < +5.0)'
  },

  {
    id: 'n13b1', section: 'near', oep: '#13b+1.00', label: 'Phoria through +1.00D', sub: 'Gradient AC/A input', kind: 'phoria', unit: 'Δ',
    evaluate: () => ({ status: 'idle', note: 'used for AC/A' }), normText: () => 'used for Gradient AC/A'
  },

  {
    id: 'n14a', section: 'near', oep: '#14a', label: 'Unfused Cross-Cyl. Net', sub: '±0.50 flip, unfused', kind: 'num', unit: 'D', step: '0.25',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v < 0.25) return { status: 'low', note: 'below expected lag' };
      if (v > 0.75) return { status: 'high', note: 'above expected lag' };
      return { status: 'wnl', note: 'within range' };
    }, normText: () => '+0.25 to +0.75D'
  },

  {
    id: 'n14b', section: 'near', oep: '#14b', label: 'Fused Cross-Cyl. Net', sub: '±0.50 flip, fused', kind: 'num', unit: 'D', step: '0.25',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v < 0.25) return { status: 'low', note: 'below expected lag' };
      if (v > 0.75) return { status: 'high', note: 'above expected lag' };
      return { status: 'wnl', note: 'within range' };
    }, normText: () => '+0.25 to +0.75D'
  },

  {
    id: 'n15a', section: 'near', oep: '#15a', label: 'Phoria thru #14a', sub: 'Phoria under cross-cyl.', kind: 'phoria', unit: 'Δ',
    evaluate: (v) => phoriaNormStatus(v, 6.0, 5.0), normText: () => 'Norm +6.0Δ (H > +6.0, L < +5.0)'
  },

  {
    id: 'n15b', section: 'near', oep: '#15b', label: 'Phoria thru #14b', sub: 'Phoria under cross-cyl.', kind: 'phoria', unit: 'Δ',
    evaluate: (v) => phoriaNormStatus(v, 6.0, 5.0), normText: () => 'Norm +6.0Δ (H > +6.0, L < +5.0)'
  },

  {
    id: 'n16a', section: 'near', oep: '#16a', label: 'PRV Blur', sub: 'Base-out to blur, near', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 15), normText: () => '15Δ'
  },

  {
    id: 'n16bbreak', section: 'near', oep: '#16b', label: 'PRV Break', sub: 'Base-out to break, near', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 21), normText: () => '21Δ'
  },

  {
    id: 'n16brec', section: 'near', oep: '#16b', label: 'PRV Recovery', sub: 'Base-out recovery, near', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 15), normText: () => '15Δ'
  },

  {
    id: 'n17a', section: 'near', oep: '#17a', label: 'NRV Blur', sub: 'Base-in to blur, near', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 14), normText: () => '14Δ'
  },

  {
    id: 'n17bbreak', section: 'near', oep: '#17b', label: 'NRV Break', sub: 'Base-in to break, near', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 22), normText: () => '22Δ'
  },

  {
    id: 'n17brec', section: 'near', oep: '#17b', label: 'NRV Recovery', sub: 'Base-in recovery, near', kind: 'num', unit: 'Δ', step: '1',
    evaluate: (v) => reserveStatus(v, 18), normText: () => '18Δ'
  },

  {
    id: 'n19', section: 'near', oep: '#19', label: 'Amplitude of Accommodation', sub: 'Push-up, near', kind: 'num', unit: 'D', step: '0.25',
    evaluate: (v) => {
      const age = STATE.age;
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (age === null || isNaN(age)) return { status: 'amber', note: 'enter age for norm' };
      const min = 15 - 0.25 * age, avg = 18.5 - 0.30 * age;
      if (v < min) return { status: 'low', note: `below minimum (${fmt(min, 1)}D)` };
      if (v < avg) return { status: 'amber', note: `below average (${fmt(avg, 1)}D)` };
      return { status: 'wnl', note: `≥ average (${fmt(avg, 1)}D)` };
    }, normText: () => "Hofstetter: 15−0.25·age (min) / 18.5−0.30·age (avg)"
  },

  {
    id: 'n20', section: 'near', oep: '#20', label: 'PRA', sub: 'Negative relative accommodation', kind: 'num', unit: 'D', step: '0.25',
    evaluate: (v) => diopterTargetStatus(v, -2.50, 'atLeastNegative'), normText: () => '−2.50D'
  },

  {
    id: 'n21', section: 'near', oep: '#21', label: 'NRA', sub: 'Positive relative accommodation', kind: 'num', unit: 'D', step: '0.25',
    evaluate: (v) => diopterTargetStatus(v, 2.00, 'atLeastPositive'), normText: () => '+2.00D'
  }
];

/* ---------------------------------------------------------------------
   2. RENDER FORM
------------------------------------------------------------------- */
function badgeHTML(status, note) {
  const labelMap = { wnl: 'WNL', high: 'HIGH (H)', low: 'LOW (L)', amber: 'BORDERLINE', idle: '—' };
  return `<span class="badge ${status}" title="${note || ''}">${labelMap[status] || status}</span>`;
}

// Translate a signed phoria coordinate into the clinical-format preview
// string, e.g. -3 -> "3Δ Eso", +6 -> "6Δ Exo", 0 -> "Ortho".
function formatPhoriaPreview(v) {
  if (v === null || v === '' || isNaN(v)) return { text: '—', cls: 'empty' };
  if (v === 0) return { text: 'Ortho', cls: 'ortho' };
  if (v > 0)   return { text: `${fmt(Math.abs(v), 1)}Δ Exo`, cls: 'exo' };
  return { text: `${fmt(Math.abs(v), 1)}Δ Eso`, cls: 'eso' };
}

function renderField(f) {
  const infoIconHTML = f.hasTooltip
    ? `<button type="button" class="info-icon" data-tooltip-for="${f.id}" aria-label="Clinical reference for ${f.label}" aria-expanded="false">ⓘ</button>`
    : '';

  const interpHTML = f.hasInterp
    ? `<div class="interp-tag idle" id="interp-${f.id}">—</div>`
    : '';

  const controlHTML = f.kind === 'phoria'
    ? `<div class="entry">
         <input type="number" step="0.5" class="signed-input" data-signed="${f.id}" placeholder="e.g., +6 or -2">
         <span class="unit">${f.unit}</span>
       </div>
       <div class="phoria-preview empty" id="preview-${f.id}">—</div>`
    : `<div class="entry">
         <input type="number" step="${f.step || '0.25'}" data-num="${f.id}" placeholder="—">
         <span class="unit">${f.unit}</span>
       </div>${interpHTML}`;

  return `<tr id="row-${f.id}">
    <td class="cell-oep"><span class="oep-no">${f.oep}</span></td>
    <td><span class="flabel" data-oep="${f.oep}">${f.label}${infoIconHTML}<small>${f.sub || ''}</small></span></td>
    <td>${controlHTML}</td>
    <td><span class="norm-text">${f.normText()}</span></td>
    <td><span id="badge-${f.id}">${badgeHTML('idle')}</span></td>
  </tr>`;
}

function renderAllFields() {
  const baseEl = document.getElementById('tbl-baseline');
  const distEl = document.getElementById('tbl-distance');
  const nearEl = document.getElementById('tbl-near');
  if (baseEl) baseEl.innerHTML = FIELDS.filter(f => f.section === 'baseline').map(renderField).join('');
  if (distEl) distEl.innerHTML = FIELDS.filter(f => f.section === 'distance').map(renderField).join('');
  if (nearEl) nearEl.innerHTML = FIELDS.filter(f => f.section === 'near').map(renderField).join('');
}
renderAllFields();

/* ---------------------------------------------------------------------
   2b. CLINICAL REFERENCE TOOLTIPS (#4 / #5 / #6)
   A single shared popover (see #tooltipPopover, a body-level element)
   is repositioned and re-filled for whichever info icon is active.
   Interaction model:
     - hover / keyboard focus  -> shows while the icon is hovered/focused
     - click / tap             -> "pins" the tooltip open (mobile-friendly);
                                   a second click, an outside click, or a
                                   scroll/resize closes it
------------------------------------------------------------------- */
const TOOLTIP_CONTENT = {
  ret4: `
    <p class="tt-head">#4 Static Retinoscopy</p>
    <dl>
      <dt>Baseline</dt><dd>Net finding (Gross &minus; working&#8209;distance lens)</dd>
      <dt>Expected</dt><dd>Net #4 is +0.50&nbsp;D over Subjective (#7)</dd>
      <dt>High</dt><dd class="tt-high">&gt; +0.50&nbsp;D over #7 &mdash; latent hyperopia, ciliary tonus rejection, pseudomyopia</dd>
      <dt>Low</dt><dd class="tt-low">&lt; +0.50&nbsp;D over #7 &mdash; accommodative spasm, uncompensated near strain</dd>
    </dl>`,
  ret5: `
    <p class="tt-head">#5 Dynamic Retinoscopy &mdash; 50 cm (High Neutral)</p>
    <dl>
      <dt>Target</dt><dd>Fixation grid at 50 cm</dd>
      <dt>Expected</dt><dd>Gross power +0.75 to +1.00&nbsp;D over Net #4</dd>
      <dt>High</dt><dd class="tt-high">&gt; +1.00&nbsp;D over Net #4 &mdash; hallmark of Type B accommodative fatigue, ready acceptance of near plus</dd>
      <dt>Low</dt><dd class="tt-low">&lt; +0.75&nbsp;D over Net #4 &mdash; accommodative excess, ciliary hyper-reactivity</dd>
    </dl>`,
  ret6: `
    <p class="tt-head">#6 Dynamic Retinoscopy &mdash; 1 m (MEM / Low Neutral)</p>
    <dl>
      <dt>Expected</dt><dd>+0.25 to +0.50&nbsp;D lag of accommodation</dd>
      <dt>High</dt><dd class="tt-high">&gt; +0.75&nbsp;D lag &mdash; high lag, accommodative insufficiency</dd>
      <dt>Low</dt><dd class="tt-low">Plano, lead, or minus &mdash; accommodative lead / spasm</dd>
    </dl>`
};

(function setupTooltips() {
  const popover = document.getElementById('tooltipPopover');
  if (!popover) return;
  let pinnedId = null;
  let activeIcon = null;

  function positionPopover(icon) {
    const r = icon.getBoundingClientRect();
    const margin = 10;
    const pw = popover.offsetWidth, ph = popover.offsetHeight;
    let left = r.left + r.width / 2 - pw / 2;
    let top  = r.bottom + 8;
    if (left < margin) left = margin;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - margin - pw;
    if (top + ph > window.innerHeight - margin) {
      top = r.top - ph - 8;
      if (top < margin) top = margin;
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function showTooltip(icon, id) {
    activeIcon = icon;
    popover.innerHTML = TOOLTIP_CONTENT[id] || '';
    popover.classList.add('visible');
    positionPopover(icon);
    icon.setAttribute('aria-expanded', 'true');
  }
  function hideTooltip() {
    popover.classList.remove('visible');
    if (activeIcon) activeIcon.setAttribute('aria-expanded', 'false');
    activeIcon = null;
  }

  document.addEventListener('mouseover', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) showTooltip(icon, icon.dataset.tooltipFor);
  });
  document.addEventListener('mouseout', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon && pinnedId !== icon.dataset.tooltipFor) hideTooltip();
  });
  document.addEventListener('focusin', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) showTooltip(icon, icon.dataset.tooltipFor);
  });
  document.addEventListener('focusout', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon && pinnedId !== icon.dataset.tooltipFor) hideTooltip();
  });
  document.addEventListener('click', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) {
      e.preventDefault();
      e.stopPropagation();
      const id = icon.dataset.tooltipFor;
      if (pinnedId === id) {
        pinnedId = null;
        hideTooltip();
      } else {
        pinnedId = id;
        showTooltip(icon, id);
      }
      return;
    }
    if (pinnedId && !e.target.closest('.tooltip-card')) {
      pinnedId = null;
      hideTooltip();
    }
  });
  window.addEventListener('scroll', () => { pinnedId = null; hideTooltip(); }, { passive: true });
  window.addEventListener('resize', () => { pinnedId = null; hideTooltip(); });
})();

/* ---------------------------------------------------------------------
   3. LIVE INPUT HANDLING
------------------------------------------------------------------- */
function collectAndEvaluate() {
  FIELDS.forEach(f => {
    let val;
    if (f.kind === 'phoria') {
      const el = document.querySelector(`[data-signed="${f.id}"]`);
      val = el && el.value !== '' ? parseFloat(el.value) : null;
      if (val !== null && isNaN(val)) val = null;
    } else {
      const el = document.querySelector(`[data-num="${f.id}"]`);
      val = el && el.value !== '' ? parseFloat(el.value) : null;
      if (val !== null && isNaN(val)) val = null;
    }
    STATE[f.id] = val;
  });

  // Second pass: evaluate
  FIELDS.forEach(f => {
    const result = f.evaluate(STATE[f.id]);
    FLAGS[f.id] = result;
    const badgeEl = document.getElementById(`badge-${f.id}`);
    if (badgeEl) badgeEl.innerHTML = badgeHTML(result.status, result.note);

    if (f.kind === 'phoria') {
      const previewEl = document.getElementById(`preview-${f.id}`);
      if (previewEl) {
        const p = formatPhoriaPreview(STATE[f.id]);
        previewEl.textContent = p.text;
        previewEl.className = `phoria-preview ${p.cls}`;
      }
    }

    // Real-time clinical interpretation caption for #4/#5/#6
    if (f.hasInterp) {
      const interpEl = document.getElementById(`interp-${f.id}`);
      if (interpEl) {
        const caption = f.interpretation ? f.interpretation(result.status) : '';
        interpEl.textContent = caption || '—';
        interpEl.className = `interp-tag ${result.status}`;
      }
    }
  });

  computeGradientACA();
  computeCrossCylShift();
  computeHofstetter();
  runCaseChaining();
}

['tbl-baseline', 'tbl-distance', 'tbl-near'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', collectAndEvaluate);
    el.addEventListener('change', collectAndEvaluate);
  }
});

/* ---------------------------------------------------------------------
   4. DIAGNOSTIC CALCULATIONS
------------------------------------------------------------------- */
let GRADIENT_ACA = null;

function computeGradientACA() {
  const p1 = STATE.n13b, p2 = STATE.n13b1;
  const valueEl = document.getElementById('acaValue');
  const labelEl = document.getElementById('acaLabel');
  if (!valueEl || !labelEl) return;

  if (p1 === null || p2 === null || isNaN(p1) || isNaN(p2)) {
    GRADIENT_ACA = null;
    valueEl.textContent = '—';
    labelEl.textContent = 'Enter #13b and #13b +1.00D phorias to calculate';
    drawGauge(null);
    return;
  }
  // Unified signed axis: Gradient AC/A = Phoria(#13b+1.00) − Phoria(#13b).
  const aca = p2 - p1;
  GRADIENT_ACA = aca;
  valueEl.textContent = `${fmt(aca, 1)} : 1`;
  let interp;
  if (aca < 3)      interp = 'Low AC/A ratio (expected 3:1–5:1)';
  else if (aca > 5) interp = 'High AC/A ratio (expected 3:1–5:1)';
  else              interp = 'Within OEP expected range (3:1–5:1)';
  labelEl.textContent = interp;
  drawGauge(aca);
}

function computeCrossCylShift() {
  const a = STATE.n15a, b = STATE.n15b;
  const valueEl = document.getElementById('shiftValue');
  const labelEl = document.getElementById('shiftLabel');
  const fillEl  = document.getElementById('shiftFill');
  if (!valueEl || !labelEl || !fillEl) return;

  if (a === null || b === null || isNaN(a) || isNaN(b)) {
    valueEl.textContent = '—';
    labelEl.textContent = 'Enter #15a and #15b to calculate the shift direction';
    fillEl.style.width = '0%';
    fillEl.style.left = '50%';
    return;
  }
  const shift = a - b;
  valueEl.textContent = `${shift > 0 ? '+' : ''}${fmt(shift, 1)}Δ`;
  labelEl.textContent = shift === 0
    ? 'No measurable shift between #15a and #15b'
    : shift > 0
      ? `Shift toward Exo (${fmt(Math.abs(shift), 1)}Δ)`
      : `Shift toward Eso (${fmt(Math.abs(shift), 1)}Δ)`;

  // Visual bar: fills from the centre (0) toward the shift direction.
  const maxRange = 6;
  const pct = Math.max(-1, Math.min(1, shift / maxRange)) * 50;
  if (pct >= 0) {
    fillEl.style.left = '50%';
    fillEl.style.width = `${pct}%`;
  } else {
    fillEl.style.left = `${50 + pct}%`;
    fillEl.style.width = `${-pct}%`;
  }
}

// Minimal inline SVG dial for the Gradient AC/A ratio.
function drawGauge(value) {
  const svg = document.getElementById('acaGauge');
  if (!svg) return;
  const cx = 110, cy = 110, r = 90;
  const minV = 0, maxV = 8;
  const angleFor = (v) => Math.PI - (Math.min(Math.max(v, minV), maxV) - minV) / (maxV - minV) * Math.PI;
  const point = (v, rad = r) => {
    const a = angleFor(v);
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const arcPath = (fromV, toV, rad) => {
    const [x1, y1] = point(fromV, rad), [x2, y2] = point(toV, rad);
    const large = (toV - fromV) > (maxV - minV) / 2 ? 1 : 0;
    return `M ${x1} ${y1} A ${rad} ${rad} 0 ${large} 1 ${x2} ${y2}`;
  };
  let needle = '';
  if (value !== null && !isNaN(value)) {
    const [nx, ny] = point(value, r - 14);
    needle = `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#16233F" stroke-width="3" stroke-linecap="round"/>
               <circle cx="${cx}" cy="${cy}" r="5" fill="#A8792B"/>`;
  }
  svg.innerHTML = `
    <path d="${arcPath(minV, maxV, r)}" fill="none" stroke="#EBEDE6" stroke-width="16"/>
    <path d="${arcPath(3, 5, r)}" fill="none" stroke="#CADFCE" stroke-width="16"/>
    <path d="${arcPath(minV, 3, r)}" fill="none" stroke="#E2ECF3" stroke-width="16"/>
    <path d="${arcPath(5, maxV, r)}" fill="none" stroke="#F5E3E1" stroke-width="16"/>
    ${needle}
    <text x="${cx}" y="128" text-anchor="middle" font-size="10" fill="#4B5670" font-family="ui-monospace,monospace">0</text>
    <text x="${cx - r}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#4B5670" font-family="ui-monospace,monospace">0</text>
    <text x="${cx + r}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#4B5670" font-family="ui-monospace,monospace">8</text>
  `;
}
drawGauge(null);

function computeHofstetter() {
  const age = STATE.age;
  const measured = STATE.n19;
  const ageEl = document.getElementById('hofAge');
  const minEl = document.getElementById('hofMin');
  const avgEl = document.getElementById('hofAvg');
  const measuredEl = document.getElementById('hofMeasured');
  const badgeEl = document.getElementById('hofBadge');
  if (!ageEl || !minEl || !avgEl || !measuredEl || !badgeEl) return;

  ageEl.textContent = age === null || isNaN(age) ? '—' : `${age} yrs`;
  if (age === null || isNaN(age)) {
    minEl.textContent = '—';
    avgEl.textContent = '—';
    measuredEl.textContent = measured === null ? '—' : `${fmt(measured)}D`;
    badgeEl.innerHTML = badgeHTML('idle');
    return;
  }
  const min = 15 - 0.25 * age, avg = 18.5 - 0.30 * age;
  minEl.textContent = `${fmt(min, 1)}D`;
  avgEl.textContent = `${fmt(avg, 1)}D`;
  measuredEl.textContent = measured === null || isNaN(measured) ? '—' : `${fmt(measured)}D`;
  badgeEl.innerHTML = FLAGS.n19 ? badgeHTML(FLAGS.n19.status, FLAGS.n19.note) : badgeHTML('idle');
}

/* ---------------------------------------------------------------------
   5. CASE CHAINING & SYNDROME CLASSIFICATION
------------------------------------------------------------------- */
function runCaseChaining() {
  const highChips = [], lowChips = [];
  FIELDS.forEach(f => {
    const flag = FLAGS[f.id];
    if (!flag) return;
    if (flag.status === 'high') highChips.push(`${f.oep} ${f.label}`);
    if (flag.status === 'low')  lowChips.push(`${f.oep} ${f.label}`);
  });

  const highEl = document.getElementById('chainHigh');
  const lowEl  = document.getElementById('chainLow');
  if (highEl) {
    highEl.innerHTML = highChips.length
      ? highChips.map(c => `<span class="chain-chip high">${c}</span>`).join('')
      : '<span class="chain-empty">No high findings encoded yet</span>';
  }
  if (lowEl) {
    lowEl.innerHTML = lowChips.length
      ? lowChips.map(c => `<span class="chain-chip low">${c}</span>`).join('')
      : '<span class="chain-empty">No low findings encoded yet</span>';
  }

  classifySyndrome();
}

const stat = (id) => FLAGS[id] ? FLAGS[id].status : 'idle';
const has = (id, ...ok) => ok.includes(stat(id));

function classifySyndrome() {
  const tagEl = document.getElementById('syndromeTag');
  const titleEl = document.getElementById('syndromeTitle');
  const descEl = document.getElementById('syndromeDesc');
  const mgmtEl = document.getElementById('mgmtList');
  const syndromeBox = document.getElementById('syndromeBox');
  if (!tagEl || !titleEl || !descEl || !mgmtEl || !syndromeBox) return;

  const results = [];

  // --- Type B1: Accommodative Fatigue, Uncompensated -------------
  if (stat('ret5') === 'high' && has('d9', 'low', 'idle') && stat('d11break') === 'high' && stat('n16bbreak') === 'low' && stat('n20') === 'low') {
    results.push({
      tag: 'TYPE B1',
      title: 'Accommodative Fatigue — Uncompensated',
      desc: 'High plus finding at #5 with an absent/low base-out reserve at distance (#9), an elevated base-in reserve at distance (#11) compensating for the fatigue, but reduced near base-out reserve (#16b) and reduced PRA (#20) show the compensation is not fully carried into the near system.',
      mgmt: [
        'Near plus relieving addition, reassessed against #16b/#20 response',
        'Accommodative vision therapy (facility &amp; sustained plus acceptance)',
        'Re-chain findings after 4–6 weeks of therapy to confirm shift out of Low #16b/#20'
      ]
    });
  }
  // --- Type B2: Accommodative Fatigue, Embedded/Compensated -------
  if (stat('ret5') === 'high' && has('d9', 'low', 'idle') && stat('d11break') === 'low' && stat('n16bbreak') === 'low' && stat('n20') === 'low') {
    results.push({
      tag: 'TYPE B2',
      title: 'Accommodative Fatigue — Embedded / Compensated',
      desc: 'Same accommodative fatigue signature as Type B1 (#5 high, #9 low/absent) but the distance base-in reserve (#11) has also dropped — the fatigue is now embedded in both accommodative and vergence systems rather than being locally compensated.',
      mgmt: [
        'Near plus relieving addition with staged reduction plan',
        'Full vision-therapy sequence: accommodative facility + fusional vergence ranges',
        'Monitor #11 and #16b jointly; embedded cases progress more slowly than B1'
      ]
    });
  }
  // --- Type C: Convergence Exhaustion / Adductive Problem ---------
  const imbalanced16b = (() => {
    if (STATE.n16bbreak === null || STATE.n16brec === null || isNaN(STATE.n16bbreak) || isNaN(STATE.n16brec)) return false;
    return (STATE.n16bbreak - STATE.n16brec) > 10;
  })();
  if (stat('d10break') === 'low' && stat('d11break') === 'low' && stat('n17bbreak') === 'low' && (stat('n16bbreak') === 'low' || imbalanced16b)) {
    results.push({
      tag: 'TYPE C',
      title: 'Convergence Exhaustion / Adductive Problem',
      desc: 'Both distance reserves (#10, #11) and the near base-in reserve (#17b) are reduced, with the near base-out reserve (#16b) either low or badly imbalanced between break and recovery — a global adductive fatigue pattern rather than an isolated distance or near finding.',
      mgmt: [
        'Fusional vergence vision therapy prioritizing base-in ranges',
        'Consider base-in relieving prism if therapy response is slow',
        'Screen for binocular fatigue symptoms (asthenopia, diplopia) under sustained near tasks'
      ]
    });
  }
  // --- Convergence Insufficiency vs Convergence Excess (AC/A-based)
  if (GRADIENT_ACA !== null) {
    const nearPhoria = STATE.n13b;
    if (GRADIENT_ACA < 3 && nearPhoria !== null && nearPhoria > 8) {
      results.push({
        tag: 'CI',
        title: 'Convergence Insufficiency',
        desc: `Low Gradient AC/A (${fmt(GRADIENT_ACA, 1)}:1) combined with exophoria at near beyond the OEP average (#13b = +${fmt(nearPhoria, 1)}Δ) is the classic convergence-insufficiency signature: the accommodative system is not driving enough convergence to hold the near phoria in range.`,
        mgmt: [
          'Base-in fusional vergence therapy (push-up / prism bar protocols)',
          'Near plus is usually NOT indicated — it would further reduce accommodative convergence drive',
          'Home vision therapy with pencil push-ups or Brock string as adjunct'
        ]
      });
    }
    if (GRADIENT_ACA > 5 && nearPhoria !== null && nearPhoria <= 4) {
      results.push({
        tag: 'CE',
        title: 'Convergence Excess',
        desc: `High Gradient AC/A (${fmt(GRADIENT_ACA, 1)}:1) with near phoria at or near orthophoria/esophoria (#13b = ${nearPhoria > 0 ? '+' : ''}${fmt(nearPhoria, 1)}Δ) indicates over-convergence relative to accommodation — a convergence-excess pattern.`,
        mgmt: [
          'Near plus relieving addition to reduce accommodative convergence load',
          'Base-out ranges therapy only if reserves remain asymmetric after the add',
          'Re-check #13b and Gradient AC/A after the relieving prescription is dispensed'
        ]
      });
    }
  }

  if (results.length === 0) {
    tagEl.textContent = 'AWAITING DATA';
    titleEl.textContent = 'Insufficient findings for classification';
    descEl.textContent = 'Encode distance and near vergence reserves, accommodative findings, and the gradient AC/A to activate the syndrome-matching rules for Types B1, B2, C, and Convergence Insufficiency / Excess.';
    mgmtEl.innerHTML = '';
    const extras = document.querySelectorAll('#syndromeBox .extra-syndrome-result');
    extras.forEach(e => e.remove());
    return;
  }

  const extras = document.querySelectorAll('#syndromeBox .extra-syndrome-result');
  extras.forEach(e => e.remove());

  const primary = results[0];
  tagEl.textContent = primary.tag;
  titleEl.textContent = primary.title;
  descEl.innerHTML = primary.desc;
  mgmtEl.innerHTML = primary.mgmt.map(m => `<li>${m}</li>`).join('');

  if (results.length > 1) {
    const extraHTML = results.slice(1).map(r => `
      <div class="syndrome-result extra-syndrome-result" style="margin-top:10px;background:#fff;">
        <span class="type-tag" style="background:var(--brass);color:#231A0B;">${r.tag}</span>
        <h3 style="font-size:14.5px;">${r.title}</h3>
        <p>${r.desc}</p>
        <ul class="mgmt-list">${r.mgmt.map(m => `<li>${m}</li>`).join('')}</ul>
      </div>`).join('');
    syndromeBox.insertAdjacentHTML('beforeend', extraHTML);
  }
}

/* ---------------------------------------------------------------------
   6. PRESET PATIENTS (B1 / B2 / C) + RESET
   All phoria values are plain signed numbers on the Exo(+)/Eso(−) axis.
------------------------------------------------------------------- */
const PRESET_B1 = {
  age: 24, ret4: -0.25, ret5: 1.25, ret6: 0.85, sub7: -0.75,
  d8: 1.0, d9: 5, d10break: 14, d10rec: 7, d11break: 16, d11rec: 8,
  n13b: 6.0, n13b1: 9.0, n14a: 0.50, n14b: 0.50, n15a: 6.0, n15b: 6.0,
  n16a: 12, n16bbreak: 15, n16brec: 9, n17a: 12, n17bbreak: 18, n17brec: 14,
  n19: 8.0, n20: -1.50, n21: 1.75
};

const PRESET_B2 = {
  age: 24, ret4: -0.25, ret5: 1.25, ret6: 0.85, sub7: -0.75,
  d8: 1.0, d9: 5, d10break: 14, d10rec: 7, d11break: 6, d11rec: 3,
  n13b: 6.0, n13b1: 9.0, n14a: 0.50, n14b: 0.50, n15a: 6.0, n15b: 6.0,
  n16a: 12, n16bbreak: 15, n16brec: 9, n17a: 12, n17bbreak: 18, n17brec: 14,
  n19: 8.0, n20: -1.50, n21: 1.75
};

const PRESET_C = {
  age: 24, ret4: 0.00, ret5: 0.85, ret6: 0.35, sub7: -0.50,
  d8: 0.25, d9: 8, d10break: 14, d10rec: 8, d11break: 6, d11rec: 3,
  n13b: 6.0, n13b1: 9.5, n14a: 0.50, n14b: 0.50, n15a: 6.0, n15b: 6.0,
  n16a: 14, n16bbreak: 15, n16brec: 9, n17a: 10, n17bbreak: 16, n17brec: 10,
  n19: 8.0, n20: -2.75, n21: 2.25
};

function applyPatient(data) {
  FIELDS.forEach(f => {
    if (f.kind === 'phoria') {
      const el = document.querySelector(`[data-signed="${f.id}"]`);
      if (el) el.value = (data[f.id] !== undefined) ? data[f.id] : '';
    } else {
      const el = document.querySelector(`[data-num="${f.id}"]`);
      if (el) el.value = (data[f.id] !== undefined) ? data[f.id] : '';
    }
  });
  collectAndEvaluate();
}

function clearPatient() {
  FIELDS.forEach(f => {
    if (f.kind === 'phoria') {
      const el = document.querySelector(`[data-signed="${f.id}"]`);
      if (el) el.value = '';
    } else {
      const el = document.querySelector(`[data-num="${f.id}"]`);
      if (el) el.value = '';
    }
  });
  collectAndEvaluate();
}

const btnB1 = document.getElementById('btnB1');
const btnB2 = document.getElementById('btnB2');
const btnC = document.getElementById('btnC');
const resetBtn = document.getElementById('resetBtn');

if (btnB1) btnB1.addEventListener('click', () => applyPatient(PRESET_B1));
if (btnB2) btnB2.addEventListener('click', () => applyPatient(PRESET_B2));
if (btnC) btnC.addEventListener('click', () => applyPatient(PRESET_C));
if (resetBtn) resetBtn.addEventListener('click', clearPatient);

// Initial pass so all badges/previews render as idle/consistent
collectAndEvaluate();

/* ---------------------------------------------------------------------
   7. PWA BOOTSTRAP — Service Worker Registration & Install Prompt
------------------------------------------------------------------- */
(function setupPWA() {
  const statusEl = document.getElementById('pwaStatus');
  const installBtn = document.getElementById('installBtn');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => {
        if (statusEl) statusEl.innerHTML = '<span class="pwa-dot"></span> Offline&#8209;ready';
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
        if (statusEl) statusEl.innerHTML = '<span class="pwa-dot" style="background:#C68A2E"></span> Offline mode unavailable';
      });
  } else {
    if (statusEl) statusEl.innerHTML = '<span class="pwa-dot" style="background:#C68A2E"></span> Service workers unsupported';
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.hidden = true;
    });
  }

  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.hidden = true;
  });
})();
