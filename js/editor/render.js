
// -- global editor state -----------------------------------------------------

let state = {
  stage: defaultStage(),
  items: [],
  script: '',
  selectedIds: new Set(),
  tool: 'select',
  zoom: 1,
  gridSize: 10,
  snap: true,
  currentFill: [232, 140, 24, 255],
  currentTextColor: [235, 238, 242, 255],
  mode: 'edit', // 'edit' | 'play'
  multiSelectMode: false, // touch-friendly alternative to shift+click
};

let playCtx = null; // { stage, items, interpreter } while state.mode === 'play'

let undoStack = [];
let redoStack = [];
let drag = null;
let pendingMenuPoint = null;
let pendingImagePoint = null;
let pendingReplaceId = null;

// -- selection ----------------------------------------------------------------
//
// state.selectedIds is the single source of truth. getSelected() — used
// throughout the properties panel, d-pad, lock buttons, etc. — only returns
// an item when exactly one is selected; with zero or several selected it
// returns null, and callers fall back to the stage panel or (when >1) the
// multi-select panel. This keeps every pre-existing single-item code path
// working unchanged for the common case, while multi-select is purely additive.

function getSelected() {
  if (state.selectedIds.size !== 1) return null;
  const id = state.selectedIds.values().next().value;
  return state.items.find(i => i.id === id) || null;
}

function getMultiSelection() {
  return state.items.filter(i => state.selectedIds.has(i.id));
}

function selectOnly(id) {
  state.selectedIds = new Set(id ? [id] : []);
}

function toggleSelection(id) {
  const next = new Set(state.selectedIds);
  if (next.has(id)) next.delete(id); else next.add(id);
  state.selectedIds = next;
}

function clearSelection() {
  state.selectedIds = new Set();
}

function itemBounds(it) {
  const h = it.kind === 'text' ? (it.size + 6) : it.h;
  return { x: it.x, y: it.y, w: it.w, h };
}

function rgbaCss(c) {
  const a = (c.length > 3 ? c[3] : 255) / 255;
  return `rgba(${clampByte(c[0])},${clampByte(c[1])},${clampByte(c[2])},${a})`;
}

// -- history (undo/redo) -----------------------------------------------------

function snapshot() {
  return JSON.stringify({ stage: state.stage, items: state.items, script: state.script });
}

function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
  scheduleAutosave();
}

function restoreSnapshot(json) {
  const s = JSON.parse(json);
  state.stage = s.stage;
  state.items = s.items;
  state.script = s.script;
  state.selectedIds = new Set();
  afterStructuralChange();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
  updateHistoryButtons();
}

function updateHistoryButtons() {
  document.getElementById('btnUndo').disabled = undoStack.length === 0;
  document.getElementById('btnRedo').disabled = redoStack.length === 0;
}

// -- snapping -----------------------------------------------------------------

function snapv(v) {
  if (!state.snap || state.gridSize < 1) return v;
  return Math.round(v / state.gridSize) * state.gridSize;
}

// -- rendering ------------------------------------------------------------

