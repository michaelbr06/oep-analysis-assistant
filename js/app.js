/* =====================================================================
   VISUAL ANALYSIS ASSISTANT
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
    id: 'ret4', section: 'baseline', oep: '#4', label: 'Static Retinoscopy', sub: 'Objective, distance — net finding', kind: 'num', unit: 'D', step: '0.25', placeholder: '-1.00',
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
    id: 'sub7', section: 'baseline', oep: '#7/7a', label: 'Subjective Refraction', sub: 'MPMVA sphere', kind: 'num', unit: 'D', step: '0.25', placeholder: '-1.00',
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

  // ---- Vertical tests (Distance / 6m) — Point #12 (VT #12) --------
  {
    id: 'vt12a', section: 'vt12', oep: '#12a', label: 'Vertical Phoria', sub: 'Von Graefe / Maddox, distance (6 m)', kind: 'phoria', phoriaType: 'vertical', unit: 'Δ', step: '0.5', placeholder: '+1.5',
    hasTooltip: true, hasInterp: true,
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v === 0) return { status: 'wnl', note: 'meets Ortho (0Δ)' };
      if (v > 0) return { status: 'high', note: `+${fmt(v, 1)}Δ Right Hyper (RHP)` };
      return { status: 'low', note: `${fmt(Math.abs(v), 1)}Δ Left Hyper (LHP)` };
    },
    normText: () => 'Ortho (0.0Δ)',
    interpretation: (status) => ({
      high: 'Right Hyperphoria (OD visual axis elevated)',
      low: 'Left Hyperphoria (OS visual axis elevated)',
      wnl: 'Normal Vertical Orthophoria'
    }[status] || '')
  },

  {
    id: 'vt12b_supra_break', section: 'vt12', oep: '#12b', label: 'Right Supraduction Break', sub: 'BD OD / BU OS to break', kind: 'num', unit: 'Δ', step: '0.5', placeholder: '3.5',
    hasTooltip: true, tooltipId: 'vt12b_supra',
    evaluate: (v) => reserveStatus(v, 3), normText: () => '3.0–4.0Δ'
  },

  {
    id: 'vt12b_supra_rec', section: 'vt12', oep: '#12b', label: 'Right Supraduction Recovery', sub: 'BD OD / BU OS recovery', kind: 'num', unit: 'Δ', step: '0.5', placeholder: '2.0',
    hasTooltip: true, tooltipId: 'vt12b_supra',
    evaluate: (v) => reserveStatus(v, 1.5), normText: () => '1.5–2.0Δ'
  },

  {
    id: 'vt12b_infra_break', section: 'vt12', oep: '#12b', label: 'Right Infraduction Break', sub: 'BU OD / BD OS to break', kind: 'num', unit: 'Δ', step: '0.5', placeholder: '3.5',
    hasTooltip: true, tooltipId: 'vt12b_infra',
    evaluate: (v) => reserveStatus(v, 3), normText: () => '3.0–4.0Δ'
  },

  {
    id: 'vt12b_infra_rec', section: 'vt12', oep: '#12b', label: 'Right Infraduction Recovery', sub: 'BU OD / BD OS recovery', kind: 'num', unit: 'Δ', step: '0.5', placeholder: '2.0',
    hasTooltip: true, tooltipId: 'vt12b_infra',
    evaluate: (v) => reserveStatus(v, 1.5), normText: () => '1.5–2.0Δ'
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
// string:
// Horizontal: -3 -> "3Δ Eso", +6 -> "6Δ Exo", 0 -> "Ortho"
// Vertical (VT #12): +1.5 -> "1.5Δ R. Hyper", -1.0 -> "1.0Δ L. Hyper", 0 -> "Ortho"
function formatPhoriaPreview(v, phoriaType = 'horizontal') {
  if (v === null || v === '' || isNaN(v)) return { text: '—', cls: 'empty' };
  if (v === 0) return { text: 'Ortho', cls: 'ortho' };
  if (phoriaType === 'vertical') {
    if (v > 0) return { text: `${fmt(Math.abs(v), 1)}Δ R. Hyper`, cls: 'r-hyper' };
    return { text: `${fmt(Math.abs(v), 1)}Δ L. Hyper`, cls: 'l-hyper' };
  }
  if (v > 0)   return { text: `${fmt(Math.abs(v), 1)}Δ Exo`, cls: 'exo' };
  return { text: `${fmt(Math.abs(v), 1)}Δ Eso`, cls: 'eso' };
}

function renderField(f) {
  const tooltipTargetId = f.tooltipId || f.id;
  const infoIconHTML = f.hasTooltip
    ? `<button type="button" class="info-icon" data-tooltip-for="${tooltipTargetId}" aria-label="Clinical reference for ${f.label}" aria-expanded="false">ⓘ</button>`
    : '';

  const interpHTML = f.hasInterp
    ? `<div class="interp-tag idle" id="interp-${f.id}">—</div>`
    : '';

  const placeholder = f.placeholder || (f.kind === 'phoria' ? '+6' : '—');

  const controlHTML = f.kind === 'phoria'
    ? `<div class="entry">
         <input type="number" step="${f.step || '0.5'}" class="signed-input" data-signed="${f.id}" placeholder="${placeholder}">
         <span class="unit">${f.unit}</span>
       </div>
       <div class="phoria-preview empty" id="preview-${f.id}">—</div>`
    : `<div class="entry">
         <input type="number" step="${f.step || '0.25'}" data-num="${f.id}" placeholder="${placeholder}">
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
  const vt12El = document.getElementById('tbl-vt12');
  const nearEl = document.getElementById('tbl-near');
  if (baseEl) baseEl.innerHTML = FIELDS.filter(f => f.section === 'baseline').map(renderField).join('');
  if (distEl) distEl.innerHTML = FIELDS.filter(f => f.section === 'distance').map(renderField).join('');
  if (vt12El) vt12El.innerHTML = FIELDS.filter(f => f.section === 'vt12').map(renderField).join('');
  if (nearEl) nearEl.innerHTML = FIELDS.filter(f => f.section === 'near').map(renderField).join('');
}
renderAllFields();

/* ---------------------------------------------------------------------
   2b. CLINICAL REFERENCE TOOLTIPS (#4 / #5 / #6 / VT #12)
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
    </dl>`,
  vt12a: `
    <p class="tt-head">#12a Distance Vertical Phoria (VT #12)</p>
    <dl>
      <dt>Target</dt><dd>Distance fixation (6 m / 20 ft), Von Graefe / Maddox rod</dd>
      <dt>Axis</dt><dd>Positive (+) = Right Hyper (RHP), 0 = Ortho, Negative (&minus;) = Left Hyper (LHP)</dd>
      <dt>Expected</dt><dd>Orthophoria (0.0&nbsp;&Delta;)</dd>
      <dt>Significance</dt><dd>Non-accommodative vertical deviation. Even &le; 1&Delta; causes asthenopia and disrupts horizontal fusional adaptation.</dd>
    </dl>`,
  vt12b_supra: `
    <p class="tt-head">#12b Right Supraduction (VT #12 Duction)</p>
    <dl>
      <dt>Prism</dt><dd>Base-Down OD / Base-Up OS to break &amp; recovery</dd>
      <dt>Expected</dt><dd>Break 3.0–4.0&nbsp;&Delta; / Recovery 1.5–2.0&nbsp;&Delta;</dd>
      <dt>Clinical Role</dt><dd>Compensating reserve for Left Hyperphoria (LHP). Low recovery signals vertical decompensation.</dd>
    </dl>`,
  vt12b_infra: `
    <p class="tt-head">#12b Right Infraduction (VT #12 Duction)</p>
    <dl>
      <dt>Prism</dt><dd>Base-Up OD / Base-Down OS to break &amp; recovery</dd>
      <dt>Expected</dt><dd>Break 3.0–4.0&nbsp;&Delta; / Recovery 1.5–2.0&nbsp;&Delta;</dd>
      <dt>Clinical Role</dt><dd>Compensating reserve for Right Hyperphoria (RHP). Low recovery signals vertical decompensation.</dd>
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
        const p = formatPhoriaPreview(STATE[f.id], f.phoriaType || 'horizontal');
        previewEl.textContent = p.text;
        previewEl.className = `phoria-preview ${p.cls}`;
      }
    }

    // Real-time clinical interpretation caption for #4/#5/#6/#12a
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
  computeVerticalAnalysis();
  runCaseChaining();
}

['tbl-baseline', 'tbl-distance', 'tbl-vt12', 'tbl-near'].forEach(id => {
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

function computeVerticalAnalysis() {
  const phoria = STATE.vt12a;
  const sBreak = STATE.vt12b_supra_break;
  const sRec   = STATE.vt12b_supra_rec;
  const iBreak = STATE.vt12b_infra_break;
  const iRec   = STATE.vt12b_infra_rec;

  const phoriaEl = document.getElementById('vtPhoriaVal');
  const compEl   = document.getElementById('vtCompReserveVal');
  const sheardEl = document.getElementById('vtSheardDemandVal');
  const prismEl  = document.getElementById('vtPrismVal');
  const badgeEl  = document.getElementById('vtStatusBadge');
  if (!phoriaEl || !compEl || !sheardEl || !prismEl || !badgeEl) return;

  if (phoria === null || isNaN(phoria)) {
    phoriaEl.textContent = '—';
    compEl.textContent = '—';
    sheardEl.textContent = '—';
    prismEl.textContent = '—';
    badgeEl.innerHTML = badgeHTML('idle');
    return;
  }

  if (phoria === 0) {
    phoriaEl.textContent = '0.0Δ (Ortho)';
    compEl.textContent = (sRec !== null || iRec !== null)
      ? `Supra: ${sRec !== null ? fmt(sRec, 1) + 'Δ' : '—'} / Infra: ${iRec !== null ? fmt(iRec, 1) + 'Δ' : '—'}`
      : 'Symmetric ductions';
    sheardEl.textContent = 'No demand (0.0Δ)';
    prismEl.textContent = 'None indicated';

    if (sBreak !== null && iBreak !== null) {
      const dBreak = Math.abs(sBreak - iBreak);
      const dRec = (sRec !== null && iRec !== null) ? Math.abs(sRec - iRec) : 0;
      if (dBreak >= 2.0 || dRec >= 1.5) {
        badgeEl.innerHTML = badgeHTML('amber', 'Asymmetric ductions');
      } else {
        badgeEl.innerHTML = badgeHTML('wnl', 'Balanced Orthophoria');
      }
    } else {
      badgeEl.innerHTML = badgeHTML('wnl', 'Orthophoria');
    }
    return;
  }

  const isRHP = phoria > 0;
  const mag = Math.abs(phoria);
  const phoriaLabel = isRHP ? `+${fmt(mag, 1)}Δ RHP` : `${fmt(mag, 1)}Δ LHP`;
  phoriaEl.textContent = phoriaLabel;

  // Compensating reserve:
  // For RHP (+), compensating reserve is Right Infraduction
  // For LHP (-), compensating reserve is Right Supraduction
  const compRec = isRHP ? iRec : sRec;
  const compBreak = isRHP ? iBreak : sBreak;
  const compName = isRHP ? 'Right Infraduction' : 'Right Supraduction';

  if (compRec === null || isNaN(compRec)) {
    compEl.textContent = `Needs ${compName}`;
    sheardEl.textContent = `Demand: ≥ ${fmt(2 * mag, 1)}Δ (2× phoria)`;
    prismEl.textContent = 'Enter ductions to calculate';
    badgeEl.innerHTML = badgeHTML('amber', 'Awaiting ductions');
    return;
  }

  compEl.textContent = `${compName}: ${compBreak !== null ? fmt(compBreak, 1) : '—'} / ${fmt(compRec, 1)}Δ`;

  // Sheard's criterion: Prism = (2 * Phoria - Compensating Reserve Recovery) / 3
  const sheardPrism = (2 * mag - compRec) / 3;
  sheardEl.textContent = `2×(${fmt(mag, 1)}) = ${fmt(2 * mag, 1)}Δ vs ${fmt(compRec, 1)}Δ rec`;

  if (sheardPrism <= 0) {
    prismEl.textContent = 'None (Compensated)';
    badgeEl.innerHTML = badgeHTML('wnl', 'Compensated by reserve');
  } else {
    const roundedPrism = Math.max(0.5, Math.round(sheardPrism * 4) / 4);
    const halfPrism = fmt(roundedPrism / 2, 2);
    const splitLabel = isRHP
      ? `${fmt(roundedPrism, 2)}Δ (${halfPrism}Δ BD OD / ${halfPrism}Δ BU OS)`
      : `${fmt(roundedPrism, 2)}Δ (${halfPrism}Δ BU OD / ${halfPrism}Δ BD OS)`;
    prismEl.textContent = splitLabel;
    badgeEl.innerHTML = badgeHTML('high', 'Decompensated vertical');
  }
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

  // --- VT 12 Vertical Classifications ----------------------------
  const vt12Phoria = STATE.vt12a;
  const vt12SupraRec = STATE.vt12b_supra_rec;
  const vt12SupraBreak = STATE.vt12b_supra_break;
  const vt12InfraRec = STATE.vt12b_infra_rec;
  const vt12InfraBreak = STATE.vt12b_infra_break;

  let vtSyndrome = null;

  if (vt12Phoria !== null && !isNaN(vt12Phoria)) {
    if (vt12Phoria > 0) {
      // Right Hyperphoria
      const mag = vt12Phoria;
      const compRec = vt12InfraRec;
      const isDecomp = compRec !== null ? ((2 * mag - compRec) / 3 > 0 || compRec < 1.5) : true;
      const sheardPrism = compRec !== null ? Math.max(0.5, Math.round(((2 * mag - compRec) / 3) * 4) / 4) : Math.max(0.5, Math.round(mag * 4) / 4);
      const halfPrism = fmt(sheardPrism / 2, 2);

      if (isDecomp) {
        vtSyndrome = {
          tag: 'VT-12 RHP',
          title: 'Decompensated Right Hyperphoria (Point #12)',
          desc: `Patient presents with <strong>+${fmt(mag, 1)}&Delta; Right Hyperphoria</strong> at distance. The compensating downward fusional reserve (Right Infraduction = ${compRec !== null ? fmt(compRec, 1) + '&Delta; recovery' : 'not fully encoded'}) fails Sheard's criterion (&ge; ${fmt(2 * mag, 1)}&Delta;), resulting in non-accommodative vertical asthenopia, loss of place during tracking, and secondary horizontal vergence instability.`,
          mgmt: [
            `Prescribe relieving vertical prism: <strong>${fmt(sheardPrism, 2)}&Delta; total</strong> split equally as <strong>${halfPrism}&Delta; Base-Down OD / ${halfPrism}&Delta; Base-Up OS</strong>`,
            'Vertical fusional vergence vision therapy: target Right Infraduction expansion, vertical jump vergence, and anti-suppression protocols',
            'Differential rule-out: Screen for right superior oblique paresis or non-comitancy using Park 3-step test and check for compensatory head tilt',
            'Clinical sequencing priority: Stabilize vertical alignment first; uncompensated vertical error impairs horizontal fusion adaptation'
          ]
        };
        results.push(vtSyndrome);
      } else {
        vtSyndrome = {
          tag: 'VT-12 RHP (COMP)',
          title: 'Compensated Right Hyperphoria (Point #12)',
          desc: `Patient exhibits <strong>+${fmt(mag, 1)}&Delta; Right Hyperphoria</strong> at distance, with compensating Right Infraduction (${fmt(compRec, 1)}&Delta; recovery) meeting Sheard's criterion.`,
          mgmt: [
            'Monitor vertical alignment stability under prolonged near visual fatigue',
            'Maintenance vision therapy for vertical fusional stamina',
            'Relieving prism not immediately indicated while deviation remains compensatory'
          ]
        };
        results.push(vtSyndrome);
      }
    } else if (vt12Phoria < 0) {
      // Left Hyperphoria
      const mag = Math.abs(vt12Phoria);
      const compRec = vt12SupraRec;
      const isDecomp = compRec !== null ? ((2 * mag - compRec) / 3 > 0 || compRec < 1.5) : true;
      const sheardPrism = compRec !== null ? Math.max(0.5, Math.round(((2 * mag - compRec) / 3) * 4) / 4) : Math.max(0.5, Math.round(mag * 4) / 4);
      const halfPrism = fmt(sheardPrism / 2, 2);

      if (isDecomp) {
        vtSyndrome = {
          tag: 'VT-12 LHP',
          title: 'Decompensated Left Hyperphoria (Point #12)',
          desc: `Patient presents with <strong>${fmt(mag, 1)}&Delta; Left Hyperphoria</strong> at distance. The compensating upward fusional reserve (Right Supraduction = ${compRec !== null ? fmt(compRec, 1) + '&Delta; recovery' : 'not fully encoded'}) fails Sheard's criterion (&ge; ${fmt(2 * mag, 1)}&Delta;), generating vertical binocular strain.`,
          mgmt: [
            `Prescribe relieving vertical prism: <strong>${fmt(sheardPrism, 2)}&Delta; total</strong> split equally as <strong>${halfPrism}&Delta; Base-Up OD / ${halfPrism}&Delta; Base-Down OS</strong>`,
            'Vertical fusional vergence vision therapy: target Right Supraduction / Left Infraduction expansion and sensory fusion stability',
            'Differential rule-out: Screen for left superior oblique paresis (Park 3-step test, check for head tilt to right shoulder)',
            'Clinical sequencing priority: Correct vertical deviation to enable effective horizontal vergence recovery'
          ]
        };
        results.push(vtSyndrome);
      } else {
        vtSyndrome = {
          tag: 'VT-12 LHP (COMP)',
          title: 'Compensated Left Hyperphoria (Point #12)',
          desc: `Patient exhibits <strong>${fmt(mag, 1)}&Delta; Left Hyperphoria</strong> at distance, with adequate Right Supraduction (${fmt(compRec, 1)}&Delta; recovery) satisfying Sheard's criterion.`,
          mgmt: [
            'Monitor vertical alignment periodically during high-demand visual tasks',
            'Maintenance vision therapy for vertical fusional reserve robustness',
            'Relieving prism not indicated while deviation remains fully compensated'
          ]
        };
        results.push(vtSyndrome);
      }
    } else if (vt12Phoria === 0 && vt12SupraBreak !== null && vt12InfraBreak !== null) {
      const dBreak = Math.abs(vt12SupraBreak - vt12InfraBreak);
      if (dBreak >= 2.0) {
        vtSyndrome = {
          tag: 'VT-12 ASYM',
          title: 'Vertical Duction Asymmetry / Latent Strain (Point #12)',
          desc: `Distance vertical phoria is Ortho (0&Delta;), but vertical fusional ductions are markedly asymmetric (Right Supra Break: ${fmt(vt12SupraBreak, 1)}&Delta; vs Right Infra Break: ${fmt(vt12InfraBreak, 1)}&Delta;), indicating latent vertical muscle imbalance or unequal tonus.`,
          mgmt: [
            'Perform prolonged monocular occlusion or fixation disparity testing to unmask latent vertical deviation',
            'Symmetrical vertical vergence vision therapy to balance supraduction and infraduction reserves',
            'Assess for micro-tropia or loss of place during high-speed reading saccades'
          ]
        };
        results.push(vtSyndrome);
      }
    }
  }

  if (results.length === 0) {
    tagEl.textContent = 'AWAITING DATA';
    titleEl.textContent = 'Insufficient findings for classification';
    descEl.textContent = 'Encode distance and near vergence reserves, vertical findings (VT #12), accommodative findings, and the gradient AC/A to activate the syndrome-matching rules for Types B1, B2, C, CI/CE, and Vertical Imbalances.';
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

  // Check if both horizontal and vertical anomalies exist
  const hasHorizontal = results.some(r => ['TYPE B1', 'TYPE B2', 'TYPE C', 'CI', 'CE'].includes(r.tag));
  const hasDecompVertical = vtSyndrome && (vtSyndrome.tag === 'VT-12 RHP' || vtSyndrome.tag === 'VT-12 LHP');

  if (hasHorizontal && hasDecompVertical) {
    const cmHTML = `
      <div class="cross-meridian-box extra-syndrome-result">
        <div class="cm-title">⚡ Cross-Meridian Correlation (VT #12 + Horizontal Syndrome)</div>
        <p>An active uncompensated vertical deviation (<strong>#12a ${vt12Phoria > 0 ? '+' + fmt(vt12Phoria, 1) + 'Δ RHP' : fmt(Math.abs(vt12Phoria), 1) + 'Δ LHP'}</strong>) is compromising the sensory lock required for horizontal motor alignment. Uncorrected vertical errors destabilize horizontal vergence reserves (#10/#11/#16b/#17b) and frequently exacerbate apparent accommodative fatigue (#5/#20). <strong>Management Priority:</strong> Prescribe relieving vertical prism or initiate vertical stabilization first to restore sensory fusion before expecting full remediation from horizontal therapy.</p>
      </div>`;
    syndromeBox.insertAdjacentHTML('beforeend', cmHTML);
  }

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
   6. PRESET PATIENTS (B1 / B2 / C / VT 12) + RESET
   All phoria values are plain signed numbers on the Exo(+)/Eso(−) axis
   for horizontal and Right Hyper(+)/Left Hyper(−) for vertical (VT #12).
------------------------------------------------------------------- */
const PRESET_B1 = {
  age: 24, ret4: -0.25, ret5: 1.25, ret6: 0.85, sub7: -0.75,
  d8: 1.0, d9: 5, d10break: 14, d10rec: 7, d11break: 16, d11rec: 8,
  vt12a: 0.0, vt12b_supra_break: 3.5, vt12b_supra_rec: 2.0, vt12b_infra_break: 3.5, vt12b_infra_rec: 2.0,
  n13b: 6.0, n13b1: 9.0, n14a: 0.50, n14b: 0.50, n15a: 6.0, n15b: 6.0,
  n16a: 12, n16bbreak: 15, n16brec: 9, n17a: 12, n17bbreak: 18, n17brec: 14,
  n19: 8.0, n20: -1.50, n21: 1.75
};

