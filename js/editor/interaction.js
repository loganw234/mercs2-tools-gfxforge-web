
// -- coordinate mapping -----------------------------------------------------

function toStage(e) {
  const canvas = document.getElementById('stageCanvas');
  const rect = canvas.getBoundingClientRect();
  return {
    mx: (e.clientX - rect.left) / state.zoom,
    my: (e.clientY - rect.top) / state.zoom,
  };
}

function hitTest(mx, my) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.hidden) continue;
    const b = itemBounds(it);
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return it;
  }
  return null;
}

function hitHandle(it, mx, my) {
  if (!it || it.sizeLocked) return null;
  const hp = handlePositions(it);
  const r = HANDLE_HIT_R / state.zoom;
  for (const d of activeHandles(it)) {
    const [hx, hy] = hp[d];
    if (Math.abs(mx - hx) <= r && Math.abs(my - hy) <= r) return d;
  }
  return null;
}

function applyResize(it, dir, x0, y0, w0, h0, dx, dy) {
  let x = x0, y = y0, w = w0, h = h0;
  if (dir.includes('w')) { x = x0 + dx; w = w0 - dx; }
  if (dir.includes('e')) { w = w0 + dx; }
  if (dir.includes('n')) { y = y0 + dy; h = h0 - dy; }
  if (dir.includes('s')) { h = h0 + dy; }
  if (w < 4) { if (dir.includes('w')) x = x0 + w0 - 4; w = 4; }
  if (h < 4) { if (dir.includes('n')) y = y0 + h0 - 4; h = 4; }
  it.x = snapv(x);
  it.y = snapv(y);
  it.w = Math.max(4, snapv(w));
  if (it.kind !== 'text') it.h = Math.max(4, snapv(h));
}

// -- mouse interaction --------------------------------------------------------

function onCanvasMouseDown(e) {
  const { mx, my } = toStage(e);

  if (state.mode === 'play') {
    onPlayCanvasClick(mx, my);
    return;
  }

  if (state.tool === 'menu') {
    pendingMenuPoint = { x: Math.round(mx), y: Math.round(my) };
    openModal('modalMenu');
    return;
  }

  if (state.tool === 'image') {
    pendingImagePoint = { x: Math.round(mx), y: Math.round(my) };
    document.getElementById('imageFileInput').click();
    setTool('select'); // avoid re-triggering the picker on the next stray click while the dialog is up
    return;
  }

  if (state.tool === 'select') {
    const multiMode = e.shiftKey || state.multiSelectMode;
    const sel = getSelected();
    const dir = sel ? hitHandle(sel, mx, my) : null;
    if (dir) {
      pushHistory();
      const b = itemBounds(sel);
      drag = { mode: 'resize', item: sel, dir, x0: b.x, y0: b.y, w0: b.w, h0: b.h, mx0: mx, my0: my };
      return;
    }
    const hit = hitTest(mx, my);
    if (hit) {
      if (multiMode) {
        toggleSelection(hit.id);
        renderProperties();
        renderLayers();
        render();
        return;
      }
      if (!state.selectedIds.has(hit.id)) selectOnly(hit.id);
      renderProperties();
      renderLayers();
      render();
      if (!hit.posLocked) {
        pushHistory();
        const multi = getMultiSelection();
        if (multi.length > 1) {
          drag = { mode: 'move-multi', starts: multi.map(i => ({ item: i, x0: i.x, y0: i.y })), mx0: mx, my0: my };
        } else {
          drag = { mode: 'move', item: hit, dx0: mx - hit.x, dy0: my - hit.y };
        }
      }
    } else {
      if (!multiMode) clearSelection();
      drag = { mode: 'marquee', x0: mx, y0: my, x1: mx, y1: my, additive: multiMode };
      renderProperties();
      renderLayers();
      render();
    }
    return;
  }

  // creation tools: rect / text / button / clip
  pushHistory();
  const fields = defaultItemFields(state.tool, mx, my);
  const it = makeItem(state.tool, fields);
  state.items.push(it);
  selectOnly(it.id);
  drag = { mode: 'create', item: it, mx0: mx, my0: my, w0: fields.w, h0: fields.h };
  renderProperties();
  renderLayers();
  render();
}

