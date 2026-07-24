
// -- toasts -----------------------------------------------------------------

function showToast(message, type) {
  const c = document.getElementById('toastContainer');
  const t = el('div', { class: 'toast' + (type ? ' ' + type : ''), text: message });
  c.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .2s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 4000);
}

// -- modals -------------------------------------------------------------------

function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function closeAllModals() {
  document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
}

// -- status bar ---------------------------------------------------------------

function updateStatusBar() {
  document.getElementById('statStage').textContent = `stage ${state.stage.width}×${state.stage.height} · "${state.stage.name}" · ${state.stage.fps}fps`;
  document.getElementById('statItems').textContent = `${state.items.length} item${state.items.length === 1 ? '' : 's'}`;
  let selText = 'nothing selected';
  if (state.selectedIds.size > 1) {
    selText = `${state.selectedIds.size} items selected`;
  } else {
    const sel = getSelected();
    if (sel) selText = `selected: ${sel.kind} (${Math.round(sel.x)},${Math.round(sel.y)})`;
  }
  document.getElementById('statSel').textContent = selText;
}

function updateCursorStatus(mx, my) {
  document.getElementById('statCursor').textContent = `x:${Math.round(mx)} y:${Math.round(my)}`;
}

// -- tool rail / tabs -----------------------------------------------------------

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  const canvas = document.getElementById('stageCanvas');
  canvas.style.cursor = tool === 'select' ? 'default' : (tool === 'menu' ? 'pointer' : 'crosshair');
}

function wireToolRail() {
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  document.getElementById('btnDuplicate').addEventListener('click', duplicateSelected);
  document.getElementById('btnDelete').addEventListener('click', deleteSelected);
  document.getElementById('btnLockPos').addEventListener('click', () => toggleLock('posLocked'));
  document.getElementById('btnLockSize').addEventListener('click', () => toggleLock('sizeLocked'));
  document.getElementById('chkSnap').addEventListener('change', (e) => { state.snap = e.target.checked; render(); });
  document.getElementById('chkMultiSelect').addEventListener('change', (e) => { state.multiSelectMode = e.target.checked; });
  document.getElementById('gridSize').addEventListener('input', (e) => { state.gridSize = Math.max(1, parseInt(e.target.value, 10) || 10); render(); });
  document.getElementById('zoomIn').addEventListener('click', () => setZoom(state.zoom * 1.25));
  document.getElementById('zoomOut').addEventListener('click', () => setZoom(state.zoom / 1.25));
  document.getElementById('zoomFit').addEventListener('click', fitZoom);
}

function syncLockButtons() {
  const sel = getSelected();
  const posBtn = document.getElementById('btnLockPos');
  const sizeBtn = document.getElementById('btnLockSize');
  posBtn.disabled = !sel;
  sizeBtn.disabled = !sel;
  posBtn.classList.toggle('active', !!(sel && sel.posLocked));
  sizeBtn.classList.toggle('active', !!(sel && sel.sizeLocked));
}

function setZoom(z) {
  state.zoom = Math.max(0.1, Math.min(6, z));
  document.getElementById('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
  render();
}

function fitZoom() {
  const area = document.getElementById('canvasArea');
  const availW = area.clientWidth - 80;
  const availH = area.clientHeight - 80;
  const z = Math.max(0.1, Math.min(availW / state.stage.width, availH / state.stage.height, 4));
  setZoom(z);
}

function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    });
  });
}

// -- structural change hook ------------------------------------------------------

function afterStructuralChange() {
  attachAllImageRuntimes(state.items);
  render();
  renderProperties();
  renderLayers();
  document.getElementById('scriptText').value = state.script;
  updateStatusBar();
  updateHistoryButtons();
  scheduleAutosave();
  if (typeof onSceneStructureChanged === 'function') onSceneStructureChanged();
}

function renderAllSoft() {
  render();
  updateStatusBar();
}

