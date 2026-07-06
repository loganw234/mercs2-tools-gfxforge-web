
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
  });
  for (const it of state.items) {
    if (it.hidden) continue;
    if (it.kind === 'rect') {
      m.rect(it.x, it.y, it.w, it.h, it.fill, { radius: it.radius || 0, stroke: it.stroke || null });
    } else if (it.kind === 'text') {
      m.text(it.x, it.y, it.text, { size: it.size, color: it.color, varName: it.varName || null, width: it.w });
    } else if (it.kind === 'button') {
      m.button(it.x, it.y, it.w, it.h, it.event, {
        arg: it.arg, fill: it.fill, hover: it.hover,
        label: it.label || null, labelColor: it.labelColor, labelSize: it.labelSize,
        radius: it.radius || 0, stroke: it.stroke || null,
      });
    } else if (it.kind === 'clip') {
      m.clip(it.name, it.x, it.y, it.w, it.h, it.color, { radius: it.radius || 0, stroke: it.stroke || null });
    } else if (it.kind === 'image') {
      if (!it.__imageData) {
        throw new Error(`image at (${Math.round(it.x)},${Math.round(it.y)}) hasn't finished loading yet — wait a moment and try again`);
      }
      m.image(it.x, it.y, it.w, it.h, it.__imageData);
    }
  }
  if (state.script && state.script.trim()) {
    m.script(Compiler.compileSource(state.script));
  }
  return m;
}