const PRESET_B2 = {
  age: 24, ret4: -0.25, ret5: 1.25, ret6: 0.85, sub7: -0.75,
  d8: 1.0, d9: 5, d10break: 14, d10rec: 7, d11break: 6, d11rec: 3,
  vt12a: 0.0, vt12b_supra_break: 3.5, vt12b_supra_rec: 2.0, vt12b_infra_break: 3.5, vt12b_infra_rec: 2.0,
  n13b: 6.0, n13b1: 9.0, n14a: 0.50, n14b: 0.50, n15a: 6.0, n15b: 6.0,
  n16a: 12, n16bbreak: 15, n16brec: 9, n17a: 12, n17bbreak: 18, n17brec: 14,
  n19: 8.0, n20: -1.50, n21: 1.75
};

const PRESET_C = {
  age: 24, ret4: 0.00, ret5: 0.85, ret6: 0.35, sub7: -0.50,
  d8: 0.25, d9: 8, d10break: 14, d10rec: 8, d11break: 6, d11rec: 3,
  vt12a: 0.0, vt12b_supra_break: 3.5, vt12b_supra_rec: 2.0, vt12b_infra_break: 3.5, vt12b_infra_rec: 2.0,
  n13b: 6.0, n13b1: 9.5, n14a: 0.50, n14b: 0.50, n15a: 6.0, n15b: 6.0,
  n16a: 14, n16bbreak: 15, n16brec: 9, n17a: 10, n17bbreak: 16, n17brec: 10,
  n19: 8.0, n20: -2.75, n21: 2.25
};