// -- resizable sidebars ----------------------------------------------------------
// Drag the gutters between panes to resize the Lua / properties columns. The
// widths live in CSS vars on the grid (--lua-w / --props-w) and persist to
// localStorage. Double-click resets; arrow keys nudge (Shift = bigger step).
function wireResizers() {
  const grid = document.getElementById('mainGrid');
  if (!grid) return;
  const KEY = { lua: 'gfxforge.luaWidth', props: 'gfxforge.propsWidth' };
  const VAR = { lua: '--lua-w', props: '--props-w' };
  const DEF = { lua: '320px', props: '300px' };
  const MIN = 200;

  try {
    for (const side of ['lua', 'props']) {
      const v = localStorage.getItem(KEY[side]);
      if (v) grid.style.setProperty(VAR[side], v);
    }
  } catch (e) { /* storage blocked — just use defaults */ }

  const maxW = () => Math.max(MIN, grid.getBoundingClientRect().width - 360); // keep canvas + other pane usable
  const setW = (side, px) => {
    const w = Math.round(Math.max(MIN, Math.min(px, maxW())));
    grid.style.setProperty(VAR[side], w + 'px');
    try { localStorage.setItem(KEY[side], w + 'px'); } catch (e) { /* ignore */ }
  };
  const curW = (side) => {
    const el = side === 'lua' ? document.getElementById('luaSidebar') : document.querySelector('.sidebar');
    return el ? el.getBoundingClientRect().width : parseInt(DEF[side], 10);
  };

  let active = null;
  const onMove = (e) => {
    if (!active) return;
    const rect = grid.getBoundingClientRect();
    setW(active.side, active.side === 'lua' ? (e.clientX - rect.left) : (rect.right - e.clientX));
  };
  const onUp = () => {
    if (!active) return;
    active.handle.classList.remove('dragging');
    document.body.classList.remove('col-resizing');
    active = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  grid.querySelectorAll('.gutter').forEach((h) => {
    const side = h.dataset.resize;
    h.addEventListener('mousedown', (e) => {
      e.preventDefault();
      active = { side, handle: h };
      h.classList.add('dragging');
      document.body.classList.add('col-resizing');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    h.addEventListener('dblclick', () => {
      grid.style.setProperty(VAR[side], DEF[side]);
      try { localStorage.setItem(KEY[side], DEF[side]); } catch (e) { /* ignore */ }
    });
    h.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      setW(side, curW(side) + (side === 'lua' ? dir : -dir) * (e.shiftKey ? 48 : 16));
    });
  });
}

// -- project new / open / save / paste / export -----------------------------------

function newProject() {
  if (state.items.length && !confirm('Start a new project? Unsaved changes will be lost (use Save Project first if you want to keep them).')) return;
  state.stage = defaultStage();
  state.items = [];
  state.script = '';
  state.selectedIds = new Set();
  undoStack = []; redoStack = [];
  setZoom(1);
  afterStructuralChange();
  showToast('New project', 'success');
}

function loadProjectJsonText(text, sourceLabel) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    showToast('Invalid JSON: ' + e.message, 'error');
    return false;
  }
  try {
    const result = loadProjectFromObject(obj);
    state.stage = result.stage;
    state.items = result.items;
    state.script = result.script;
    state.selectedIds = new Set();
    undoStack = []; redoStack = [];
    afterStructuralChange();
    fitZoom();
    if (result.warnings.length) {
      showToast(`Loaded ${sourceLabel} with ${result.warnings.length} warning(s) — see console.`, 'error');
      console.warn('gfxforge project load warnings:', result.warnings);
    } else {
      showToast(`Loaded ${sourceLabel}`, 'success');
    }
    return true;
  } catch (e) {
    showToast('Could not load project: ' + e.message, 'error');
    return false;
  }
}

// Import an existing .gfx movie: decode what's recoverable into editable items.
// Compressed (CFX/CWS) movies are inflated first via the browser's zlib.
async function inflateZlibToGfx(buf) {
  const ds = new DecompressionStream('deflate');
  const raw = new Uint8Array(await new Response(new Blob([buf.subarray(8)]).stream().pipeThrough(ds)).arrayBuffer());
  const out = new Uint8Array(8 + raw.length);
  out.set([71, 70, 88], 0);          // 'GFX'
  out.set(buf.subarray(3, 8), 3);    // version + filelen
  out.set(raw, 8);
  return out;
}

