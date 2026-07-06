
// -- small DOM helpers ---------------------------------------------------------

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  });
  children.forEach(c => e.appendChild(c));
  return e;
}

function labeled(text, input) {
  return el('label', { class: 'field' }, [document.createTextNode(text), input]);
}

function bindLive(input, evtName, applyFn) {
  input.addEventListener('focus', () => pushHistory());
  input.addEventListener(evtName, () => { applyFn(input); render(); syncPropertyValues(); });
}

function numberField(labelText, id, value, apply, opts = {}) {
  const input = el('input', { type: 'number', id, value: round1(value) });
  if (opts.step) input.step = opts.step;
  if (opts.min !== undefined) input.min = opts.min;
  bindLive(input, 'input', (i) => apply(parseFloat(i.value) || 0));
  return labeled(labelText, input);
}

function textField(labelText, id, value, apply) {
  const input = el('input', { type: 'text', id, value: value ?? '' });
  bindLive(input, 'input', (i) => apply(i.value));
  return labeled(labelText, input);
}

function colorField(labelText, id, rgba, applyRgb, applyAlpha) {
  const swatch = el('input', { type: 'color', id, value: toHex(rgba) });
  bindLive(swatch, 'input', (i) => applyRgb(hexToRgb(i.value, rgba[3] !== undefined ? rgba[3] : 255)));
  const alpha = el('input', { type: 'number', id: id + '-a', value: rgba[3] !== undefined ? rgba[3] : 255, min: 0, max: 255, title: 'alpha (0-255)' });
  bindLive(alpha, 'input', (i) => applyAlpha(clampByte(i.value)));
  const row = el('div', { class: 'color-field' }, [swatch, alpha, el('span', { class: 'hex-chip', text: 'alpha' })]);
  return el('div', { class: 'field' }, [el('span', { style: 'font-size:11px;color:var(--text-dim)', text: labelText }), row]);
}

function checkboxField(labelText, id, checked, apply) {
  const input = el('input', { type: 'checkbox', id });
  input.checked = checked;
  input.addEventListener('change', () => { pushHistory(); apply(input.checked); render(); renderProperties(); });
  return el('label', { class: 'check-row' }, [input, document.createTextNode(labelText)]);
}

function sectionTitle(text) {
  return el('div', { class: 'panel-title', text });
}

function actionRow(it) {
  return el('div', { class: 'field-row' }, [
    el('button', { class: 'ghost', text: '⧉ Duplicate', onclick: duplicateSelected }),
    el('button', { class: 'ghost', text: '✕ Delete', onclick: deleteSelected }),
  ]);
}

function buildDpad() {
  const step = state.gridSize || 10;
  const dirBtn = (label, dx, dy, title) => el('button', {
    class: 'ghost', text: label, title,
    onclick: () => nudgeSelected(dx * step, dy * step),
  });
  const grid = el('div', { class: 'dpad' }, [
    el('div'),
    dirBtn('▲', 0, -1, `Nudge up ${step}px`),
    el('div'),
    dirBtn('◀', -1, 0, `Nudge left ${step}px`),
    el('div', { class: 'dpad-center', text: step + 'px' }),
    dirBtn('▶', 1, 0, `Nudge right ${step}px`),
    el('div'),
    dirBtn('▼', 0, 1, `Nudge down ${step}px`),
    el('div'),
  ]);
  return el('div', { class: 'field' }, [
    document.createTextNode('Nudge (grid step — change "grid" in the tool rail)'),
    grid,
  ]);
}

// -- fill (solid/gradient), stroke, and radius editors -------------------------
//
// Shared by rect/button(fill+hover)/clip panels. `onReplace(newFill)` swaps
// the whole fill value and triggers a full panel rebuild (renderProperties)
// since switching solid<->gradient or adding/removing a stop changes which
// DOM fields exist. Editing a single existing stop's own color/ratio is a
// lighter live-update (mutate in place + render()) so it doesn't lose focus
// mid-edit, same pattern as everywhere else in this panel.

function isGradient(fill) {
  return fill && typeof fill === 'object' && !Array.isArray(fill);
}

function defaultGradientFor(baseColor) {
  return {
    type: 'linear', direction: 'vertical',
    stops: [{ ratio: 0, color: lighten(baseColor, 30) }, { ratio: 255, color: lighten(baseColor, -30) }],
  };
}