const PRESET_VT12 = {
  age: 26, ret4: 0.00, ret5: 0.85, ret6: 0.35, sub7: -0.50,
  d8: 0.5, d9: 8, d10break: 20, d10rec: 11, d11break: 10, d11rec: 6,
  vt12a: 1.5, vt12b_supra_break: 4.0, vt12b_supra_rec: 2.0, vt12b_infra_break: 2.0, vt12b_infra_rec: 0.5,
  n13b: 6.0, n13b1: 9.0, n14a: 0.50, n14b: 0.50, n15a: 6.0, n15b: 6.0,
  n16a: 16, n16bbreak: 22, n16brec: 16, n17a: 15, n17bbreak: 23, n17brec: 19,
  n19: 11.0, n20: -2.50, n21: 2.00
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
const btnVT12 = document.getElementById('btnVT12');
const resetBtn = document.getElementById('resetBtn');

if (btnB1) btnB1.addEventListener('click', () => applyPatient(PRESET_B1));
if (btnB2) btnB2.addEventListener('click', () => applyPatient(PRESET_B2));
if (btnC) btnC.addEventListener('click', () => applyPatient(PRESET_C));
if (btnVT12) btnVT12.addEventListener('click', () => applyPatient(PRESET_VT12));
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

/* ---------------------------------------------------------------------
   8. FRAMEWORK TAB CONTROLLER (Leo Manas vs. Mitchell Scheiman)
------------------------------------------------------------------- */
(function setupFrameworkTabs() {
  const tabManas = document.getElementById('tab-manas');
  const tabScheiman = document.getElementById('tab-scheiman');
  const panelManas = document.getElementById('panel-manas');
  const panelScheiman = document.getElementById('panel-scheiman');
  const manasPresets = document.getElementById('manasPresets');
  const brandMark = document.getElementById('brandMark');
  const brandSubtitle = document.getElementById('brandSubtitle');

  const tabs = [
    { id: 'manas', btn: tabManas, panel: panelManas },
    { id: 'scheiman', btn: tabScheiman, panel: panelScheiman }
  ];

  function switchTab(targetId, updateHash = true) {
    tabs.forEach(({ id, btn, panel }) => {
      const isActive = (id === targetId);
      if (btn) {
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
      }
      if (panel) {
        panel.classList.toggle('active', isActive);
        if (isActive) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', '');
        }
      }
    });

    if (manasPresets) {
      manasPresets.style.display = (targetId === 'manas') ? 'inline-flex' : 'none';
    }
    const scheimanPresets = document.getElementById('scheimanPresets');
    if (scheimanPresets) {
      scheimanPresets.style.display = (targetId === 'scheiman') ? 'inline-flex' : 'none';
    }

    if (brandSubtitle) {
      if (targetId === 'manas') {
        brandSubtitle.textContent = 'Manas 21‑Point · Case Chaining Engine';
      } else {
        brandSubtitle.textContent = 'Mitchell Scheiman · Binocular Vision & Accommodation';
      }
    }

    if (brandMark) {
      brandMark.textContent = (targetId === 'manas') ? '21°' : 'MS';
    }

    try {
      localStorage.setItem('activeFrameworkTab', targetId);
    } catch (_) {}

    if (updateHash) {
      if (window.location.hash !== `#${targetId}`) {
        history.replaceState(null, '', `#${targetId}`);
      }
    }
  }

  if (tabManas) tabManas.addEventListener('click', () => switchTab('manas'));
  if (tabScheiman) tabScheiman.addEventListener('click', () => switchTab('scheiman'));

  // Keyboard navigation for WAI-ARIA tabs (ArrowLeft / ArrowRight)
  const tabList = document.querySelector('.framework-nav');
  if (tabList) {
    tabList.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const activeIdx = tabs.findIndex(t => t.btn && t.btn.classList.contains('active'));
        const nextIdx = (activeIdx + 1) % tabs.length;
        if (tabs[nextIdx].btn) {
          tabs[nextIdx].btn.focus();
          switchTab(tabs[nextIdx].id);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const activeIdx = tabs.findIndex(t => t.btn && t.btn.classList.contains('active'));
        const prevIdx = (activeIdx - 1 + tabs.length) % tabs.length;
        if (tabs[prevIdx].btn) {
          tabs[prevIdx].btn.focus();
          switchTab(tabs[prevIdx].id);
        }
      }
    });
  }

  // Restore tab from hash or localStorage, default to 'scheiman'
  const hash = window.location.hash.replace('#', '').toLowerCase();
  let saved = null;
  try {
    saved = localStorage.getItem('activeFrameworkTab');
  } catch (_) {}

  const initialTab = (hash === 'manas' || (!hash && saved === 'manas')) ? 'manas' : 'scheiman';
  switchTab(initialTab, false);
})();

/* =====================================================================
   9. MITCHELL SCHEIMAN CLINICAL FORM & DIAGNOSTIC ENGINE
   Vanilla-JS, Morgan's Norms, Parallel 21-Point Steps, Sheard's
===================================================================== */

const SCHEIMAN_STATE = {};
const SCHEIMAN_FLAGS = {};

function computeHofstetterNorms(age) {
  if (age === null || age === undefined || isNaN(age) || age <= 0) return null;
  const aoaAvgRaw = 18.5 - 0.30 * age;
  const aoaMinRaw = 15.0 - 0.25 * age;
  const aoaAvg = Math.max(0, aoaAvgRaw);
  const aoaMin = Math.max(0, aoaMinRaw);
  const npaAvg = aoaAvgRaw > 0 ? 100 / aoaAvgRaw : null;
  const npaMin = aoaMinRaw > 0 ? 100 / aoaMinRaw : null;
  return { aoaAvg, aoaMin, npaAvg, npaMin };
}

function morganReserveStatus(value, expectedMean, sd) {
  if (value === null || value === '' || isNaN(value)) return { status: 'idle', note: '—' };
  const lower = expectedMean - (sd || 0);
  if (value < lower) return { status: 'low', note: `< ${lower}Δ (below expected)` };
  if (value >= expectedMean + (sd || 0) * 1.5) return { status: 'high', note: `≥ ${expectedMean + (sd || 0) * 1.5}Δ (above expected)` };
  return { status: 'wnl', note: `meets ${expectedMean}Δ norm` };
}

function morganPhoriaStatus(value, mean, sd) {
  if (value === null || value === '' || isNaN(value)) return { status: 'idle', note: '—' };
  const highThreshold = mean + sd;
  const lowThreshold = mean - sd;
  if (value > highThreshold) return { status: 'high', note: `> +${highThreshold}Δ (Exo trend)` };
  if (value < lowThreshold) return { status: 'low', note: `< ${lowThreshold < 0 ? '' : '+'}${lowThreshold}Δ (Eso trend)` };
  return { status: 'wnl', note: 'within Morgan range' };
}

function formatSignedDiopter(val) {
  if (val === null || val === undefined || isNaN(val)) return '';
  if (val > 0) return `+${Number(val).toFixed(2)}`;
  return Number(val).toFixed(2);
}