async function importGfxFile(file) {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const magic = String.fromCharCode(buf[0] || 0, buf[1] || 0, buf[2] || 0);
    let bytes = buf;
    if (magic === 'CFX' || magic === 'CWS') {
      if (typeof DecompressionStream === 'undefined') { showToast('Compressed movie — this browser lacks DecompressionStream', 'error'); return; }
      bytes = await inflateZlibToGfx(buf);
    } else if (magic !== 'GFX' && magic !== 'FWS') {
      showToast('Not a .gfx/.swf movie', 'error'); return;
    }
    const { project, notes } = Decode.decodeGfx(bytes);
    const result = loadProjectFromObject(project);
    state.stage = result.stage;
    state.items = result.items;
    state.script = result.script;
    state.selectedIds = new Set();
    undoStack = []; redoStack = [];
    afterStructuralChange();
    fitZoom();
    if (notes.length) {
      showToast('Imported ' + file.name + ': ' + state.items.length + ' items, ' + notes.length + ' note(s) — see console', 'success');
      console.warn('gfx import notes (' + file.name + '):', notes);
    } else {
      showToast('Imported ' + file.name + ': ' + state.items.length + ' items', 'success');
    }
  } catch (e) {
    showToast('Could not import .gfx: ' + e.message, 'error');
    console.error(e);
  }
}

function saveProjectFile() {
  const json = JSON.stringify(serializeProject(), null, 2);
  downloadBlob(json, (state.stage.name || 'movie') + '.gfxproj.json', 'application/json');
  showToast('Project saved', 'success');
}

function exportGfx() {
  let movie, data;
  try {
    movie = buildMovieFromState();
    data = movie.build();
    Verify.verifyMovie(movie);
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
    return;
  }
  downloadBlob(data, (state.stage.name || 'movie') + '.gfx', 'application/octet-stream');
  showToast(`Exported ${(state.stage.name || 'movie')}.gfx (${data.length} bytes)`, 'success');
  showExportNextStep();
}

// After an export, point the user at the packer — a .gfx is not installable on its own; it
// has to go into a patch WAD. wad.mercs2.tools does that with no command line. Persistent +
// dismissible so it does not nag on every export.
function showExportNextStep() {
  let bar = document.getElementById('gfxNextStep');
  if (bar) { bar.style.display = 'flex'; return; }
  bar = el('div', { id: 'gfxNextStep' });
  bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;'
    + 'display:flex;align-items:center;gap:10px;max-width:min(92vw,560px);padding:10px 14px;'
    + 'background:#111a2b;color:#e2e8f0;border:1px solid #2f4a6d;border-left:3px solid #60a5fa;'
    + 'border-radius:8px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4)';
  const msg = el('div', {}); msg.style.flex = '1';
  msg.appendChild(el('b', { text: '✓ .gfx exported. ' }));
  msg.appendChild(document.createTextNode('Next: pack it into a game WAD (no command line) at '));
  const a = el('a', { text: 'wad.mercs2.tools' });
  a.href = 'https://wad.mercs2.tools/'; a.target = '_blank'; a.rel = 'noopener';
  a.style.color = '#7dd3fc'; a.style.fontWeight = '600';
  msg.appendChild(a);
  msg.appendChild(document.createTextNode(' — drop your .gfx, name it, save the WAD.'));
  bar.appendChild(msg);
  const x = el('button', { text: '✕' });
  x.style.cssText = 'background:none;border:0;color:#94a3b8;cursor:pointer;font-size:14px;padding:2px 4px';
  x.title = 'Dismiss';
  x.addEventListener('click', () => bar.remove());
  bar.appendChild(x);
  document.body.appendChild(bar);
}