function onWindowMouseMove(e) {
  if (state.mode === 'play') return;
  const { mx, my } = toStage(e);
  updateCursorStatus(mx, my);

  if (!drag) {
    updateHoverCursor(mx, my);
    return;
  }

  if (drag.mode === 'move') {
    drag.item.x = snapv(mx - drag.dx0);
    drag.item.y = snapv(my - drag.dy0);
  } else if (drag.mode === 'move-multi') {
    const dx = mx - drag.mx0, dy = my - drag.my0;
    for (const s of drag.starts) {
      s.item.x = snapv(s.x0 + dx);
      s.item.y = snapv(s.y0 + dy);
    }
  } else if (drag.mode === 'marquee') {
    drag.x1 = mx; drag.y1 = my;
  } else if (drag.mode === 'resize') {
    applyResize(drag.item, drag.dir, drag.x0, drag.y0, drag.w0, drag.h0, mx - drag.mx0, my - drag.my0);
  } else if (drag.mode === 'create') {
    const dx = mx - drag.mx0, dy = my - drag.my0;
    if (Math.abs(dx * state.zoom) > 2 || Math.abs(dy * state.zoom) > 2) {
      const nx = Math.min(drag.mx0, mx), ny = Math.min(drag.my0, my);
      const nw = Math.max(4, Math.abs(dx)), nh = Math.max(4, Math.abs(dy));
      drag.item.x = snapv(nx);
      drag.item.y = snapv(ny);
      drag.item.w = Math.max(4, snapv(nw));
      if (drag.item.kind !== 'text') drag.item.h = Math.max(4, snapv(nh));
    }
  }
  render();
  syncPropertyValues();
}

function onWindowMouseUp() {
  if (!drag) return;
  const finished = drag;
  drag = null;
  if (finished.mode === 'create' && (finished.item.kind === 'text' || finished.item.kind === 'button')) {
    openInlineTextEditor(finished.item);
  }
  if (finished.mode === 'marquee') {
    const x0 = Math.min(finished.x0, finished.x1), x1 = Math.max(finished.x0, finished.x1);
    const y0 = Math.min(finished.y0, finished.y1), y1 = Math.max(finished.y0, finished.y1);
    const moved = Math.abs(finished.x1 - finished.x0) > 2 || Math.abs(finished.y1 - finished.y0) > 2;
    if (moved) {
      const hits = state.items.filter(it => !it.hidden && rectsIntersect(itemBounds(it), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
      if (finished.additive) {
        const next = new Set(state.selectedIds);
        for (const it of hits) next.add(it.id);
        state.selectedIds = next;
      } else {
        state.selectedIds = new Set(hits.map(it => it.id));
      }
      renderProperties();
      renderLayers();
    }
  }
  render();
  updateHistoryButtons();
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function updateHoverCursor(mx, my) {
  const canvas = document.getElementById('stageCanvas');
  if (state.tool !== 'select') { canvas.style.cursor = 'crosshair'; return; }
  const sel = getSelected();
  const dir = sel ? hitHandle(sel, mx, my) : null;
  if (dir) { canvas.style.cursor = CURSOR_FOR_HANDLE[dir]; return; }
  const hit = hitTest(mx, my);
  if (hit && hit.posLocked) { canvas.style.cursor = 'not-allowed'; return; }
  canvas.style.cursor = hit ? 'move' : 'default';
}

function onCanvasDblClick(e) {
  if (state.mode === 'play') return;
  const { mx, my } = toStage(e);
  const hit = hitTest(mx, my);
  if (hit && (hit.kind === 'text' || hit.kind === 'button')) {
    selectOnly(hit.id);
    renderProperties();
    renderLayers();
    render();
    openInlineTextEditor(hit);
  }
}

// -- inline text/label editing ------------------------------------------------

function openInlineTextEditor(it) {
  closeInlineEditor();
  pushHistory();
  const overlay = document.createElement('textarea');
  overlay.className = 'text-overlay';
  overlay.value = it.kind === 'button' ? (it.label || '') : (it.text || '');
  positionOverlay(overlay, it);
  document.getElementById('stageWrap').appendChild(overlay);
  window._activeOverlay = overlay;
  overlay.focus();
  overlay.select();

  const commit = () => {
    if (overlay.dataset.cancelled) return;
    const v = overlay.value;
    if (it.kind === 'button') it.label = v; else it.text = v;
    closeInlineEditor();
    render();
    renderProperties();
    renderLayers();
  };
  overlay.addEventListener('blur', commit);
  overlay.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); overlay.blur(); }
    else if (e.key === 'Escape') { overlay.dataset.cancelled = '1'; overlay.blur(); closeInlineEditor(); render(); }
  });
}

function closeInlineEditor() {
  if (window._activeOverlay) {
    window._activeOverlay.remove();
    window._activeOverlay = null;
  }
}

function positionOverlay(overlay, it) {
  const canvas = document.getElementById('stageCanvas');
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = document.getElementById('stageWrap').getBoundingClientRect();
  const b = itemBounds(it);
  const left = (canvasRect.left - wrapRect.left) + b.x * state.zoom;
  const top = (canvasRect.top - wrapRect.top) + b.y * state.zoom;
  overlay.style.left = left + 'px';
  overlay.style.top = top + 'px';
  overlay.style.width = Math.max(50, b.w * state.zoom) + 'px';
  overlay.style.height = Math.max(22, b.h * state.zoom) + 'px';
  const size = it.kind === 'button' ? it.labelSize : it.size;
  overlay.style.fontSize = Math.max(10, size * state.zoom) + 'px';
}

// -- delete / duplicate -------------------------------------------------------