const SCHEIMAN_FIELDS = [
  // 1. Baseline Refraction (#4 & #7a only)
  {
    id: 's_ret4', section: 'baseline', oep: 'Pt. #4', label: 'Static Retinoscopy', sub: 'Objective distance spherical equivalent baseline',
    kind: 'num', signedDiopter: true, unit: 'D', step: '0.25', placeholder: '-1.00',
    evaluate: () => ({ status: 'idle', note: 'objective refractive baseline' }),
    normText: () => 'Clinical baseline'
  },
  {
    id: 's_sub7a', section: 'baseline', oep: 'Pt. #7a', label: 'Subjective Refraction', sub: 'Distance MPMVA subjective baseline',
    kind: 'num', signedDiopter: true, unit: 'D', step: '0.25', placeholder: '-1.00',
    evaluate: () => ({ status: 'idle', note: 'subjective refractive baseline' }),
    normText: () => 'Clinical baseline'
  },

  // 2. Patient Age & Amplitude of Accommodation (OU Only: Measured AOA in D & Measured NPA in cm)
  {
    id: 's_amp', section: 'age_accomm', oep: 'Pt. #19', label: 'Measured AOA (OU)', sub: 'Amplitude of Accommodation — Both Eyes (push-up, in D)',
    kind: 'num', unit: 'D', step: '0.25', placeholder: '12.0',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      const norms = computeHofstetterNorms(SCHEIMAN_STATE.s_age);
      if (!norms) return { status: 'amber', note: 'enter age for Hofstetter norm' };
      if (v < norms.aoaMin) return { status: 'low', note: `below min (${fmt(norms.aoaMin, 1)} D)` };
      if (v < norms.aoaAvg) return { status: 'amber', note: `between min (${fmt(norms.aoaMin, 1)} D) & avg (${fmt(norms.aoaAvg, 1)} D)` };
      return { status: 'wnl', note: `≥ avg (${fmt(norms.aoaAvg, 1)} D)` };
    },
    normText: () => {
      const norms = computeHofstetterNorms(SCHEIMAN_STATE.s_age);
      if (!norms) return 'Avg: 18.5−0.30·Age / Min: 15−0.25·Age';
      return `Avg ${fmt(norms.aoaAvg, 1)} D · Min ${fmt(norms.aoaMin, 1)} D`;
    }
  },
  {
    id: 's_npa', section: 'age_accomm', oep: 'Clinical BV', label: 'Measured NPA (OU)', sub: 'Near Point of Accommodation — Both Eyes (push-up, in cm)',
    kind: 'num', unit: 'cm', step: '0.5', placeholder: '8.3',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      const norms = computeHofstetterNorms(SCHEIMAN_STATE.s_age);
      if (!norms) return { status: 'amber', note: 'enter age for Hofstetter norm' };
      if (norms.npaMin !== null && v > norms.npaMin) {
        return { status: 'low', note: `receded (> ${fmt(norms.npaMin, 1)} cm max)` };
      }
      if (norms.npaAvg !== null && v > norms.npaAvg) {
        return { status: 'amber', note: `between avg (${fmt(norms.npaAvg, 1)} cm) & max (${norms.npaMin !== null ? fmt(norms.npaMin, 1) + ' cm' : '>100 cm'})` };
      }
      return { status: 'wnl', note: norms.npaAvg !== null ? `≤ avg (${fmt(norms.npaAvg, 1)} cm)` : 'within presbyopic norm' };
    },
    normText: () => {
      const norms = computeHofstetterNorms(SCHEIMAN_STATE.s_age);
      if (!norms) return '100 / AOA_avg · 100 / AOA_min';
      const avgTxt = norms.npaAvg !== null ? `${fmt(norms.npaAvg, 1)} cm` : '>100 cm';
      const minTxt = norms.npaMin !== null ? `${fmt(norms.npaMin, 1)} cm` : '>100 cm';
      return `Avg ${avgTxt} · Max ${minTxt}`;
    }
  },

  // 3. Distance Phoria Findings (6 m): #8, BI / NFV (#11), BO / PFV (#9, #10)
  {
    id: 's_d_phoria', section: 'distance', oep: 'Pt. #8', label: 'Distance Lateral Phoria (6 m)', sub: 'Von Graefe / Maddox rod',
    kind: 'phoria', unit: 'Δ', step: '0.5', placeholder: '+1.0',
    evaluate: (v) => morganPhoriaStatus(v, 1.0, 2.0),
    normText: () => '1.0Δ Exo (±2.0Δ)'
  },
  {
    id: 's_d_bi_blur', section: 'distance', oep: 'Pt. #11', label: 'Distance BI Blur (NFV)', sub: 'Base-in to blur at 6 m',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '—',
    evaluate: () => ({ status: 'idle', note: 'none expected' }),
    normText: () => '— (no blur expected)'
  },
  {
    id: 's_d_bi_break', section: 'distance', oep: 'Pt. #11', label: 'Distance BI Break (NFV)', sub: 'Base-in to diplopia at 6 m',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '7',
    evaluate: (v) => morganReserveStatus(v, 7, 3),
    normText: () => '7Δ (±3Δ)'
  },
  {
    id: 's_d_bi_rec', section: 'distance', oep: 'Pt. #11', label: 'Distance BI Recovery (NFV)', sub: 'Base-in recovery at 6 m',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '4',
    evaluate: (v) => morganReserveStatus(v, 4, 2),
    normText: () => '4Δ (±2Δ)'
  },
  {
    id: 's_d_bo_blur', section: 'distance', oep: 'Pt. #9', label: 'Distance BO Blur (PFV)', sub: 'Base-out to blur at 6 m',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '9',
    evaluate: (v) => morganReserveStatus(v, 9, 4),
    normText: () => '9Δ (±4Δ)'
  },
  {
    id: 's_d_bo_break', section: 'distance', oep: 'Pt. #10', label: 'Distance BO Break (PFV)', sub: 'Base-out to diplopia at 6 m',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '19',
    evaluate: (v) => morganReserveStatus(v, 19, 8),
    normText: () => '19Δ (±8Δ)'
  },
  {
    id: 's_d_bo_rec', section: 'distance', oep: 'Pt. #10', label: 'Distance BO Recovery (PFV)', sub: 'Base-out recovery at 6 m',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '10',
    evaluate: (v) => morganReserveStatus(v, 10, 4),
    normText: () => '10Δ (±4Δ)'
  },

  // 4. Nearpoint Phoria Findings (40 cm): NPC, #13b, #13b+1.00, Near BI (#17), Near BO (#16)
  {
    id: 's_npc_break', section: 'near', oep: 'Clinical BV', label: 'Near Point of Convergence (NPC Break)', sub: 'Accommodative target (TTM) to diplopia',
    kind: 'num', unit: 'cm', step: '0.5', placeholder: '4.0',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v > 5.0) return { status: 'amber', note: `${fmt(v, 1)} cm > 5 cm (receded)` };
      return { status: 'wnl', note: 'normal (< 5 cm)' };
    },
    normText: () => '< 5 cm'
  },
  {
    id: 's_npc_rec', section: 'near', oep: 'Clinical BV', label: 'NPC Recovery', sub: 'Recovery of single binocular vision',
    kind: 'num', unit: 'cm', step: '0.5', placeholder: '6.0',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v > 7.0) return { status: 'amber', note: `${fmt(v, 1)} cm > 7 cm (receded)` };
      return { status: 'wnl', note: 'normal (< 7 cm)' };
    },
    normText: () => '< 7 cm'
  },
  {
    id: 's_n_phoria', section: 'near', oep: 'Pt. #13b', label: 'Near Lateral Phoria (40 cm)', sub: 'Von Graefe at 40 cm',
    kind: 'phoria', unit: 'Δ', step: '0.5', placeholder: '+3.0',
    evaluate: (v) => morganPhoriaStatus(v, 3.0, 3.0),
    normText: () => '3.0Δ Exo (±3.0Δ)'
  },
  {
    id: 's_n_phoria_plus1', section: 'near', oep: 'Pt. #13b+1.00', label: '+1.00 D Gradient Phoria', sub: 'Near lateral phoria through +1.00 D lens (Gradient AC/A input)',
    kind: 'phoria', unit: 'Δ', step: '0.5', placeholder: '+7.0',
    evaluate: () => ({ status: 'idle', note: 'used for Gradient AC/A' }),
    normText: () => 'Used for Gradient AC/A'
  },
  {
    id: 's_n_bi_blur', section: 'near', oep: 'Pt. #17a', label: 'Near BI Blur (NFV)', sub: 'Base-in to blur at 40 cm',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '13',
    evaluate: (v) => morganReserveStatus(v, 13, 4),
    normText: () => '13Δ (±4Δ)'
  },
  {
    id: 's_n_bi_break', section: 'near', oep: 'Pt. #17b', label: 'Near BI Break (NFV)', sub: 'Base-in to diplopia at 40 cm',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '21',
    evaluate: (v) => morganReserveStatus(v, 21, 4),
    normText: () => '21Δ (±4Δ)'
  },
  {
    id: 's_n_bi_rec', section: 'near', oep: 'Pt. #17b', label: 'Near BI Recovery (NFV)', sub: 'Base-in recovery at 40 cm',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '13',
    evaluate: (v) => morganReserveStatus(v, 13, 5),
    normText: () => '13Δ (±5Δ)'
  },
  {
    id: 's_n_bo_blur', section: 'near', oep: 'Pt. #16a', label: 'Near BO Blur (PFV)', sub: 'Base-out to blur at 40 cm',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '17',
    evaluate: (v) => morganReserveStatus(v, 17, 5),
    normText: () => '17Δ (±5Δ)'
  },
  {
    id: 's_n_bo_break', section: 'near', oep: 'Pt. #16b', label: 'Near BO Break (PFV)', sub: 'Base-out to diplopia at 40 cm',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '21',
    evaluate: (v) => morganReserveStatus(v, 21, 6),
    normText: () => '21Δ (±6Δ)'
  },
  {
    id: 's_n_bo_rec', section: 'near', oep: 'Pt. #16b', label: 'Near BO Recovery (PFV)', sub: 'Base-out recovery at 40 cm',
    kind: 'num', unit: 'Δ', step: '1', placeholder: '11',
    evaluate: (v) => morganReserveStatus(v, 11, 7),
    normText: () => '11Δ (±7Δ)'
  },

  // 5. Accommodative Battery: MEM (#6), MAF, BAF, NRA (#21), PRA (#20)
  {
    id: 's_mem', section: 'accomm', oep: 'Pt. #6', label: 'MEM Retinoscopy', sub: 'Dynamic retinoscopy at 40 cm (accommodative lag/lead)',
    kind: 'num', unit: 'D', step: '0.25', placeholder: '+0.50',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v > 0.75) return { status: 'high', note: 'lag > +0.75 D (under-accommodating)' };
      if (v < 0.25) return { status: 'low', note: 'lead / lag < +0.25 D (over-accommodating)' };
      return { status: 'wnl', note: '+0.50 D expected lag' };
    },
    normText: () => '+0.50 D (±0.25 D)'
  },
  {
    id: 's_maf', section: 'accomm', oep: 'Clinical BV', label: 'Monocular Accomm. Facility (MAF)', sub: '±2.00 D flipper at 40 cm (OD/OS cpm)',
    kind: 'num', unit: 'cpm', step: '1', placeholder: '11',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v < 6) return { status: 'low', note: `${v} cpm < 6 cpm (reduced)` };
      return { status: 'wnl', note: 'meets 11 cpm norm' };
    },
    normText: () => '11 cpm (±5 cpm)'
  },
  {
    id: 's_maf_fail', section: 'accomm', oep: 'Clinical BV', label: 'MAF Failure Direction', sub: 'Clinical difficulty clearing lenses monocularly',
    kind: 'select',
    options: [
      { value: '', label: '— Select clinical response —' },
      { value: 'pass', label: 'Pass (Clears +2.00 and -2.00 easily monocularly)' },
      { value: 'minus', label: 'Fails Minus (-) [Accommodative Insufficiency]' },
      { value: 'plus', label: 'Fails Plus (+) [Accommodative Excess]' },
      { value: 'both', label: 'Fails Both (+/-) [Accommodative Infacility]' }
    ],
    evaluate: (v) => {
      if (!v) return { status: 'idle', note: '—' };
      if (v === 'pass') return { status: 'wnl', note: 'normal monocular facility' };
      if (v === 'minus') return { status: 'low', note: 'fails minus (-) [AI / fatigue]' };
      if (v === 'plus') return { status: 'low', note: 'fails plus (+) [AE / spasm]' };
      if (v === 'both') return { status: 'low', note: 'fails both (+/-)' };
      return { status: 'idle', note: '—' };
    },
    normText: () => 'Pass (+ & −)'
  },
  {
    id: 's_baf', section: 'accomm', oep: 'Clinical BV', label: 'Binocular Accomm. Facility (BAF)', sub: '±2.00 D flipper at 40 cm (binocular cpm)',
    kind: 'num', unit: 'cpm', step: '1', placeholder: '8',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v < 3) return { status: 'low', note: `${v} cpm < 3 cpm (reduced)` };
      return { status: 'wnl', note: 'meets 8 cpm norm' };
    },
    normText: () => '8 cpm (±5 cpm)'
  },
  {
    id: 's_baf_fail', section: 'accomm', oep: 'Clinical BV', label: 'BAF Failure Direction', sub: 'Clinical difficulty clearing lenses binocularly',
    kind: 'select',
    options: [
      { value: '', label: '— Select clinical response —' },
      { value: 'pass', label: 'Pass (Clears +2.00 and -2.00 easily)' },
      { value: 'minus', label: 'Fails Minus (-) [Stimulation / NFV difficulty]' },
      { value: 'plus', label: 'Fails Plus (+) [Relaxation / PFV difficulty]' },
      { value: 'both', label: 'Fails Both (+/-) [Accommodative Infacility / FVD]' }
    ],
    evaluate: (v) => {
      if (!v) return { status: 'idle', note: '—' };
      if (v === 'pass') return { status: 'wnl', note: 'clears ±2.00 D easily' };
      if (v === 'minus') return { status: 'low', note: 'fails minus (-) [NFV / accomm demand]' };
      if (v === 'plus') return { status: 'low', note: 'fails plus (+) [PFV / accomm relax]' };
      if (v === 'both') return { status: 'low', note: 'fails both (+/-)' };
      return { status: 'idle', note: '—' };
    },
    normText: () => 'Pass (+ & −)'
  },
  {
    id: 's_nra', section: 'accomm', oep: 'Pt. #21', label: 'Negative Relative Accomm. (NRA)', sub: 'Plus lenses to blur at 40 cm',
    kind: 'num', unit: 'D', step: '0.25', placeholder: '+2.00',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v < 1.50) return { status: 'low', note: '< +1.50 D (low)' };
      if (v > 2.50) return { status: 'high', note: '> +2.50 D (high / latent hyperopia)' };
      return { status: 'wnl', note: 'meets +2.00 D norm' };
    },
    normText: () => '+2.00 D (±0.50 D)'
  },
  {
    id: 's_pra', section: 'accomm', oep: 'Pt. #20', label: 'Positive Relative Accomm. (PRA)', sub: 'Minus lenses to blur at 40 cm',
    kind: 'num', unit: 'D', step: '0.25', placeholder: '-2.50',
    evaluate: (v) => {
      if (v === null || isNaN(v)) return { status: 'idle', note: '—' };
      if (v > -1.37) return { status: 'low', note: 'short of -1.37 D norm' };
      return { status: 'wnl', note: 'meets -2.37 D norm' };
    },
    normText: () => '−2.37 D (±1.00 D)'
  }
];