function downloadBlob(data, filename, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function wireImageUpload() {
  document.getElementById('imageFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) { pendingImagePoint = null; pendingReplaceId = null; return; }
    if (!file.type.startsWith('image/')) {
      showToast('That file doesn\'t look like an image', 'error');
      pendingImagePoint = null;
      pendingReplaceId = null;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      decodeDataUrlToImage(dataUrl, ({ img, imageData, naturalWidth, naturalHeight }) => {
        pushHistory();
        if (pendingReplaceId) {
          const existing = state.items.find(i => i.id === pendingReplaceId);
          pendingReplaceId = null;
          pendingImagePoint = null;
          if (existing) {
            existing.dataUrl = dataUrl;
            existing.__img = img;
            existing.__imageData = imageData;
            existing.naturalWidth = naturalWidth;
            existing.naturalHeight = naturalHeight;
            afterStructuralChange();
            showToast('Image replaced', 'success');
          }
          return;
        }
        const point = pendingImagePoint || { x: Math.round(state.stage.width / 2 - naturalWidth / 2), y: Math.round(state.stage.height / 2 - naturalHeight / 2) };
        pendingImagePoint = null;
        // cap the initial placed size to something reasonable if the source
        // image is larger than the stage, so it doesn't appear off-canvas;
        // the user can still resize freely afterwards.
        const maxW = Math.max(20, state.stage.width - point.x - 2);
        const maxH = Math.max(20, state.stage.height - point.y - 2);
        const scale = Math.min(1, maxW / naturalWidth, maxH / naturalHeight);
        const w = Math.max(4, Math.round(naturalWidth * scale));
        const h = Math.max(4, Math.round(naturalHeight * scale));
        const it = makeItem('image', { x: point.x, y: point.y, w, h, dataUrl, naturalWidth, naturalHeight });
        it.__img = img;
        it.__imageData = imageData;
        state.items.push(it);
        selectOnly(it.id);
        afterStructuralChange();
        showToast(`Imported ${naturalWidth}×${naturalHeight} image`, 'success');
      }, (err) => {
        showToast('Could not read that image: ' + err.message, 'error');
      });
    };
    reader.onerror = () => showToast('Could not read the selected file', 'error');
    reader.readAsDataURL(file);
  });
}

function wireFileMenu() {
  document.getElementById('btnNew').addEventListener('click', newProject);
  document.getElementById('btnSaveProject').addEventListener('click', saveProjectFile);
  document.getElementById('btnExport').addEventListener('click', exportGfx);
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);

  document.getElementById('btnOpen').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadProjectJsonText(reader.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('btnImportGfx').addEventListener('click', () => document.getElementById('gfxFileInput').click());
  document.getElementById('gfxFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importGfxFile(file);
    e.target.value = '';
  });

  document.getElementById('btnPasteJson').addEventListener('click', () => {
    document.getElementById('pasteJsonText').value = '';
    openModal('modalPaste');
  });
  document.getElementById('btnPasteLoad').addEventListener('click', () => {
    const ok = loadProjectJsonText(document.getElementById('pasteJsonText').value, 'pasted JSON');
    if (ok) closeModal('modalPaste');
  });

  document.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', () => closeModal(b.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(overlay.id); });
  });

  document.getElementById('btnHelp').addEventListener('click', () => openModal('modalHelp'));
  document.getElementById('btnWhatsThis').addEventListener('click', () => openModal('modalHelp'));
  document.getElementById('btnScriptHelp').addEventListener('click', () => openModal('modalHelp'));
  document.getElementById('btnLoadSample').addEventListener('click', () => {
    loadProjectJsonText(JSON.stringify(SAMPLE_PROJECT), 'sample project');
    closeModal('modalHelp');
  });
}

// -- menu wizard --------------------------------------------------------------

function wireMenuWizard() {
  document.getElementById('btnMenuCreate').addEventListener('click', () => {
    const options = document.getElementById('menuOptions').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!options.length) { showToast('Add at least one option', 'error'); return; }
    const mi = {
      x: pendingMenuPoint ? pendingMenuPoint.x : 20,
      y: pendingMenuPoint ? pendingMenuPoint.y : 20,
      options,
      width: parseFloat(document.getElementById('menuWidth').value) || 170,
      row_h: parseFloat(document.getElementById('menuRowH').value) || 22,
      gap: parseFloat(document.getElementById('menuGap').value) || 2,
      event: document.getElementById('menuEvent').value || 'menuClick',
    };
    pushHistory();
    const warnings = [];
    const { items, scriptSnippet } = expandMenuSpec(mi, warnings);
    state.items.push(...items);
    if (scriptSnippet) state.script = state.script.trim() ? state.script.replace(/\s*$/, '\n\n') + scriptSnippet : scriptSnippet;
    state.selectedIds = items.length ? new Set([items[0].id]) : new Set();
    pendingMenuPoint = null;
    setTool('select');
    afterStructuralChange();
    closeModal('modalMenu');
    showToast('Menu placed — SetSelected() added to your script', 'success');
  });
}