function render() {
  const canvas = document.getElementById('stageCanvas');
  const dpr = window.devicePixelRatio || 1;
  const playing = state.mode === 'play' && playCtx;
  const stage = playing ? playCtx.stage : state.stage;
  const items = playing ? playCtx.items : state.items;

  const cw = Math.max(1, Math.round(stage.width * state.zoom));
  const ch = Math.max(1, Math.round(stage.height * state.zoom));
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = Math.max(1, Math.round(cw * dpr));
  canvas.height = Math.max(1, Math.round(ch * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr * state.zoom, 0, 0, dpr * state.zoom, 0, 0);
  ctx.clearRect(0, 0, stage.width, stage.height);

  ctx.fillStyle = rgbaCss(stage.background);
  ctx.fillRect(0, 0, stage.width, stage.height);

  if (!playing) drawReferenceImage(ctx);

  if (!playing && state.snap && state.gridSize * state.zoom >= 4) drawGrid(ctx);

  for (const it of items) {
    if (it.hidden) continue;
    if (playing && it._visible === false) continue;
    drawItem(ctx, it, playing);
  }

  if (!playing) {
    const multi = getMultiSelection();
    for (const it of multi) {
      if (!it.hidden) drawSelection(ctx, it, multi.length > 1);
    }
    if (drag && drag.mode === 'marquee') drawMarquee(ctx, drag);
  }

  ctx.strokeStyle = playing ? '#4caf82' : '#3a3f47';
  ctx.lineWidth = (playing ? 2 : 1) / state.zoom;
  ctx.strokeRect(0.5 / state.zoom, 0.5 / state.zoom, stage.width - 1 / state.zoom, stage.height - 1 / state.zoom);
}

function drawGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1 / state.zoom;
  const g = state.gridSize;
  for (let x = g; x < state.stage.width; x += g) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.stage.height); ctx.stroke();
  }
  for (let y = g; y < state.stage.height; y += g) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.stage.width, y); ctx.stroke();
  }
  ctx.restore();
}

