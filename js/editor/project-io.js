
// =========================================================================
// gfxforge web editor — application logic
// Codec (Bitio/Swf/Avm1/Compiler/GFMovie/Verify) is defined above this point;
// everything below is the editor: state, serialization, rendering, UI.
// =========================================================================

// -- small utils ----------------------------------------------------------

function clampByte(v) {
  v = Number(v);
  if (!Number.isFinite(v)) v = 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

function normColor(c, fallback) {
  if (!Array.isArray(c) || c.length < 3) return fallback.slice();
  const r = clampByte(c[0]), g = clampByte(c[1]), b = clampByte(c[2]);
  const a = c.length > 3 ? clampByte(c[3]) : 255;
  return [r, g, b, a];
}

// Accepts either a plain [r,g,b,a] solid color or a gradient spec
// {type:'linear'|'radial', direction, stops:[{ratio,color}]}. Falls back to
// a solid color if the gradient spec is malformed rather than rejecting the
// whole item, since a bad gradient shouldn't take the shape down with it.
function normFill(fill, fallback) {
  if (fill && typeof fill === 'object' && !Array.isArray(fill) && (fill.type === 'linear' || fill.type === 'radial')) {
    const stops = Array.isArray(fill.stops) ? fill.stops : [];
    if (stops.length >= 1) {
      return {
        type: fill.type,
        direction: fill.direction === 'vertical' ? 'vertical' : 'horizontal',
        stops: stops.map(s => ({ ratio: Math.max(0, Math.min(255, num(s.ratio, 0))), color: normColor(s.color, fallback) })),
      };
    }
  }
  return normColor(fill, fallback);
}

function normStroke(stroke) {
  if (!stroke || typeof stroke !== 'object') return null;
  const width = num(stroke.width, 0);
  if (width <= 0) return null;
  return { width, color: normColor(stroke.color, [0, 0, 0, 255]) };
}

function toHex(rgb) {
  return '#' + rgb.slice(0, 3).map(v => clampByte(v).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function lighten(rgb, amt) {
  return [clampByte(rgb[0] + amt), clampByte(rgb[1] + amt), clampByte(rgb[2] + amt), rgb[3] !== undefined ? rgb[3] : 255];
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

let _idCounter = 1;
function newId() { return 'it' + (_idCounter++); }

function round1(v) { return Math.round(v * 10) / 10; }

// -- default state ----------------------------------------------------------

function defaultStage() {
  return {
    width: 380, height: 150, fps: 30, name: 'movie',
    background: [22, 24, 28, 255],
    fontName: '_normal_Font', fontUrl: '_normal_Font.swf',
    // Timeline frames, as labels. An empty list is a single unlabelled frame,
    // which is what every project was before frames existed.
    frames: [],
  };
}

// Clip event names that can carry a handler, in the order they're offered in
// the UI. These are the subset of GFx's clip events that make sense for HUD
// authoring — the full wire set is in Swf.CLIP_EVENT.
const CLIP_EVENT_NAMES = ['press', 'release', 'releaseOutside', 'rollOver', 'rollOut',
  'dragOver', 'dragOut', 'enterFrame', 'load', 'unload', 'keyDown', 'keyUp'];

function normEvents(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const name of CLIP_EVENT_NAMES) {
    const src = raw[name];
    if (typeof src === 'string' && src.trim()) out[name] = src;
  }
  return Object.keys(out).length ? out : null;
}

// Frame membership: an array of frame indices, or null for "every frame".
function normItemFrames(raw, frameCount) {
  if (raw === null || raw === undefined) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const v of list) {
    const n = Math.trunc(num(v, -1));
    if (n >= 0 && n < Math.max(1, frameCount)) out.push(n);
  }
  if (!out.length) return null;
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function normScale9(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const left = num(raw.left, 0), top = num(raw.top, 0);
  const right = num(raw.right, 0), bottom = num(raw.bottom, 0);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function normAlpha(raw) {
  if (raw === null || raw === undefined) return null;
  const n = num(raw, 1);
  if (!(n >= 0) || n >= 1) return null;   // 1 (or nonsense) means "no transform"
  return n;
}

const TEXT_ALIGNS = ['left', 'right', 'center', 'justify'];

function normTextOptions(ri) {
  const o = {};
  if (ri.multiline) o.multiline = true;
  if (ri.word_wrap) o.wordWrap = true;
  if (ri.html) o.html = true;
  if (ri.border) o.border = true;
  if (ri.selectable) o.selectable = true;
  if (typeof ri.align === 'string' && TEXT_ALIGNS.indexOf(ri.align) >= 0) o.align = ri.align;
  if (ri.leading !== undefined) o.leading = num(ri.leading, 0);
  if (ri.max_length !== undefined) o.maxLength = Math.max(0, Math.trunc(num(ri.max_length, 0))) || null;
  return Object.keys(o).length ? o : null;
}

function defaultItemFields(kind, x, y) {
  x = Math.round(x); y = Math.round(y);
  switch (kind) {
    case 'rect':
      return { x, y, w: 80, h: 40, fill: state.currentFill.slice(), radius: 0, stroke: null };
    case 'text':
      return { x, y, w: null, size: 13, text: 'Text', color: state.currentTextColor.slice(), varName: '' };
    case 'button':
      return {
        x, y, w: 100, h: 24, event: 'click', arg: null,
        fill: state.currentFill.slice(), hover: lighten(state.currentFill, 22),
        label: 'Button', labelColor: [235, 238, 242, 255], labelSize: 13,
        radius: 0, stroke: null,
      };
    case 'clip':
      return { x, y, w: 60, h: 12, name: uniqueClipName('clip'), color: state.currentFill.slice(), radius: 0, stroke: null };
    case 'image':
      return { x, y, w: 60, h: 60, dataUrl: null, naturalWidth: 60, naturalHeight: 60 };
    default:
      throw new Error('unknown kind ' + kind);
  }
}

function uniqueClipName(base) {
  const used = new Set(state.items.filter(i => i.kind === 'clip').map(i => i.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(base + n)) n++;
  return base + n;
}

// -- image runtime decoding ---------------------------------------------------
//
// An image item's dataUrl is the serialized source of truth; __img (for
// canvas preview) and __imageData (raw pixels, for Bitmap.defineBitsLossless2)
// are runtime-only, decoded asynchronously, and never persisted — after any
// wholesale item replacement (project load, undo/redo) they need
// re-attaching. See afterStructuralChange().

function decodeDataUrlToImage(dataUrl, onReady, onError) {
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1;
      canvas.height = img.naturalHeight || 1;
      const cctx = canvas.getContext('2d');
      cctx.drawImage(img, 0, 0);
      const imageData = cctx.getImageData(0, 0, canvas.width, canvas.height);
      onReady({ img, imageData, naturalWidth: canvas.width, naturalHeight: canvas.height });
    } catch (e) {
      if (onError) onError(e);
    }
  };
  img.onerror = () => { if (onError) onError(new Error('could not decode image')); };
  img.src = dataUrl;
}

function attachImageRuntime(item) {
  if (item.kind !== 'image' || !item.dataUrl || item.__imageData) return;
  decodeDataUrlToImage(item.dataUrl, ({ img, imageData, naturalWidth, naturalHeight }) => {
    item.__img = img;
    item.__imageData = imageData;
    item.naturalWidth = naturalWidth;
    item.naturalHeight = naturalHeight;
    render();
  }, (e) => {
    showToast('Image failed to load: ' + e.message, 'error');
  });
}

function attachAllImageRuntimes(items) {
  for (const it of items) attachImageRuntime(it);
}

function makeItem(kind, fields) {
  return Object.assign({ id: newId(), kind, hidden: false, posLocked: false, sizeLocked: false }, fields);
}

// -- serialize / load project ------------------------------------------------
//
// The project JSON schema mirrors gfxforge's own Python keyword arguments
// (snake_case) so it reads the same as the original library's README and is
// easy for a human or an LLM to author directly:
//
// {
//   "version": 1,
//   "stage": { "width":380, "height":150, "fps":30, "name":"hud",
//              "background":[22,24,28], "font_name":"_normal_Font",
//              "font_url":"_normal_Font.swf" },
//   "items": [
//     { "kind":"rect", "x":0, "y":0, "w":380, "h":30, "fill":[232,140,24] },
//     { "kind":"text", "x":14, "y":6, "text":"HELLO", "size":15,
//       "color":[25,25,25], "var":"hp_val", "width":100 },
//     { "kind":"button", "x":20, "y":90, "w":120, "h":24, "event":"quit",
//       "arg":null, "label":"QUIT", "fill":[52,58,68], "hover":[74,82,96],
//       "label_color":[235,238,242], "label_size":13 },
//     { "kind":"clip", "name":"bar", "x":4, "y":44, "w":100, "h":8,
//       "fill":[0,200,0] },
//     { "kind":"menu", "x":20, "y":20, "options":["New Game","Options","Quit"],
//       "width":170, "row_h":22, "gap":2, "event":"menuClick" }
//   ],
//   "script": "function SetHealth(n) {\n  _root.hp_val = n;\n}\n"
// }
//
// "menu" is authoring shorthand only: loading one expands it into concrete
// button + clip items (so it's editable like anything else) and appends a
// generated SetSelected(i) to the script. Saving from the editor always
// emits the expanded form.

function serializeItem(it) {
  const out = { kind: it.kind };
  if (it.hidden) out.hidden = true;
  if (it.posLocked) out.lock_pos = true;
  if (it.sizeLocked) out.lock_size = true;
  // Timeline and placement extras, omitted when they're at their defaults so
  // single-frame projects round-trip to exactly the JSON they had before.
  if (it.frames && it.frames.length) out.frames = it.frames.slice();
  if (it.alpha !== null && it.alpha !== undefined) out.alpha = it.alpha;
  if (it.events) out.events = Object.assign({}, it.events);
  if (it.exportAs) out.export = it.exportAs;
  if (it.scale9) out.scale9 = Object.assign({}, it.scale9);
  if (it.kind === 'rect') {
    Object.assign(out, { x: it.x, y: it.y, w: it.w, h: it.h, fill: it.fill });
    if (it.radius) out.radius = it.radius;
    if (it.stroke) out.stroke = it.stroke;
  } else if (it.kind === 'text') {
    Object.assign(out, { x: it.x, y: it.y, text: it.text, size: it.size, color: it.color });
    if (it.varName) out.var = it.varName;
    if (it.width !== null && it.width !== undefined) out.width = it.width;
    if (it.height !== null && it.height !== undefined) out.height = it.height;
    const t = it.textOptions;
    if (t) {
      if (t.multiline) out.multiline = true;
      if (t.wordWrap) out.word_wrap = true;
      if (t.html) out.html = true;
      if (t.border) out.border = true;
      if (t.selectable) out.selectable = true;
      if (t.align) out.align = t.align;
      if (t.leading) out.leading = t.leading;
      if (t.maxLength) out.max_length = t.maxLength;
    }
  } else if (it.kind === 'button') {
    Object.assign(out, { x: it.x, y: it.y, w: it.w, h: it.h, event: it.event });
    if (it.arg !== null && it.arg !== undefined) out.arg = it.arg;
    out.fill = it.fill;
    out.hover = it.hover; // may be null (no hover state)
    if (it.label) {
      out.label = it.label;
      out.label_color = it.labelColor;
      out.label_size = it.labelSize;
    }
    if (it.radius) out.radius = it.radius;
    if (it.stroke) out.stroke = it.stroke;
  } else if (it.kind === 'clip') {
    Object.assign(out, { name: it.name, x: it.x, y: it.y, w: it.w, h: it.h, fill: it.color });
    if (it.radius) out.radius = it.radius;
    if (it.stroke) out.stroke = it.stroke;
  } else if (it.kind === 'image') {
    Object.assign(out, { x: it.x, y: it.y, w: it.w, h: it.h, data_url: it.dataUrl });
  }
  return out;
}

function serializeProject() {
  return {
    version: 1,
    stage: Object.assign({
      width: state.stage.width, height: state.stage.height, fps: state.stage.fps,
      name: state.stage.name, background: state.stage.background,
      font_name: state.stage.fontName, font_url: state.stage.fontUrl,
    }, (state.stage.frames && state.stage.frames.length) ? { frames: state.stage.frames.slice() } : {}),
    items: state.items.map(serializeItem),
    script: state.script || '',
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Expands a "menu" shorthand item into concrete button + clip items plus a
// script snippet. Mirrors gfxforge.movie.Movie.menu()'s layout math, but
// generates AS2 source (compiled the normal way) rather than hand-built AVM1 —
// functionally equivalent, verified separately via the AS2 compiler tests.
function expandMenuSpec(mi, warnings) {
  const x = num(mi.x, 0), y = num(mi.y, 0);
  const width = num(mi.width, 170), rowH = num(mi.row_h, 22), gap = num(mi.gap, 2);
  const event = mi.event || 'menuClick';
  const fill = normColor(mi.fill, [40, 44, 52, 255]);
  const hover = mi.hover === null ? null : normColor(mi.hover, [66, 72, 84, 255]);
  const highlight = normColor(mi.highlight, [120, 190, 255, 255]);
  const textColor = normColor(mi.text_color, [235, 238, 242, 255]);
  const textSize = num(mi.text_size, 13);
  const highlightName = mi.highlight_name || 'sel';
  const highlightWidth = num(mi.highlight_width, 6);
  const options = Array.isArray(mi.options) ? mi.options : [];
  if (!options.length) warnings.push('menu at (' + x + ',' + y + ') has no options; skipped');
  const step = rowH + gap;
  const items = [];
  options.forEach((label, i) => {
    items.push(makeItem('button', {
      x: Math.round(x), y: Math.round(y + i * step), w: width, h: rowH,
      event, arg: i, fill: fill.slice(),
      hover: hover ? hover.slice() : null,
      label: String(label), labelColor: textColor.slice(), labelSize: textSize,
    }));
  });
  if (options.length) {
    items.push(makeItem('clip', {
      name: uniqueClipName(highlightName), x: Math.round(x), y: Math.round(y),
      w: highlightWidth, h: rowH, color: highlight.slice(),
    }));
  }
  const yTrunc = Math.trunc(y), stepTrunc = Math.trunc(step);
  const scriptSnippet = options.length
    ? '// --- menu: ' + highlightName + ' ---\n'
      + 'function SetSelected(i) {\n'
      + '    _root.' + highlightName + '._y = ' + yTrunc + ' + (i * ' + stepTrunc + ');\n'
      + '}\n'
    : '';
  return { items, scriptSnippet };
}

function loadProjectFromObject(obj) {
  const warnings = [];
  if (!obj || typeof obj !== 'object') throw new Error('project must be a JSON object');
  const s = obj.stage || {};
  const stage = {
    width: Math.max(1, Math.round(num(s.width, 380))),
    height: Math.max(1, Math.round(num(s.height, 150))),
    fps: num(s.fps, 30),
    name: typeof s.name === 'string' && s.name ? s.name : 'movie',
    background: normColor(s.background, [22, 24, 28, 255]),
    fontName: typeof s.font_name === 'string' ? s.font_name : '_normal_Font',
    fontUrl: typeof s.font_url === 'string' ? s.font_url : '_normal_Font.swf',
    // Frames are declared as a list of labels; an entry may be null/"" for an
    // unlabelled frame that still exists on the timeline.
    frames: Array.isArray(s.frames)
      ? s.frames.map(f => (typeof f === 'string' ? f : (f && typeof f.label === 'string' ? f.label : '')))
      : [],
  };
  const frameCount = Math.max(1, stage.frames.length);

  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items = [];
  let scriptParts = [];

  rawItems.forEach((ri, idx) => {
    if (!ri || typeof ri !== 'object' || typeof ri.kind !== 'string') {
      warnings.push('item #' + idx + ' has no valid "kind"; skipped');
      return;
    }
    const hidden = !!ri.hidden;
    const posLocked = !!ri.lock_pos;
    const sizeLocked = !!ri.lock_size;
    // Placement extras every kind understands. `frames` indices outside the
    // declared range are dropped rather than rejected, so trimming the frame
    // list doesn't invalidate a whole project.
    const common = {
      frames: normItemFrames(ri.frames, frameCount),
      alpha: normAlpha(ri.alpha),
      events: normEvents(ri.events),
      exportAs: typeof ri.export === 'string' && ri.export ? ri.export : null,
      scale9: normScale9(ri.scale9),
    };
    if (common.events && ri.kind !== 'clip') {
      warnings.push('item #' + idx + ': event handlers only attach to "clip" items; ignored on a "' + ri.kind + '"');
      common.events = null;
    }
    if (ri.kind === 'rect') {
      items.push(makeItem('rect', {
        x: num(ri.x, 0), y: num(ri.y, 0), w: Math.max(1, num(ri.w, 10)), h: Math.max(1, num(ri.h, 10)),
        fill: normFill(ri.fill, [255, 255, 255, 255]),
        radius: Math.max(0, num(ri.radius, 0)),
        stroke: normStroke(ri.stroke),
        hidden, posLocked, sizeLocked, ...common,
      }));
    } else if (ri.kind === 'text') {
      items.push(makeItem('text', {
        x: num(ri.x, 0), y: num(ri.y, 0),
        text: typeof ri.text === 'string' ? ri.text : String(ri.text ?? ''),
        size: num(ri.size, 13),
        color: normColor(ri.color, [255, 255, 255, 255]),
        varName: typeof ri.var === 'string' ? ri.var : '',
        width: ri.width !== undefined ? num(ri.width, null) : null,
        height: ri.height !== undefined ? num(ri.height, null) : null,
        textOptions: normTextOptions(ri),
        hidden, posLocked, sizeLocked, ...common,
      }));
    } else if (ri.kind === 'button') {
      items.push(makeItem('button', {
        x: num(ri.x, 0), y: num(ri.y, 0), w: Math.max(1, num(ri.w, 10)), h: Math.max(1, num(ri.h, 10)),
        event: typeof ri.event === 'string' && ri.event ? ri.event : 'click',
        arg: ri.arg === undefined ? null : ri.arg,
        fill: normFill(ri.fill, [52, 58, 68, 255]),
        hover: ri.hover === null ? null : normFill(ri.hover, [74, 82, 96, 255]),
        label: typeof ri.label === 'string' ? ri.label : (ri.label ? String(ri.label) : ''),
        labelColor: normColor(ri.label_color, [235, 238, 242, 255]),
        labelSize: num(ri.label_size, 13),
        radius: Math.max(0, num(ri.radius, 0)),
        stroke: normStroke(ri.stroke),
        hidden, posLocked, sizeLocked, ...common,
      }));
    } else if (ri.kind === 'clip') {
      items.push(makeItem('clip', {
        x: num(ri.x, 0), y: num(ri.y, 0), w: Math.max(1, num(ri.w, 10)), h: Math.max(1, num(ri.h, 10)),
        name: typeof ri.name === 'string' && ri.name ? ri.name : uniqueClipName('clip'),
        color: normFill(ri.fill, [255, 255, 255, 255]),
        radius: Math.max(0, num(ri.radius, 0)),
        stroke: normStroke(ri.stroke),
        hidden, posLocked, sizeLocked, ...common,
      }));
    } else if (ri.kind === 'image') {
      if (typeof ri.data_url !== 'string' || !ri.data_url) {
        warnings.push('item #' + idx + ': image has no "data_url"; skipped');
      } else {
        items.push(makeItem('image', {
          x: num(ri.x, 0), y: num(ri.y, 0), w: Math.max(1, num(ri.w, 10)), h: Math.max(1, num(ri.h, 10)),
          dataUrl: ri.data_url, naturalWidth: num(ri.w, 60), naturalHeight: num(ri.h, 60),
          hidden, posLocked, sizeLocked, ...common,
        }));
      }
    } else if (ri.kind === 'menu') {
      const { items: menuItems, scriptSnippet } = expandMenuSpec(ri, warnings);
      for (const mi of menuItems) { mi.hidden = hidden; items.push(mi); } // menu-expanded items start unlocked
      if (scriptSnippet) scriptParts.push(scriptSnippet);
    } else {
      warnings.push('item #' + idx + ': unknown kind "' + ri.kind + '"; skipped');
    }
  });

  let script = typeof obj.script === 'string' ? obj.script : '';
  if (scriptParts.length) {
    script = script.trim() ? script.replace(/\s*$/, '\n\n') + scriptParts.join('\n') : scriptParts.join('\n');
  }

  return { stage, items, script, warnings };
}