function alignSelection(mode) {
  const items = getMultiSelection();
  if (items.length < 2) return;
  pushHistory();
  const bounds = items.map(itemBounds);
  const minX = Math.min(...bounds.map(b => b.x));
  const maxXR = Math.max(...bounds.map(b => b.x + b.w));
  const minY = Math.min(...bounds.map(b => b.y));
  const maxYB = Math.max(...bounds.map(b => b.y + b.h));
  const bboxCenterX = (minX + maxXR) / 2;
  const bboxCenterY = (minY + maxYB) / 2;
  items.forEach((it, i) => {
    const b = bounds[i];
    if (mode === 'left') it.x = minX;
    else if (mode === 'right') it.x = maxXR - b.w;
    else if (mode === 'center-h') it.x = Math.round(bboxCenterX - b.w / 2);
    else if (mode === 'top') it.y = minY;
    else if (mode === 'bottom') it.y = maxYB - b.h;
    else if (mode === 'middle-v') it.y = Math.round(bboxCenterY - b.h / 2);
  });
  afterStructuralChange();
}

// Keeps the extreme (first/last, by position) items fixed and spaces the
// rest with equal gaps between them — the standard "distribute spacing"
// behaviour, not equal-center-spacing.
function distributeSelection(axis) {
  const items = getMultiSelection();
  if (items.length < 3) return;
  pushHistory();
  if (axis === 'horizontal') {
    const sorted = items.slice().sort((a, b) => a.x - b.x);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = (last.x + itemBounds(last).w) - first.x;
    const totalW = sorted.reduce((sum, it) => sum + itemBounds(it).w, 0);
    const gap = (span - totalW) / (sorted.length - 1);
    let cursor = first.x;
    for (const it of sorted) {
      it.x = Math.round(cursor);
      cursor += itemBounds(it).w + gap;
    }
  } else {
    const sorted = items.slice().sort((a, b) => a.y - b.y);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = (last.y + itemBounds(last).h) - first.y;
    const totalH = sorted.reduce((sum, it) => sum + itemBounds(it).h, 0);
    const gap = (span - totalH) / (sorted.length - 1);
    let cursor = first.y;
    for (const it of sorted) {
      it.y = Math.round(cursor);
      cursor += itemBounds(it).h + gap;
    }
  }
  afterStructuralChange();
}

function bulkToggle(field) {
  const items = getMultiSelection();
  if (!items.length) return;
  pushHistory();
  const anyOff = items.some(it => !it[field]);
  for (const it of items) it[field] = anyOff;
  afterStructuralChange();
}

function deleteSelected() {
  if (!state.selectedIds.size) return;
  pushHistory();
  state.items = state.items.filter(i => !state.selectedIds.has(i.id));
  clearSelection();
  afterStructuralChange();
}

function duplicateSelected() {
  const multi = getMultiSelection();
  if (!multi.length) return;
  pushHistory();
  const newIds = [];
  for (const sel of multi) {
    const copy = clone(sel);
    copy.id = newId();
    copy.x = sel.x + 10;
    copy.y = sel.y + 10;
    if (copy.kind === 'clip') copy.name = uniqueClipName(sel.name);
    if (copy.kind === 'image') { copy.__img = sel.__img; copy.__imageData = sel.__imageData; }
    state.items.push(copy);
    newIds.push(copy.id);
  }
  state.selectedIds = new Set(newIds);
  afterStructuralChange();
}

// -- keyboard shortcuts --------------------------------------------------------

function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// 'i'/image tool disabled — embedded bitmaps don't render in GFx (see index.html).
const TOOL_KEYS = { v: 'select', r: 'rect', t: 'text', b: 'button', c: 'clip', m: 'menu' };

// -- nudge / lock ---------------------------------------------------------------

// dx/dy are already-scaled stage-pixel deltas. Deliberately bypasses posLocked:
// a lock guards against an accidental drag, not a deliberate precise nudge.
function nudgeSelected(dx, dy) {
  const sel = getSelected();
  if (!sel) return;
  pushHistory();
  sel.x += dx;
  sel.y += dy;
  render();
  syncPropertyValues();
}

function toggleLock(field) {
  const sel = getSelected();
  if (!sel) return;
  pushHistory();
  sel[field] = !sel[field];
  render();
  renderProperties();
}

window.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-overlay.open')) {
    if (e.key === 'Escape') closeAllModals();
    return;
  }
  if (isTypingTarget(document.activeElement)) return;

  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
  if (e.key === 'Escape') {
    if (state.mode === 'play') { exitPlayMode(); return; }
    clearSelection(); renderProperties(); renderLayers(); render(); return;
  }

  if (getSelected() && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? (state.gridSize || 10) : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    nudgeSelected(dx, dy);
    return;
  }

  const lower = e.key.toLowerCase();
  if (TOOL_KEYS[lower]) { setTool(TOOL_KEYS[lower]); }
});