// Returns a value usable as ctx.fillStyle: a CSS color string for solid
// fills, or a CanvasGradient for gradient fills — so the on-canvas preview
// matches what the exported shape will actually look like.
function fillStyleFor(ctx, fill, x, y, w, h) {
  if (Array.isArray(fill)) return rgbaCss(fill);
  const cx = x + w / 2, cy = y + h / 2;
  let grad;
  if (fill.type === 'radial') {
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
  } else if (fill.direction === 'vertical') {
    grad = ctx.createLinearGradient(cx, y, cx, y + h);
  } else {
    grad = ctx.createLinearGradient(x, cy, x + w, cy);
  }
  for (const s of fill.stops) grad.addColorStop(Math.max(0, Math.min(1, s.ratio / 255)), rgbaCss(s.color));
  return grad;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  if (rr <= 0) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function drawFillableRect(ctx, it, fill) {
  roundedRectPath(ctx, it.x, it.y, it.w, it.h, it.radius || 0);
  ctx.fillStyle = fillStyleFor(ctx, fill, it.x, it.y, it.w, it.h);
  ctx.fill();
  if (it.stroke) {
    ctx.lineWidth = Math.max(1, it.stroke.width);
    ctx.strokeStyle = rgbaCss(it.stroke.color);
    ctx.stroke();
  }
}

function drawItem(ctx, it, playing) {
  if (it.kind === 'rect') {
    drawFillableRect(ctx, it, it.fill);
  } else if (it.kind === 'text') {
    const h = it.size + 6;
    const displayText = playing && it.varName && it.__runtimeText !== undefined ? it.__runtimeText : it.text;
    if (!playing) {
      ctx.strokeStyle = 'rgba(89,208,255,0.25)';
      ctx.setLineDash([3, 2]);
      ctx.lineWidth = 1 / state.zoom;
      ctx.strokeRect(it.x + 0.5, it.y + 0.5, it.w, h);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = rgbaCss(it.color);
    ctx.font = `${it.size}px Arial, sans-serif`;
    ctx.textBaseline = 'top';
    clipText(ctx, String(displayText), it.x + 2, it.y + 2, it.w - 4);
    if (it.varName && !playing) {
      ctx.fillStyle = 'rgba(89,208,255,0.85)';
      ctx.font = `9px ${MONO_STACK}`;
      ctx.fillText('$' + it.varName, it.x + 2, it.y + h + 1);
    }
  } else if (it.kind === 'button') {
    drawFillableRect(ctx, it, it.fill);
    if (!it.stroke) {
      ctx.strokeStyle = 'rgba(143,160,180,0.6)';
      ctx.lineWidth = 1 / state.zoom;
      roundedRectPath(ctx, it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1, it.radius || 0);
      ctx.stroke();
    }
    if (it.label) {
      ctx.fillStyle = rgbaCss(it.labelColor);
      ctx.font = `bold ${it.labelSize}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      clipText(ctx, it.label, it.x + it.w / 2, it.y + it.h / 2, it.w - 8, true);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    if (playing) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(it.x, it.y, it.w, it.h); // subtle hint the shape is clickable in play mode
    }
  } else if (it.kind === 'clip') {
    if (playing) { drawClipPlaying(ctx, it); return; }
    drawFillableRect(ctx, it, it.color);
    if (!it.stroke) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1 / state.zoom;
      roundedRectPath(ctx, it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1, it.radius || 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `9px ${MONO_STACK}`;
    ctx.fillText('@' + it.name, it.x, it.y - 2);
  } else if (it.kind === 'image') {
    if (it.__img) {
      ctx.drawImage(it.__img, it.x, it.y, it.w, it.h);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `10px ${MONO_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText(it.dataUrl ? 'loading…' : 'image', it.x + it.w / 2, it.y + it.h / 2);
      ctx.textAlign = 'left';
    }
  }
}

const MONO_STACK = 'ui-monospace, monospace';

function drawClipPlaying(ctx, it) {
  const alpha = (it._alpha ?? 100) / 100;
  const xscale = (it._xscale ?? 100) / 100;
  const yscale = (it._yscale ?? 100) / 100;
  const rotation = (it._rotation ?? 0) * Math.PI / 180;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate(rotation);
  ctx.scale(xscale, yscale);
  ctx.translate(-it.w / 2, -it.h / 2);
  ctx.fillStyle = rgbaCss(it.color);
  ctx.fillRect(0, 0, it.w, it.h);
  ctx.restore();
}

function clipText(ctx, text, x, y, maxW, centered) {
  if (maxW <= 0) { ctx.fillText(text, x, y); return; }
  let t = text;
  while (ctx.measureText(t).width > maxW && t.length > 1) {
    t = t.slice(0, -1);
  }
  if (t !== text && t.length > 1) t = t.slice(0, -1) + '…';
  ctx.fillText(t, x, y);
}

const HANDLES_FULL = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLES_TEXT = ['w', 'e'];
const HANDLE_R = 5;
const HANDLE_HIT_R = 16;

function activeHandles(it) {
  return it.kind === 'text' ? HANDLES_TEXT : HANDLES_FULL;
}

function handlePositions(it) {
  const b = itemBounds(it);
  return {
    nw: [b.x, b.y], n: [b.x + b.w / 2, b.y], ne: [b.x + b.w, b.y],
    e: [b.x + b.w, b.y + b.h / 2], se: [b.x + b.w, b.y + b.h], s: [b.x + b.w / 2, b.y + b.h],
    sw: [b.x, b.y + b.h], w: [b.x, b.y + b.h / 2],
  };
}

const CURSOR_FOR_HANDLE = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

function drawSelection(ctx, it, suppressHandles) {
  const b = itemBounds(it);
  ctx.save();
  ctx.strokeStyle = '#59d0ff';
  ctx.lineWidth = 1.5 / state.zoom;
  ctx.setLineDash(it.posLocked ? [] : [4 / state.zoom, 3 / state.zoom]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  if (!it.sizeLocked && !suppressHandles) {
    ctx.fillStyle = '#59d0ff';
    const hp = handlePositions(it);
    const r = HANDLE_R / state.zoom;
    for (const d of activeHandles(it)) {
      const [hx, hy] = hp[d];
      ctx.fillRect(hx - r / 2, hy - r / 2, r, r);
    }
  }
  if (it.posLocked || it.sizeLocked) {
    const tag = it.posLocked && it.sizeLocked ? 'LOCKED' : it.posLocked ? 'POS LOCKED' : 'SIZE LOCKED';
    ctx.fillStyle = '#59d0ff';
    ctx.font = `9px ${MONO_STACK}`;
    ctx.textAlign = 'right';
    ctx.fillText(tag, b.x + b.w, b.y - 3);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function drawMarquee(ctx, drag) {
  const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
  const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
  ctx.save();
  ctx.fillStyle = 'rgba(89,208,255,0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#59d0ff';
  ctx.lineWidth = 1 / state.zoom;
  ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