function formatScheimanPhoriaLabel(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  if (val === 0) return 'Ortho (0.0Δ)';
  if (val > 0) return `+${fmt(val, 1)}Δ Exo`;
  return `${fmt(Math.abs(val), 1)}Δ Eso`;
}

function updateScheimanPhoriaPreview(id, val) {
  const el = document.getElementById(`scheiman-prev-${id}`);
  if (!el) return;
  if (val === null || val === undefined || isNaN(val)) {
    el.textContent = '';
    el.className = 'phoria-preview';
    return;
  }
  if (val === 0) {
    el.textContent = 'Ortho (0.0Δ)';
    el.className = 'phoria-preview ortho';
  } else if (val > 0) {
    el.textContent = `+${fmt(val, 1)}Δ Exo`;
    el.className = 'phoria-preview exo';
  } else {
    el.textContent = `${fmt(Math.abs(val), 1)}Δ Eso`;
    el.className = 'phoria-preview eso';
  }
}

function renderScheimanTables() {
  const targets = {
    baseline: document.getElementById('tbl-scheiman-baseline'),
    age_accomm: document.getElementById('tbl-scheiman-age-accomm'),
    distance: document.getElementById('tbl-scheiman-distance'),
    near: document.getElementById('tbl-scheiman-near'),
    accomm: document.getElementById('tbl-scheiman-accomm')
  };

  SCHEIMAN_FIELDS.forEach(f => {
    const tbody = targets[f.section];
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.id = `scheiman-row-${f.id}`;

    let inputHTML;
    if (f.kind === 'phoria') {
      const pl = f.placeholder || '+3.0';
      inputHTML = `
        <div class="inp-wrap phoria-wrap">
          <input type="number" step="${f.step || '0.5'}"
                 placeholder="${pl}"
                 data-scheiman-signed="${f.id}"
                 aria-label="${f.label}">
          <span class="unit">${f.unit}</span>
          <span class="phoria-preview" id="scheiman-prev-${f.id}"></span>
        </div>`;
    } else if (f.kind === 'select') {
      inputHTML = `
        <div class="inp-wrap" style="width:100%;">
          <select data-scheiman-select="${f.id}" class="field-select" aria-label="${f.label}">
            ${(f.options || []).map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
          </select>
        </div>`;
    } else if (f.signedDiopter) {
      inputHTML = `
        <div class="inp-wrap">
          <input type="text" inputmode="decimal"
                 class="signed-diopter"
                 placeholder="${f.placeholder || '—'}"
                 data-scheiman-num="${f.id}"
                 data-signed-diopter="true"
                 data-step="${f.step || '0.25'}"
                 aria-label="${f.label}">
          <span class="unit">${f.unit}</span>
        </div>`;
    } else {
      inputHTML = `
        <div class="inp-wrap">
          <input type="number" step="${f.step || '0.25'}"
                 placeholder="${f.placeholder || '—'}"
                 data-scheiman-num="${f.id}"
                 aria-label="${f.label}">
          <span class="unit">${f.unit}</span>
        </div>`;
    }

    tr.innerHTML = `
      <td class="cell-oep"><span class="oep-no">${f.oep}</span></td>
      <td class="flabel" data-oep="${f.oep}">
        ${f.label}
        <small>${f.sub}</small>
      </td>
      <td>${inputHTML}</td>
      <td class="cell-norm"><span class="norm-text" id="scheiman-norm-${f.id}">${f.normText()}</span></td>
      <td class="cell-status" id="scheiman-badge-${f.id}">${badgeHTML('idle', '—')}</td>
    `;
    tbody.appendChild(tr);
  });

  // Attach live input listeners for signed phorias
  document.querySelectorAll('[data-scheiman-signed]').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.getAttribute('data-scheiman-signed');
      const val = inp.value.trim() === '' ? null : parseFloat(inp.value);
      SCHEIMAN_STATE[id] = (val === null || isNaN(val)) ? null : val;
      updateScheimanPhoriaPreview(id, SCHEIMAN_STATE[id]);
      evaluateScheiman();
    });
  });

  // Attach live input listeners for numbers (includes dedicated #scheimanAgeInput & signed diopter fields)
  document.querySelectorAll('[data-scheiman-num]').forEach(inp => {
    const id = inp.getAttribute('data-scheiman-num');
    const isSignedDiopter = inp.getAttribute('data-signed-diopter') === 'true';

    inp.addEventListener('input', () => {
      const val = inp.value.trim() === '' ? null : parseFloat(inp.value);
      SCHEIMAN_STATE[id] = (val === null || isNaN(val)) ? null : val;
      evaluateScheiman();
    });

    if (isSignedDiopter) {
      const formatField = () => {
        const raw = inp.value.trim();
        if (raw === '') {
          SCHEIMAN_STATE[id] = null;
          inp.value = '';
        } else {
          const val = parseFloat(raw);
          if (isNaN(val)) {
            SCHEIMAN_STATE[id] = null;
            inp.value = '';
          } else {
            SCHEIMAN_STATE[id] = val;
            inp.value = formatSignedDiopter(val);
          }
        }
        evaluateScheiman();
      };

      inp.addEventListener('blur', formatField);
      inp.addEventListener('change', formatField);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const step = parseFloat(inp.getAttribute('data-step')) || 0.25;
          const cur = parseFloat(inp.value);
          const base = isNaN(cur) ? 0 : cur;
          const next = Number((base + (e.key === 'ArrowUp' ? step : -step)).toFixed(2));
          SCHEIMAN_STATE[id] = next;
          inp.value = formatSignedDiopter(next);
          evaluateScheiman();
        }
      });
    }
  });

  // Attach live listeners for select dropdowns
  document.querySelectorAll('[data-scheiman-select]').forEach(sel => {
    sel.addEventListener('change', () => {
      const id = sel.getAttribute('data-scheiman-select');
      SCHEIMAN_STATE[id] = sel.value || null;
      evaluateScheiman();
    });
  });
}