function buildFillEditor(labelText, fill, onReplace) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('span', { style: 'font-size:11px;color:var(--text-dim)', text: labelText }));

  const typeSelect = el('select');
  // Gradients are TEMPORARILY DISABLED: GFx 2.x renders gradients only as
  // external assets (DefineExternalGradient / tag 1003), so the inline SWF
  // gradient fill this codec emits shows as a flat fallback in-engine. The codec
  // and canvas preview still support gradients (so old projects load fine); we
  // just don't offer them as a new choice. Restore the ['linear',…]/['radial',…]
  // options here once an external-gradient path exists.
  [['solid', 'Solid']].forEach(([val, label]) => {
    const opt = el('option', { value: val, text: label });
    if ((isGradient(fill) ? fill.type : 'solid') === val) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener('change', () => {
    pushHistory();
    const newType = typeSelect.value;
    if (newType === 'solid') {
      onReplace(isGradient(fill) ? fill.stops[0].color.slice() : fill.slice());
    } else {
      const base = isGradient(fill) ? fill.stops[0].color : fill;
      const grad = isGradient(fill) ? { ...fill, type: newType } : defaultGradientFor(base);
      grad.type = newType;
      onReplace(grad);
    }
  });
  wrap.appendChild(typeSelect);

  if (!isGradient(fill)) {
    wrap.appendChild(colorField(labelText + ' colour', 'fill-solid', fill,
      rgb => { fill[0] = rgb[0]; fill[1] = rgb[1]; fill[2] = rgb[2]; },
      a => { fill[3] = a; }));
    return wrap;
  }

  if (fill.type === 'linear') {
    const dirSelect = el('select');
    [['horizontal', 'Horizontal (left → right)'], ['vertical', 'Vertical (top → bottom)']].forEach(([val, label]) => {
      const opt = el('option', { value: val, text: label });
      if ((fill.direction || 'horizontal') === val) opt.selected = true;
      dirSelect.appendChild(opt);
    });
    dirSelect.addEventListener('change', () => { pushHistory(); fill.direction = dirSelect.value; render(); });
    wrap.appendChild(el('label', { class: 'field' }, [document.createTextNode('Direction'), dirSelect]));
  }

  fill.stops.forEach((stop, i) => {
    const row = el('div', { style: 'display:flex;align-items:flex-end;gap:6px;padding:6px;border:1px solid var(--border-soft);border-radius:5px;background:var(--panel-2);margin-top:4px;' });
    const ratioInput = el('input', { type: 'number', min: 0, max: 100, value: Math.round(stop.ratio / 255 * 100), style: 'width:56px;' });
    bindLive(ratioInput, 'input', (i2) => { stop.ratio = Math.max(0, Math.min(255, Math.round((parseFloat(i2.value) || 0) / 100 * 255))); });
    const swatch = el('input', { type: 'color', value: toHex(stop.color) });
    bindLive(swatch, 'input', (i2) => { const rgb = hexToRgb(i2.value, stop.color[3] ?? 255); stop.color[0] = rgb[0]; stop.color[1] = rgb[1]; stop.color[2] = rgb[2]; });
    const removeBtn = el('button', {
      class: 'ghost', text: '✕', title: 'Remove this stop',
      onclick: () => {
        if (fill.stops.length <= 1) { showToast('A gradient needs at least one stop', 'error'); return; }
        pushHistory();
        fill.stops.splice(i, 1);
        renderProperties();
      },
    });
    row.appendChild(labeled('stop %', ratioInput));
    row.appendChild(labeled('colour', swatch));
    row.appendChild(removeBtn);
    wrap.appendChild(row);
  });
  wrap.appendChild(el('button', {
    class: 'ghost', text: '+ Add stop', style: 'margin-top:4px;',
    onclick: () => {
      pushHistory();
      const last = fill.stops[fill.stops.length - 1];
      fill.stops.push({ ratio: Math.min(255, (last ? last.ratio : 0) + 40), color: (last ? last.color : [255, 255, 255, 255]).slice() });
      renderProperties();
    },
  }));
  return wrap;
}

function buildStrokeEditor(it) {
  const wrap = el('div', { class: 'field' });
  const has = !!it.stroke;
  wrap.appendChild(checkboxField('Has stroke / border', 'prop-hasstroke', has, v => {
    it.stroke = v ? { width: 1, color: [255, 255, 255, 255] } : null;
  }));
  if (it.stroke) {
    wrap.appendChild(el('div', { class: 'field-row' }, [
      numberField('Width (px)', 'prop-strokew', it.stroke.width, v => { it.stroke.width = Math.max(0.5, v); }, { min: 0.5, step: 0.5 }),
    ]));
    wrap.appendChild(colorField('Stroke colour', 'prop-strokecolor', it.stroke.color,
      rgb => { it.stroke.color = [rgb[0], rgb[1], rgb[2], it.stroke.color[3]]; },
      a => { it.stroke.color[3] = a; }));
  }
  return wrap;
}

function buildRadiusField(it) {
  return numberField('Corner radius (px)', 'prop-radius', it.radius || 0, v => { it.radius = Math.max(0, v); }, { min: 0 });
}

// -- properties panel ----------------------------------------------------------

function renderProperties() {
  if (typeof updateLuaSelectionHighlight === 'function') updateLuaSelectionHighlight();
  const root = document.getElementById('tab-props');
  root.innerHTML = '';
  if (state.mode === 'play') {
    root.appendChild(el('div', { class: 'empty-hint', text: '▶ Playing — editing is paused. Use the Play tab to click buttons and call functions, or press Esc / ⏹ Stop to go back to editing.' }));
    return;
  }
  if (state.selectedIds.size > 1) {
    root.appendChild(buildMultiSelectPanel());
    syncLockButtons();
    return;
  }
  const sel = getSelected();
  root.appendChild(sel ? buildItemPanel(sel) : buildStagePanel());
  syncLockButtons();
}

function buildMultiSelectPanel() {
  const frag = document.createDocumentFragment();
  const multi = getMultiSelection();
  frag.appendChild(sectionTitle(`${multi.length} items selected`));
  frag.appendChild(el('div', { class: 'field-row' }, [
    el('button', { class: 'ghost', text: '⧉ Duplicate all', onclick: duplicateSelected }),
    el('button', { class: 'ghost', text: '✕ Delete all', onclick: deleteSelected }),
  ]));

  frag.appendChild(sectionTitle('Align'));
  const alignRow1 = el('div', { class: 'field-row' }, [
    el('button', { class: 'ghost', text: '⊢ Left', onclick: () => alignSelection('left') }),
    el('button', { class: 'ghost', text: '↔ Center', onclick: () => alignSelection('center-h') }),
    el('button', { class: 'ghost', text: '⊣ Right', onclick: () => alignSelection('right') }),
  ]);
  const alignRow2 = el('div', { class: 'field-row' }, [
    el('button', { class: 'ghost', text: '⊤ Top', onclick: () => alignSelection('top') }),
    el('button', { class: 'ghost', text: '↕ Middle', onclick: () => alignSelection('middle-v') }),
    el('button', { class: 'ghost', text: '⊥ Bottom', onclick: () => alignSelection('bottom') }),
  ]);
  frag.appendChild(alignRow1);
  frag.appendChild(alignRow2);

  frag.appendChild(sectionTitle('Distribute (3+ items)'));
  const distRow = el('div', { class: 'field-row' });
  const distH = el('button', { class: 'ghost', text: '⇔ Horizontally', onclick: () => distributeSelection('horizontal') });
  const distV = el('button', { class: 'ghost', text: '⇕ Vertically', onclick: () => distributeSelection('vertical') });
  if (multi.length < 3) { distH.disabled = true; distV.disabled = true; distH.title = distV.title = 'Needs at least 3 selected items'; }
  distRow.appendChild(distH); distRow.appendChild(distV);
  frag.appendChild(distRow);

  frag.appendChild(sectionTitle('Bulk'));
  frag.appendChild(el('div', { class: 'field-row' }, [
    el('button', { class: 'ghost', text: '◎ Toggle hidden', onclick: () => bulkToggle('hidden') }),
    el('button', { class: 'ghost', text: '🔒 Toggle pos lock', onclick: () => bulkToggle('posLocked') }),
  ]));

  frag.appendChild(el('p', { class: 'small-note', text: 'Shift-click (or enable "Multi-select" in the tool rail, for touch) to add items to a selection, or drag a box over empty stage space to select everything it touches.' }));

  const wrap = el('div');
  wrap.appendChild(frag);
  return wrap;
}

function syncPropertyValues() {
  const map = { 'prop-x': 'x', 'prop-y': 'y', 'prop-w': 'w', 'prop-h': 'h' };
  const sel = getSelected();
  if (!sel) return;
  for (const [id, key] of Object.entries(map)) {
    const input = document.getElementById(id);
    if (input && document.activeElement !== input) {
      const v = key === 'h' ? itemBounds(sel).h : sel[key];
      if (v !== undefined) input.value = round1(v);
    }
  }
}

function buildStagePanel() {
  const frag = document.createDocumentFragment();
  frag.appendChild(sectionTitle('Stage'));
  frag.appendChild(textField('Movie / asset name', 'stage-name', state.stage.name, v => { state.stage.name = v || 'movie'; }));
  frag.appendChild(el('div', { class: 'field-row' }, [
    numberField('Width (px)', 'stage-w', state.stage.width, v => { state.stage.width = Math.max(1, Math.round(v)); render(); }, { min: 1 }),
    numberField('Height (px)', 'stage-h', state.stage.height, v => { state.stage.height = Math.max(1, Math.round(v)); render(); }, { min: 1 }),
  ]));
  frag.appendChild(numberField('Frame rate (fps)', 'stage-fps', state.stage.fps, v => { state.stage.fps = v; }, { min: 1 }));
  frag.appendChild(colorField('Background', 'stage-bg', state.stage.background,
    rgb => { state.stage.background = [rgb[0], rgb[1], rgb[2], state.stage.background[3]]; },
    a => { state.stage.background[3] = a; }));
  frag.appendChild(sectionTitle('Host font (imported, not embedded)'));
  frag.appendChild(textField('Font export name', 'stage-fontname', state.stage.fontName, v => { state.stage.fontName = v; }));
  frag.appendChild(textField('Font SWF url', 'stage-fonturl', state.stage.fontUrl, v => { state.stage.fontUrl = v; }));
  frag.appendChild(sectionTitle('New shape colours'));
  frag.appendChild(colorField('Fill (rect / button / clip)', 'cur-fill', state.currentFill,
    rgb => { state.currentFill = [rgb[0], rgb[1], rgb[2], state.currentFill[3]]; },
    a => { state.currentFill[3] = a; }));
  frag.appendChild(colorField('Text colour', 'cur-text', state.currentTextColor,
    rgb => { state.currentTextColor = [rgb[0], rgb[1], rgb[2], state.currentTextColor[3]]; },
    a => { state.currentTextColor[3] = a; }));
  frag.appendChild(el('p', { class: 'small-note', text: 'Nothing selected. Pick a tool above and click (or drag) on the stage to place an element. Click an existing element to edit it here.' }));
  const wrap = el('div');
  wrap.appendChild(frag);
  return wrap;
}

function buildItemPanel(it) {
  const frag = document.createDocumentFragment();
  const titles = { rect: 'Rectangle', text: 'Text field', button: 'Button', clip: 'Movie clip', image: 'Image' };
  frag.appendChild(sectionTitle(titles[it.kind] || it.kind));
  frag.appendChild(actionRow(it));
  frag.appendChild(checkboxField('Hidden (kept in project, skipped on export)', 'prop-hidden', !!it.hidden, v => { it.hidden = v; }));
  frag.appendChild(el('div', { class: 'field-row' }, [
    checkboxField('Lock position', 'prop-lockpos', !!it.posLocked, v => { it.posLocked = v; }),
    checkboxField('Lock size', 'prop-locksize', !!it.sizeLocked, v => { it.sizeLocked = v; }),
  ]));
  frag.appendChild(el('p', { class: 'small-note', text: 'Locking hides/disables the thing you locked when dragging on the stage, so small items are easy to nudge without accidentally resizing (or vice versa). The d-pad and typed X/Y below still work either way.' }));

  frag.appendChild(el('div', { class: 'field-row' }, [
    numberField('X', 'prop-x', it.x, v => { it.x = v; }),
    numberField('Y', 'prop-y', it.y, v => { it.y = v; }),
  ]));
  frag.appendChild(buildDpad());

  if (it.kind === 'rect' || it.kind === 'button' || it.kind === 'clip' || it.kind === 'image') {
    frag.appendChild(el('div', { class: 'field-row' }, [
      numberField('Width', 'prop-w', it.w, v => { it.w = Math.max(1, v); }, { min: 1 }),
      numberField('Height', 'prop-h', it.h, v => { it.h = Math.max(1, v); }, { min: 1 }),
    ]));
  } else if (it.kind === 'text') {
    frag.appendChild(numberField('Box width', 'prop-w', it.w, v => { it.w = Math.max(8, v); }, { min: 8 }));
  }

  if (it.kind === 'rect') {
    frag.appendChild(buildFillEditor('Fill', it.fill, (newFill) => { it.fill = newFill; renderProperties(); render(); }));
    frag.appendChild(buildRadiusField(it));
    frag.appendChild(buildStrokeEditor(it));
  }

  if (it.kind === 'text') {
    frag.appendChild(el('label', { class: 'field' }, [
      document.createTextNode('Text'),
      (() => {
        const ta = el('textarea', { rows: 2, style: 'min-height:44px;resize:vertical;' });
        ta.value = it.text;
        bindLive(ta, 'input', (i) => { it.text = i.value; });
        return ta;
      })(),
    ]));
    frag.appendChild(numberField('Size (px)', 'prop-size', it.size, v => { it.size = Math.max(4, v); }, { min: 4 }));
    frag.appendChild(colorField('Colour', 'prop-color', it.color,
      rgb => { it.color = [rgb[0], rgb[1], rgb[2], it.color[3]]; },
      a => { it.color[3] = a; }));
    frag.appendChild(textField('Bound variable (optional — live readout)', 'prop-var', it.varName, v => { it.varName = v; }));
    frag.appendChild(el('p', { class: 'small-note', text: 'Set a variable name to make this a live field the host / your script updates at runtime (e.g. "hp_val"). Leave blank for static text.' }));
  }

  if (it.kind === 'button') {
    frag.appendChild(textField('fscommand event name', 'prop-event', it.event, v => { it.event = v || 'click'; }));
    frag.appendChild(textField('Argument (optional, sent with the event)', 'prop-arg', it.arg === null || it.arg === undefined ? '' : String(it.arg),
      v => { it.arg = v === '' ? null : (isNaN(Number(v)) ? v : Number(v)); }));
    frag.appendChild(buildFillEditor('Fill', it.fill, (newFill) => { it.fill = newFill; renderProperties(); render(); }));
    frag.appendChild(buildRadiusField(it));
    frag.appendChild(buildStrokeEditor(it));
    frag.appendChild(checkboxField('Has hover / down state', 'prop-hashover', it.hover !== null, v => {
      it.hover = v ? lighten(Array.isArray(it.fill) ? it.fill : it.fill.stops[0].color, 22) : null;
    }));
    if (it.hover !== null) {
      frag.appendChild(buildFillEditor('Hover / down', it.hover, (newFill) => { it.hover = newFill; renderProperties(); render(); }));
    }
    const labelInput = el('input', { type: 'text', id: 'prop-label', value: it.label ?? '' });
    labelInput.addEventListener('focus', () => pushHistory());
    labelInput.addEventListener('input', () => { it.label = labelInput.value; render(); });
    labelInput.addEventListener('blur', () => renderProperties());
    frag.appendChild(labeled('Label (blank = no label)', labelInput));
    if (it.label) {
      frag.appendChild(numberField('Label size', 'prop-labelsize', it.labelSize, v => { it.labelSize = Math.max(4, v); }, { min: 4 }));
      frag.appendChild(colorField('Label colour', 'prop-labelcolor', it.labelColor,
        rgb => { it.labelColor = [rgb[0], rgb[1], rgb[2], it.labelColor[3]]; },
        a => { it.labelColor[3] = a; }));
    }
  }

  if (it.kind === 'clip') {
    const nameInput = el('input', { type: 'text', id: 'prop-name', value: it.name });
    nameInput.addEventListener('focus', () => pushHistory());
    nameInput.addEventListener('input', () => { it.name = nameInput.value; render(); renderLayers(); });
    nameInput.addEventListener('blur', () => {
      const resolved = it.name ? uniqueClipNameExcluding(it.name, it.id) : it.name;
      if (resolved !== it.name) { it.name = resolved; nameInput.value = resolved; }
      renderLayers();
    });
    frag.appendChild(labeled('Instance name (script-addressable)', nameInput));
    frag.appendChild(buildFillEditor('Colour', it.color, (newFill) => { it.color = newFill; renderProperties(); render(); }));
    frag.appendChild(buildRadiusField(it));
    frag.appendChild(buildStrokeEditor(it));
    frag.appendChild(el('p', { class: 'small-note', text: 'A named MovieClip — the only thing your host/script can move, scale, or hide by name at runtime (e.g. a health bar via _xscale).' }));
  }

  if (it.kind === 'image') {
    frag.appendChild(el('p', { class: 'small-note', text: `Source image: ${it.naturalWidth || '?'}×${it.naturalHeight || '?'}px. Width/height above stretch it independently — hold nothing special to keep it proportional, just match the ratio manually if you want that.` }));
    frag.appendChild(el('button', {
      class: 'ghost', text: '⤒ Replace image…',
      onclick: () => { pendingImagePoint = { x: Math.round(it.x), y: Math.round(it.y) }; pendingReplaceId = it.id; document.getElementById('imageFileInput').click(); },
    }));
    frag.appendChild(el('p', { class: 'small-note', text: 'Embedded losslessly (no recompression) as a DefineBitsLossless2 bitmap. This is the newest, least battle-tested part of the exporter — worth a quick in-engine check before you rely on it for real assets. See the Format reference for details.' }));
  }

  const wrap = el('div');
  wrap.appendChild(frag);
  return wrap;
}

function uniqueClipNameExcluding(base, excludeId) {
  const used = new Set(state.items.filter(i => i.kind === 'clip' && i.id !== excludeId).map(i => i.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(base + n)) n++;
  return base + n;
}
