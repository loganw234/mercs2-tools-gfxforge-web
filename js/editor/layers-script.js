
// -- frames bar -------------------------------------------------------------------
//
// A movie with no declared frames is a single unlabelled frame, and the bar
// collapses to a single "add frames" affordance so nothing changes for the
// single-frame projects that are still the common case.

function renderFramesBar() {
  const bar = document.getElementById('framesBar');
  if (!bar) return;
  bar.innerHTML = '';
  const frames = state.stage.frames || [];

  if (!frames.length) {
    const hint = el('button', {
      class: 'mini-btn', id: 'btnAddFirstFrame',
      title: 'Split this movie into named timeline frames, so script can gotoAndStop("name")',
      text: '+ Add timeline frames',
    });
    hint.addEventListener('click', () => {
      pushHistory();
      // Frame 0 holds everything that already exists; frame 1 starts empty.
      state.stage.frames = ['frame1', 'frame2'];
      state.currentFrame = 0;
      afterStructuralChange();
    });
    bar.appendChild(hint);
    return;
  }

  bar.appendChild(el('span', { class: 'frames-label', text: 'Frames' }));
  frames.forEach((label, i) => {
    const chip = el('button', {
      class: 'frame-chip' + (i === state.currentFrame ? ' active' : ''),
      title: 'Show frame ' + (i + 1) + (label ? ' ("' + label + '")' : '') + ' — double-click to rename',
      text: (i + 1) + (label ? ' · ' + label : ''),
    });
    chip.addEventListener('click', () => {
      state.currentFrame = i;
      render(); renderFramesBar(); renderProperties(); renderLayers();
    });
    chip.addEventListener('dblclick', () => {
      const next = prompt('Frame label (script uses this with gotoAndStop):', label || '');
      if (next === null) return;
      pushHistory();
      state.stage.frames[i] = next.trim();
      afterStructuralChange();
    });
    bar.appendChild(chip);
  });

  const add = el('button', { class: 'mini-btn', title: 'Add a frame at the end', text: '+' });
  add.addEventListener('click', () => {
    pushHistory();
    state.stage.frames.push('frame' + (state.stage.frames.length + 1));
    state.currentFrame = state.stage.frames.length - 1;
    afterStructuralChange();
  });
  bar.appendChild(add);

  const del = el('button', {
    class: 'mini-btn', title: 'Delete the current frame', text: '✕',
  });
  del.addEventListener('click', () => {
    const frames = state.stage.frames;
    if (frames.length <= 1) {
      // Dropping to zero frames means "back to a plain single-frame movie",
      // so clear every item's now-meaningless frame membership too.
      pushHistory();
      state.stage.frames = [];
      for (const it of state.items) it.frames = null;
      state.currentFrame = 0;
      afterStructuralChange();
      return;
    }
    const gone = state.currentFrame;
    pushHistory();
    frames.splice(gone, 1);
    // Re-index membership around the removed frame: anything pinned only to it
    // becomes "every frame" rather than silently disappearing.
    for (const it of state.items) {
      if (!it.frames) continue;
      const next = it.frames.filter(f => f !== gone).map(f => (f > gone ? f - 1 : f));
      it.frames = next.length ? next : null;
    }
    state.currentFrame = Math.min(gone, frames.length - 1);
    afterStructuralChange();
  });
  bar.appendChild(del);
  bar.appendChild(el('span', {
    class: 'small-note frames-note',
    text: 'Dimmed items live on other frames. Script: gotoAndStop("label").',
  }));
}

// -- layers panel ---------------------------------------------------------------

function itemSummary(it) {
  if (it.kind === 'rect') return `Rect ${Math.round(it.w)}×${Math.round(it.h)}`;
  if (it.kind === 'text') return `Text: ${it.text.slice(0, 22) || '(empty)'}`;
  if (it.kind === 'button') return `Button: ${it.label || it.event}`;
  if (it.kind === 'clip') return `Clip: ${it.name}`;
  if (it.kind === 'image') return `Image ${it.naturalWidth || '?'}×${it.naturalHeight || '?'}`;
  return it.kind;
}