// Scheiman AC/A SVG dial — Morgan's expected 4:1 ± 2 (2:1–6:1 green zone)
function drawScheimanAcaGauge(value) {
  const svg = document.getElementById('scheimanAcaGauge');
  if (!svg) return;
  const cx = 110, cy = 110, r = 90;
  const minV = 0, maxV = 10;
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
    <path d="${arcPath(minV, 2, r)}" fill="none" stroke="#E2ECF3" stroke-width="16"/>
    <path d="${arcPath(2, 6, r)}" fill="none" stroke="#CADFCE" stroke-width="16"/>
    <path d="${arcPath(6, maxV, r)}" fill="none" stroke="#F5E3E1" stroke-width="16"/>
    ${needle}
    <text x="${cx}" y="128" text-anchor="middle" font-size="10" fill="#4B5670" font-family="ui-monospace,monospace">4:1 ± 2</text>
    <text x="${cx - r}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#4B5670" font-family="ui-monospace,monospace">0</text>
    <text x="${cx + r}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#4B5670" font-family="ui-monospace,monospace">10</text>
  `;
}

function evaluateScheiman() {
  // 1. Hofstetter Normal Ranges Box update (AOA in D & NPA in cm)
  const norms = computeHofstetterNorms(SCHEIMAN_STATE.s_age);
  const avgEl = document.getElementById('hofCalcAvgVal');
  const minEl = document.getElementById('hofCalcMinVal');
  const npaAvgEl = document.getElementById('hofCalcNpaAvgVal');
  const npaMinEl = document.getElementById('hofCalcNpaMinVal');

  if (norms) {
    if (avgEl) avgEl.textContent = `${fmt(norms.aoaAvg, 1)} D`;
    if (minEl) minEl.textContent = `${fmt(norms.aoaMin, 1)} D`;
    if (npaAvgEl) npaAvgEl.textContent = norms.npaAvg !== null ? `${fmt(norms.npaAvg, 1)} cm` : '> 100 cm';
    if (npaMinEl) npaMinEl.textContent = norms.npaMin !== null ? `${fmt(norms.npaMin, 1)} cm` : '> 100 cm';
  } else {
    if (avgEl) avgEl.textContent = '—';
    if (minEl) minEl.textContent = '—';
    if (npaAvgEl) npaAvgEl.textContent = '—';
    if (npaMinEl) npaMinEl.textContent = '—';
  }

  // 2. Evaluate individual fields against Morgan's & Hofstetter's expectancies
  SCHEIMAN_FIELDS.forEach(f => {
    const v = SCHEIMAN_STATE[f.id] ?? null;
    const res = f.evaluate(v);
    SCHEIMAN_FLAGS[f.id] = res;
    const normEl = document.getElementById(`scheiman-norm-${f.id}`);
    if (normEl) normEl.textContent = f.normText();
    const badgeEl = document.getElementById(`scheiman-badge-${f.id}`);
    if (badgeEl) badgeEl.innerHTML = badgeHTML(res.status, res.note);
  });

  // 3. Auto-calculated Gradient AC/A (#13b+1.00 − #13b) vs Morgan's 4:1 ± 2
  const np = SCHEIMAN_STATE.s_n_phoria;
  const npPlus = SCHEIMAN_STATE.s_n_phoria_plus1;
  const acaValEl = document.getElementById('scheimanAcaValue');
  const acaLblEl = document.getElementById('scheimanAcaLabel');
  const acaPhoriaEl = document.getElementById('scheimanAcaPhoriaVal');
  const acaPlus1El = document.getElementById('scheimanAcaPlus1Val');
  const acaBadgeEl = document.getElementById('scheimanAcaStatusBadge');
  let acaRatio = null;

  if (acaPhoriaEl) acaPhoriaEl.textContent = formatScheimanPhoriaLabel(np);
  if (acaPlus1El) acaPlus1El.textContent = formatScheimanPhoriaLabel(npPlus);

  if (np !== null && np !== undefined && !isNaN(np) && npPlus !== null && npPlus !== undefined && !isNaN(npPlus)) {
    acaRatio = npPlus - np;
    if (acaValEl) acaValEl.textContent = `${fmt(acaRatio, 1)} : 1`;
    let acaTxt, acaStatus, acaNote;
    if (acaRatio < 2) {
      acaTxt = 'Low AC/A ratio (< 2:1; Morgan\'s expected 4:1 ± 2)';
      acaStatus = 'low';
      acaNote = `${fmt(acaRatio, 1)}:1 < 2:1 (Low AC/A)`;
    } else if (acaRatio > 6) {
      acaTxt = 'High AC/A ratio (> 6:1; Morgan\'s expected 4:1 ± 2)';
      acaStatus = 'high';
      acaNote = `${fmt(acaRatio, 1)}:1 > 6:1 (High AC/A)`;
    } else {
      acaTxt = 'Within Morgan\'s expected range (4:1 ± 2)';
      acaStatus = 'wnl';
      acaNote = `${fmt(acaRatio, 1)}:1 within 2:1–6:1`;
    }
    if (acaLblEl) acaLblEl.textContent = acaTxt;
    if (acaBadgeEl) acaBadgeEl.innerHTML = badgeHTML(acaStatus, acaNote);
    drawScheimanAcaGauge(acaRatio);
  } else {
    if (acaValEl) acaValEl.textContent = '—';
    if (acaLblEl) acaLblEl.textContent = 'Enter #13b and #13b +1.00 D phorias to calculate';
    if (acaBadgeEl) acaBadgeEl.innerHTML = badgeHTML('idle', '—');
    drawScheimanAcaGauge(null);
  }

  // 4. Sheard's Criterion Solver (S = ⅔D − ⅓R for Exophoria vs BO Reserve)
  const dPhoria = SCHEIMAN_STATE.s_d_phoria;
  const nPhoria = SCHEIMAN_STATE.s_n_phoria;
  const nBoBlur = SCHEIMAN_STATE.s_n_bo_blur;
  const nBoBreak = SCHEIMAN_STATE.s_n_bo_break;
  const dBoBlur = SCHEIMAN_STATE.s_d_bo_blur;
  const dBoBreak = SCHEIMAN_STATE.s_d_bo_break;

  const useNear = nPhoria !== null && !isNaN(nPhoria) && nPhoria > 0;
  const useDist = !useNear && dPhoria !== null && !isNaN(dPhoria) && dPhoria > 0;
  const exoDemand = useNear ? nPhoria : (useDist ? dPhoria : null);
  const exoScope = useNear ? 'Near' : (useDist ? 'Distance' : '');
  const pfvReserve = useNear
    ? ((nBoBlur !== null && !isNaN(nBoBlur)) ? nBoBlur : (nBoBreak !== null && !isNaN(nBoBreak) ? nBoBreak : null))
    : (useDist
      ? ((dBoBlur !== null && !isNaN(dBoBlur)) ? dBoBlur : (dBoBreak !== null && !isNaN(dBoBreak) ? dBoBreak : null))
      : null);

  const sheardDemEl = document.getElementById('sheardDemandVal');
  const sheardResEl = document.getElementById('sheardReserveVal');
  const sheardReqEl = document.getElementById('sheardReqVal');
  const sheardPrismEl = document.getElementById('sheardPrismVal');
  const sheardBadgeEl = document.getElementById('sheardStatusBadge');

  if (exoDemand !== null) {
    if (sheardDemEl) sheardDemEl.textContent = `+${fmt(exoDemand, 1)}Δ ${exoScope} Exo`;
    if (sheardReqEl) sheardReqEl.textContent = `${fmt(2 * exoDemand, 1)}Δ (2× demand)`;
    if (pfvReserve !== null) {
      if (sheardResEl) sheardResEl.textContent = `${fmt(pfvReserve, 1)}Δ ${exoScope} BO (PFV)`;
      const sheardPrism = (2 * exoDemand - pfvReserve) / 3;
      if (sheardPrism <= 0) {
        if (sheardPrismEl) sheardPrismEl.textContent = '0.0Δ (None needed)';
        if (sheardBadgeEl) sheardBadgeEl.innerHTML = badgeHTML('wnl', 'Meets Sheard\'s criterion');
      } else {
        const roundedPrism = Math.ceil(sheardPrism * 2) / 2;
        if (sheardPrismEl) sheardPrismEl.textContent = `${fmt(sheardPrism, 1)}Δ BI Prism (~${fmt(roundedPrism, 1)}Δ)`;
        if (sheardBadgeEl) sheardBadgeEl.innerHTML = badgeHTML('low', 'Prism indicated / Asthenopic risk');
      }
    } else {
      if (sheardResEl) sheardResEl.textContent = `Needs ${exoScope} BO reserve`;
      if (sheardPrismEl) sheardPrismEl.textContent = '—';
      if (sheardBadgeEl) sheardBadgeEl.innerHTML = badgeHTML('idle', 'Awaiting BO reserve');
    }
  } else {
    if (sheardDemEl) sheardDemEl.textContent = 'No Exophoria demand';
    if (sheardResEl) sheardResEl.textContent = '—';
    if (sheardReqEl) sheardReqEl.textContent = '—';
    if (sheardPrismEl) sheardPrismEl.textContent = 'None indicated';
    if (sheardBadgeEl) sheardBadgeEl.innerHTML = badgeHTML('idle', '—');
  }

  // 5. Scheiman & Wick Clinical Diagnostic Matcher
  evaluateScheimanClassification(acaRatio);
}

function evaluateScheimanClassification(acaRatio = null) {
  const box = document.getElementById('scheimanDiagBox');
  const tag = document.getElementById('scheimanDiagTag');
  const title = document.getElementById('scheimanDiagTitle');
  const desc = document.getElementById('scheimanDiagDesc');
  const mgmt = document.getElementById('scheimanMgmtList');
  if (!box || !tag || !title || !desc || !mgmt) return;

  const dPhoria = SCHEIMAN_STATE.s_d_phoria ?? null;
  const nPhoria = SCHEIMAN_STATE.s_n_phoria ?? null;
  const npcBreak = SCHEIMAN_STATE.s_npc_break ?? null;
  const nBoBreak = SCHEIMAN_STATE.s_n_bo_break ?? null;
  const nBoBlur = SCHEIMAN_STATE.s_n_bo_blur ?? null;
  const nBiBreak = SCHEIMAN_STATE.s_n_bi_break ?? null;
  const amp = SCHEIMAN_STATE.s_amp ?? null;
  const npa = SCHEIMAN_STATE.s_npa ?? null;
  const age = SCHEIMAN_STATE.s_age ?? null;
  const bafFail = SCHEIMAN_STATE.s_baf_fail ?? null;
  const mafFail = SCHEIMAN_STATE.s_maf_fail ?? null;
  const mem = SCHEIMAN_STATE.s_mem ?? null;
  const nra = SCHEIMAN_STATE.s_nra ?? null;
  const pra = SCHEIMAN_STATE.s_pra ?? null;

  const hasAnyClinicalData = [
    dPhoria, nPhoria, npcBreak, nBoBreak, nBoBlur, nBiBreak,
    amp, npa, bafFail, mafFail, mem, nra, pra
  ].some(v => v !== null && v !== undefined && v !== '');

  if (!hasAnyClinicalData) {
    tag.textContent = 'AWAITING CLINICAL DATA';
    title.textContent = 'Enter findings above to classify binocular and accommodative status';
    desc.textContent = 'Encode distance and near lateral phorias, NPC, fusional vergence reserves, OU AOA/NPA, and accommodative battery findings to activate the differential diagnosis engine matching Scheiman\'s Diagnostic Summary Reference.';
    mgmt.innerHTML = '';
    return;
  }

  const hofNorms = computeHofstetterNorms(age);
  const isLowAoa = hofNorms !== null && amp !== null && amp < hofNorms.aoaMin;
  const isRecededNpa = hofNorms !== null && npa !== null && hofNorms.npaMin !== null && npa > hofNorms.npaMin;
  const isLowAccommAmp = isLowAoa || isRecededNpa;

  const dExo = dPhoria !== null ? dPhoria : 0;
  const nExo = nPhoria !== null ? nPhoria : 0;
  const phoriaDiff = nExo - dExo; // Positive = more Exo at near; Negative = more Eso at near
  const acaNote = (acaRatio !== null && !isNaN(acaRatio)) ? ` Gradient AC/A is ${fmt(acaRatio, 1)}:1.` : '';

  let matched = null;

  // 1. Convergence Insufficiency (CI)
  if (phoriaDiff >= 4.0 && ((npcBreak !== null && npcBreak > 5.0) || (nBoBreak !== null && nBoBreak < 15) || (nBoBlur !== null && nBoBlur < 12) || bafFail === 'plus')) {
    const bafNote = bafFail === 'plus' && mafFail === 'pass' ? ' BAF fails plus (+) while MAF is normal, isolating a positive fusional vergence (PFV) defect.' : '';
    matched = {
      tag: 'CONVERGENCE INSUFFICIENCY (CI)',
      title: 'Convergence Insufficiency (High Evidence / CITT Protocol)',
      desc: `Patient exhibits significantly greater exophoria at near (${fmt(nExo, 1)}Δ) compared to distance (${fmt(dExo, 1)}Δ), receded NPC (${npcBreak !== null ? fmt(npcBreak, 1) + ' cm' : 'not entered'}), and deficient positive fusional vergence reserves (low BO).${acaNote}${bafNote}`,
      mgmt: [
        'Office-Based Vergence / Accommodative Therapy with home reinforcement is the primary treatment of choice (proven by the multi-center Convergence Insufficiency Treatment Trial [CITT], highest Level-1 evidence).',
        'Base-In relieving prism calculated via Sheard\'s criterion (or reading glasses with BI prism) if vision therapy is delayed or not feasible.',
        'Home-based computer vergence therapy as a secondary alternative if in-office therapy is unavailable.'
      ]
    };
  }
  // 2. Convergence Excess (CE)
  else if (phoriaDiff <= -3.0 && nExo < 0) {
    const bafNote = bafFail === 'minus' && mafFail === 'pass' ? ' BAF fails minus (-) while MAF is normal, isolating a negative fusional vergence (NFV) defect.' : '';
    matched = {
      tag: 'CONVERGENCE EXCESS (CE)',
      title: 'Convergence Excess (Near Esophoria / High AC/A Trend)',
      desc: `Patient shows clinically significant esophoria at near (${fmt(Math.abs(nExo), 1)}Δ Eso) with reduced near negative fusional vergence (BI) and elevated accommodative lag.${acaNote}${bafNote}`,
      mgmt: [
        'Added plus lenses (+1.00 D to +2.00 D reading add or PAL/bifocal) at near to relieve accommodative demand and decrease the near esophoric angle.',
        'Vergence therapy to expand Negative Fusional Vergence (Base-In reserves) at near and improve binocular accommodative facility.',
        'Base-Out prism if symptomatic at near and plus acceptance is limited.'
      ]
    };
  }
  // 3. Divergence Insufficiency (DI)
  else if (dExo <= -3.0 && phoriaDiff >= 3.0 && dExo < nExo) {
    matched = {
      tag: 'DIVERGENCE INSUFFICIENCY (DI)',
      title: 'Divergence Insufficiency (Distance Esophoria Predominance)',
      desc: `Marked esophoria at distance (${fmt(Math.abs(dExo), 1)}Δ Eso) compared to near, with deficient distance base-in (NFV) reserves. Comitant deviation.${acaNote}`,
      mgmt: [
        'Carefully verify comitance in 9 gazes and rule out cranial nerve VI paresis or systemic/neurological etiologies if recent or sudden onset.',
        'Base-Out relieving prism prescribed primarily for full-time distance wear.',
        'Vergence therapy to expand distance divergence reserves.'
      ]
    };
  }
  // 4. Divergence Excess (DE)
  else if (dExo >= 6.0 && phoriaDiff <= -4.0) {
    matched = {
      tag: 'DIVERGENCE EXCESS (DE)',
      title: 'Divergence Excess (High Distance Exophoria)',
      desc: `Distance exophoria (${fmt(dExo, 1)}Δ) is significantly greater than near phoria, with normal near point of convergence and high AC/A characteristics.${acaNote}`,
      mgmt: [
        'Office-based vision therapy to establish diplopia awareness and strong voluntary convergence.',
        'Over-minus lenses to stimulate accommodative convergence if patient is young and accommodation is robust.',
        'Relieving Base-In prism if conservative therapy is insufficient.'
      ]
    };
  }
  // 5. Basic Exophoria
  else if (dExo >= 4.0 && nExo >= 4.0 && Math.abs(phoriaDiff) < 4.0) {
    matched = {
      tag: 'BASIC EXOPHORIA',
      title: 'Basic Exophoria (Equal Distance & Near Exophoria)',
      desc: `Exophoria of similar magnitude at distance (${fmt(dExo, 1)}Δ) and near (${fmt(nExo, 1)}Δ) with normal AC/A ratio and reduced positive fusional reserves across both distances.${acaNote}`,
      mgmt: [
        'Vision therapy designed to build positive fusional vergence (BO) at both distance and near.',
        'Relieving Base-In prism (Sheard\'s demand) for full-time refractive correction if therapy is not elected.'
      ]
    };
  }
  // 6. Basic Esophoria
  else if (dExo <= -2.0 && nExo <= -2.0 && Math.abs(phoriaDiff) < 3.0) {
    matched = {
      tag: 'BASIC ESOPHORIA',
      title: 'Basic Esophoria (Equal Distance & Near Esophoria)',
      desc: `Esophoria of similar magnitude at distance and near with reduced negative fusional vergence (BI) reserves.${acaNote}`,
      mgmt: [
        'Full distance hyperopic correction determined via cycloplegic or static retinoscopy.',
        'Base-Out prism prescription for relieving prism demand.',
        'Divergence vergence therapy.'
      ]
    };
  }
  // 7. Fusional Vergence Dysfunction (FVD)
  else if (Math.abs(dExo) <= 2.0 && Math.abs(nExo) <= 3.0 &&
           (((nBoBreak !== null && nBoBreak < 15) && (nBiBreak !== null && nBiBreak < 15)) || (bafFail === 'both' && mafFail === 'pass'))) {
    matched = {
      tag: 'FUSIONAL VERGENCE DYSFUNCTION (FVD)',
      title: 'Fusional Vergence Dysfunction (Normal Alignment, Deficient Reserves & Facility)',
      desc: 'Normal distance and near phorias (orthophoria or near ortho), but reduced fusional reserves in both directions (low BO and BI), and poor binocular accommodative facility despite normal monocular facility.',
      mgmt: [
        'Office-based vision therapy is the primary definitive treatment (high success rate).',
        'Prisms and plus lenses are not indicated because phorias are ortho/normal.'
      ]
    };
  }
  // 8. Accommodative Insufficiency (AI) & Ill-Sustained Accommodation
  //    Evaluates Measured AOA (OU) [s_amp] and Measured NPA (OU) [s_npa] against Hofstetter's minimum norm
  else if (isLowAccommAmp) {
    const ampParts = [];
    if (amp !== null) ampParts.push(`OU AOA ${fmt(amp, 1)} D (min ${fmt(hofNorms.aoaMin, 1)} D)`);
    if (npa !== null) ampParts.push(`OU NPA ${fmt(npa, 1)} cm (max ${hofNorms.npaMin !== null ? fmt(hofNorms.npaMin, 1) + ' cm' : '>100 cm'})`);
    const ampSummary = ` Measured ${ampParts.join(', ')} for age ${age}.`;
    const extraFindings = [];
    if (bafFail === 'minus' && mafFail === 'minus') extraFindings.push('fails minus on both MAF and BAF');
    if (pra !== null && pra > -1.37) extraFindings.push(`low PRA (${fmt(pra, 2)} D)`);
    if (mem !== null && mem > 0.75) extraFindings.push(`high MEM lag (+${fmt(mem, 2)} D)`);
    const extraNote = extraFindings.length ? ` Corroborated by ${extraFindings.join(', ')}.` : ' Typically accompanied by failure on minus lenses during MAF/BAF, low PRA, and elevated MEM lag.';
    matched = {
      tag: 'ACCOMMODATIVE INSUFFICIENCY (AI)',
      title: 'Accommodative Insufficiency (OU Amplitude Below Hofstetter Minimum)',
      desc: `Binocular (OU) accommodative amplitude falls below Hofstetter's minimum norm.${ampSummary}${extraNote}`,
      mgmt: [
        'Near reading add (bifocal / progressive or reading glasses) to eliminate near visual strain.',
        'Accommodative vision therapy (monocular and binocular flipper techniques) to restore accommodative amplitude and facility.'
      ]
    };
  }
  else if (bafFail === 'minus' && mafFail === 'minus') {
    const hasNormalOu = hofNorms !== null && (amp !== null || npa !== null);
    const ampParts = [];
    if (amp !== null) ampParts.push(`OU AOA ${fmt(amp, 1)} D (min ${hofNorms ? fmt(hofNorms.aoaMin, 1) + ' D' : '—'})`);
    if (npa !== null) ampParts.push(`OU NPA ${fmt(npa, 1)} cm (max ${hofNorms && hofNorms.npaMin !== null ? fmt(hofNorms.npaMin, 1) + ' cm' : '—'})`);
    matched = {
      tag: hasNormalOu ? 'ILL-SUSTAINED ACCOMMODATION' : 'ACCOMMODATIVE INSUFFICIENCY / ILL-SUSTAINED',
      title: hasNormalOu
        ? 'Ill-Sustained Accommodation (Normal OU Amplitude, Fails Minus MAF & BAF)'
        : 'Suspected Accommodative Insufficiency / Ill-Sustained Accommodation',
      desc: hasNormalOu
        ? `OU accommodative amplitude meets Hofstetter's minimum norm (${ampParts.join(', ')} for age ${age}), but failure on minus lenses during both MAF and BAF indicates accommodative fatigue / ill-sustained accommodation.`
        : 'Failure on minus lenses during both MAF and BAF suggests reduced accommodative stamina. Enter Patient Age and Measured AOA (OU) / NPA (OU) to differentiate Accommodative Insufficiency from Ill-Sustained Accommodation.',
      mgmt: [
        'Accommodative vision therapy (monocular and binocular minus-lens flipper stamina protocols).',
        'Consider low near plus reading add if symptoms persist under sustained near visual demand.'
      ]
    };
  }
  // 9. Accommodative Excess (AE)
  else if ((bafFail === 'plus' && mafFail === 'plus') || (mem !== null && mem < 0.25 && nra !== null && nra < 1.50 && !isLowAccommAmp)) {
    const ouNote = (hofNorms !== null && (amp !== null || npa !== null))
      ? ` OU amplitude (${[amp !== null ? fmt(amp, 1) + ' D' : null, npa !== null ? fmt(npa, 1) + ' cm' : null].filter(Boolean).join(' / ')}) meets Hofstetter's minimum norm.`
      : '';
    matched = {
      tag: 'ACCOMMODATIVE EXCESS (AE)',
      title: 'Accommodative Excess (Accommodative Spasm / Lead)',
      desc: `Patient demonstrates difficulty relaxing accommodation, failing plus lenses on both binocular and monocular accommodative facility, with low NRA and/or lead of accommodation on MEM retinoscopy.${ouNote}`,
      mgmt: [
        'Vision therapy focused on accommodative relaxation techniques.',
        'Short-term low plus reading lens or therapeutic visual hygiene.',
        'Avoid over-minusing distance correction.'
      ]
    };
  }
  // 10. Accommodative Infacility
  else if (bafFail === 'both' && mafFail === 'both') {
    const ouNote = (hofNorms !== null && (amp !== null || npa !== null))
      ? ` OU amplitude (${[amp !== null ? fmt(amp, 1) + ' D' : null, npa !== null ? fmt(npa, 1) + ' cm' : null].filter(Boolean).join(' / ')}) meets Hofstetter's minimum norm.`
      : '';
    matched = {
      tag: 'ACCOMMODATIVE INFACILITY',
      title: 'Accommodative Infacility (Difficulty Clearing Both Plus & Minus)',
      desc: `Markedly reduced facility clearing both plus and minus lenses monocularly and binocularly, with reduced NRA and PRA.${ouNote}`,
      mgmt: [
        'Accommodative vision therapy progressing from monocular to binocular flipper techniques.',
        'Ergonomic counsel regarding frequent visual breaks (20-20-20 rule).'
      ]
    };
  }
  // 11. Normal / Balanced
  else {
    matched = {
      tag: 'BALANCED BINOCULAR FUNCTION',
      title: 'Findings Within Normal Limits / Borderline Tolerance',
      desc: `Distance phoria (${fmt(dExo, 1)}Δ) and near phoria (${fmt(nExo, 1)}Δ) are within expected Morgan normative ranges, with adequate compensating reserves.${acaNote}`,
      mgmt: [
        'Routine visual hygiene and ergonomic counsel for near computer tasks.',
        'Re-evaluate if patient reports intermittent asthenopia, diplopia, or visual fatigue.'
      ]
    };
  }

  tag.textContent = matched.tag;
  title.textContent = matched.title;
  desc.textContent = matched.desc;
  mgmt.innerHTML = matched.mgmt.map(m => `<li>${m}</li>`).join('');
}

// Scheiman Patient Presets
const PRESET_SCHEIMAN_CI = {
  s_ret4: -0.50, s_sub7a: -0.75,
  s_age: 22, s_amp: 12.0, s_npa: 8.3,
  s_d_phoria: 1.0,
  s_d_bi_blur: null, s_d_bi_break: 8, s_d_bi_rec: 5,
  s_d_bo_blur: 9, s_d_bo_break: 19, s_d_bo_rec: 10,
  s_npc_break: 11.0, s_npc_rec: 15.0,
  s_n_phoria: 10.0, s_n_phoria_plus1: 11.5,
  s_n_bi_blur: 14, s_n_bi_break: 22, s_n_bi_rec: 14,
  s_n_bo_blur: 10, s_n_bo_break: 12, s_n_bo_rec: 6,
  s_mem: 0.00,
  s_maf: 11, s_maf_fail: 'pass',
  s_baf: 3, s_baf_fail: 'plus',
  s_nra: 1.25, s_pra: -2.50
};

const PRESET_SCHEIMAN_CE = {
  s_ret4: 0.25, s_sub7a: 0.00,
  s_age: 18, s_amp: 13.5, s_npa: 7.4,
  s_d_phoria: -1.0,
  s_d_bi_blur: null, s_d_bi_break: 7, s_d_bi_rec: 4,
  s_d_bo_blur: 9, s_d_bo_break: 19, s_d_bo_rec: 10,
  s_npc_break: 3.5, s_npc_rec: 5.0,
  s_n_phoria: -7.0, s_n_phoria_plus1: 0.0,
  s_n_bi_blur: 7, s_n_bi_break: 11, s_n_bi_rec: 5,
  s_n_bo_blur: 19, s_n_bo_break: 25, s_n_bo_rec: 16,
  s_mem: 1.25,
  s_maf: 9, s_maf_fail: 'pass',
  s_baf: 2, s_baf_fail: 'minus',
  s_nra: 2.50, s_pra: -1.00
};