function renderLayers() {
  const list = document.getElementById('layerList');
  list.innerHTML = '';
  if (!state.items.length) {
    list.appendChild(el('div', { class: 'empty-hint', text: 'No layers yet. Add shapes from the tool rail — they will show up here in stacking order.' }));
    return;
  }
  // topmost (last in items[], paints last / on top) shown first in the list
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    const row = el('div', {
      class: 'layer-row' + (state.selectedIds.has(it.id) ? ' selected' : ''),
      draggable: 'true',
    });
    row.dataset.index = i;
    row.appendChild(el('span', { class: 'kind-badge', text: it.kind }));
    row.appendChild(el('span', { class: 'label', text: itemSummary(it), style: it.hidden ? 'opacity:.4;text-decoration:line-through;' : '' }));
    const upBtn = el('button', { class: 'mini-btn', title: 'Move up (forward)', text: '▲' });
    const downBtn = el('button', { class: 'mini-btn', title: 'Move down (backward)', text: '▼' });
    const hideBtn = el('button', { class: 'mini-btn', title: it.hidden ? 'Show' : 'Hide', text: it.hidden ? '⚿' : '◎' });
    const delBtn = el('button', { class: 'mini-btn', title: 'Delete', text: '✕' });
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveItem(i, 1); });
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveItem(i, -1); });
    hideBtn.addEventListener('click', (e) => { e.stopPropagation(); pushHistory(); it.hidden = !it.hidden; render(); renderLayers(); });
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation(); pushHistory();
      state.items = state.items.filter(x => x.id !== it.id);
      state.selectedIds.delete(it.id);
      afterStructuralChange();
    });
    row.appendChild(upBtn); row.appendChild(downBtn); row.appendChild(hideBtn); row.appendChild(delBtn);
    row.addEventListener('click', (e) => {
      if (e.shiftKey || state.multiSelectMode) toggleSelection(it.id); else selectOnly(it.id);
      renderProperties(); renderLayers(); render();
    });
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const to = i;
      if (from === to || isNaN(from)) return;
      pushHistory();
      const [moved] = state.items.splice(from, 1);
      state.items.splice(from < to ? to : to, 0, moved);
      afterStructuralChange();
    });
    list.appendChild(row);
  }
}

function moveItem(index, dir) {
  const to = index + dir;
  if (to < 0 || to >= state.items.length) return;
  pushHistory();
  const [moved] = state.items.splice(index, 1);
  state.items.splice(to, 0, moved);
  afterStructuralChange();
}

// -- script panel ---------------------------------------------------------------

function wireScriptPanel() {
  const ta = document.getElementById('scriptText');
  ta.value = state.script;
  ta.addEventListener('focus', () => pushHistory());
  ta.addEventListener('input', () => { state.script = ta.value; });
  document.getElementById('btnCompileCheck').addEventListener('click', runCompileCheck);
}

function runCompileCheck() {
  const box = document.getElementById('scriptResult');
  box.style.display = 'block';
  try {
    const movie = buildMovieFromState({ ignoreScriptErrors: false });
    const summary = Verify.verifyMovie(movie);
    box.className = 'script-result ok';
    const fnList = summary.functions.length ? summary.functions.join(', ') : '(none)';
    box.textContent = `OK — ${summary.bytes} bytes.\nFunctions defined: ${fnList}\nTags: ${JSON.stringify(summary.tags)}`;
  } catch (e) {
    box.className = 'script-result err';
    box.textContent = `${e.constructor.name}: ${e.message}`;
  }
}

// -- movie building --------------------------------------------------------------

function buildMovieFromState() {
  const st = state.stage;
  const m = new GFMovie.Movie(st.width, st.height, {
    fps: st.fps, name: st.name, background: st.background,
    fontName: st.fontName, fontUrl: st.fontUrl,
    frames: (st.frames && st.frames.length) ? st.frames : null,
  });
  // Placement extras every kind shares. `frames: null` means "on every frame",
  // which is what an item gets until it is explicitly assigned to some.
  const common = (it) => ({ frames: it.frames || null, alpha: it.alpha ?? null });
  for (const it of state.items) {
    if (it.hidden) continue;
    if (it.kind === 'rect') {
      m.rect(it.x, it.y, it.w, it.h, it.fill, {
        radius: it.radius || 0, stroke: it.stroke || null, ...common(it),
      });
    } else if (it.kind === 'text') {
      m.text(it.x, it.y, it.text, {
        size: it.size, color: it.color, varName: it.varName || null, width: it.w,
        height: it.height ?? null, ...common(it), ...(it.textOptions || {}),
      });
    } else if (it.kind === 'button') {
      m.button(it.x, it.y, it.w, it.h, it.event, {
        arg: it.arg, fill: it.fill, hover: it.hover,
        label: it.label || null, labelColor: it.labelColor, labelSize: it.labelSize,
        radius: it.radius || 0, stroke: it.stroke || null, frames: it.frames || null,
      });
    } else if (it.kind === 'clip') {
      m.clip(it.name, it.x, it.y, it.w, it.h, it.color, {
        radius: it.radius || 0, stroke: it.stroke || null,
        events: it.events || null, scale9: it.scale9 || null, ...common(it),
      });
    } else if (it.kind === 'image') {
      if (!it.__imageData) {
        throw new Error(`image at (${Math.round(it.x)},${Math.round(it.y)}) hasn't finished loading yet — wait a moment and try again`);
      }
      m.image(it.x, it.y, it.w, it.h, it.__imageData, common(it));
    } else {
      continue;
    }
    // exportAs applies to whatever was just added, so it has to follow it.
    if (it.exportAs) m.exportAs(it.exportAs);
  }
  if (state.script && state.script.trim()) {
    m.script(Compiler.compileSource(state.script));
  }
  return m;
}