const PRESET_SCHEIMAN_BASIC_EXO = {
  s_ret4: -1.25, s_sub7a: -1.50,
  s_age: 26, s_amp: 11.0, s_npa: 9.1,
  s_d_phoria: 8.0,
  s_d_bi_blur: null, s_d_bi_break: 9, s_d_bi_rec: 6,
  s_d_bo_blur: 6, s_d_bo_break: 11, s_d_bo_rec: 5,
  s_npc_break: 4.5, s_npc_rec: 6.5,
  s_n_phoria: 9.0, s_n_phoria_plus1: 13.0,
  s_n_bi_blur: 13, s_n_bi_break: 21, s_n_bi_rec: 13,
  s_n_bo_blur: 11, s_n_bo_break: 14, s_n_bo_rec: 7,
  s_mem: 0.25,
  s_maf: 10, s_maf_fail: 'pass',
  s_baf: 5, s_baf_fail: 'plus',
  s_nra: 1.25, s_pra: -2.25
};

function applyScheimanPatient(preset) {
  // Dedicated Patient Age input
  const ageVal = preset.s_age ?? null;
  SCHEIMAN_STATE.s_age = ageVal;
  const ageEl = document.getElementById('scheimanAgeInput');
  if (ageEl) ageEl.value = ageVal === null ? '' : ageVal;

  SCHEIMAN_FIELDS.forEach(f => {
    const val = preset[f.id] ?? null;
    SCHEIMAN_STATE[f.id] = val;
    if (f.kind === 'phoria') {
      const el = document.querySelector(`[data-scheiman-signed="${f.id}"]`);
      if (el) el.value = val === null ? '' : val;
      updateScheimanPhoriaPreview(f.id, val);
    } else if (f.kind === 'select') {
      const el = document.querySelector(`[data-scheiman-select="${f.id}"]`);
      if (el) el.value = val === null ? '' : val;
    } else {
      const el = document.querySelector(`[data-scheiman-num="${f.id}"]`);
      if (el) el.value = val === null ? '' : (f.signedDiopter ? formatSignedDiopter(val) : val);
    }
  });

  evaluateScheiman();
}

function clearScheimanPatient() {
  // Dedicated Patient Age input
  SCHEIMAN_STATE.s_age = null;
  const ageEl = document.getElementById('scheimanAgeInput');
  if (ageEl) ageEl.value = '';

  SCHEIMAN_FIELDS.forEach(f => {
    SCHEIMAN_STATE[f.id] = null;
    if (f.kind === 'phoria') {
      const el = document.querySelector(`[data-scheiman-signed="${f.id}"]`);
      if (el) el.value = '';
      updateScheimanPhoriaPreview(f.id, null);
    } else if (f.kind === 'select') {
      const el = document.querySelector(`[data-scheiman-select="${f.id}"]`);
      if (el) el.value = '';
    } else {
      const el = document.querySelector(`[data-scheiman-num="${f.id}"]`);
      if (el) el.value = '';
    }
  });

  evaluateScheiman();
}

// Initialize Scheiman tables and controls
renderScheimanTables();
evaluateScheiman();

const btnScheimanCI = document.getElementById('btnScheimanCI');
const btnScheimanCE = document.getElementById('btnScheimanCE');
const btnScheimanExo = document.getElementById('btnScheimanExo');
const btnScheimanReset = document.getElementById('btnScheimanReset');

if (btnScheimanCI) btnScheimanCI.addEventListener('click', () => applyScheimanPatient(PRESET_SCHEIMAN_CI));
if (btnScheimanCE) btnScheimanCE.addEventListener('click', () => applyScheimanPatient(PRESET_SCHEIMAN_CE));
if (btnScheimanExo) btnScheimanExo.addEventListener('click', () => applyScheimanPatient(PRESET_SCHEIMAN_BASIC_EXO));
if (btnScheimanReset) btnScheimanReset.addEventListener('click', clearScheimanPatient);

