const GFMovie = (function() {
// Port of gfxforge/movie.py — the ergonomic authoring API. A Movie collects
// rectangles, text, buttons and (optionally) a selectable menu, plus AVM1
// behaviour, then emits a ready-to-inject .gfx.
//
// Items paint in the order added (later on top). Character ids and depths are
// assigned automatically at build time.

const swf = Swf;
const avm1 = Avm1;
const bitio = Bitio;
const { concatBytes } = swf._internal;
const { encodeMatrix, px } = bitio;

function rgba(c) {
  return [c[0], c[1], c[2], c.length > 3 ? c[3] : 255];
}

function normalizeFill(fill) {
  if (Array.isArray(fill)) return rgba(fill);
  return { type: fill.type, direction: fill.direction, stops: fill.stops.map(s => ({ ratio: s.ratio, color: rgba(s.color) })) };
}

function normalizeStroke(stroke) {
  if (!stroke) return null;
  return { width: stroke.width, color: rgba(stroke.color) };
}

// Uses the plain, byte-for-byte-verified defineShape3 path whenever nothing
// new is actually in use (solid fill, no radius, no stroke) — so existing
// output for existing content is provably unaffected — and only reaches for
// the newer, less-independently-verified defineShapeEx otherwise.
function emitRectShape(swf, cid, x1, y1, x2, y2, fill, radius, stroke) {
  if (Array.isArray(fill) && !radius && !stroke) {
    return swf.defineShape3(cid, x1, y1, x2, y2, fill);
  }
  return swf.defineShapeEx(cid, x1, y1, x2, y2, { fill, radius: radius || 0, stroke: stroke || null });
}

// Normalises an item's frame membership. `null`/absent means "on every frame",
// which is both the sensible default for backdrop content and what keeps
// single-frame projects behaving exactly as they did before frames existed.
function normalizeFrames(frames) {
  if (frames === null || frames === undefined) return null;
  if (!Array.isArray(frames)) return [Math.max(0, Math.trunc(Number(frames)) || 0)];
  const out = frames.map(f => Math.max(0, Math.trunc(Number(f)) || 0));
  return out.length ? Array.from(new Set(out)).sort((a, b) => a - b) : null;
}

function normalizeEvents(events) {
  if (!events || typeof events !== 'object') return null;
  const out = [];
  for (const [name, source] of Object.entries(events)) {
    if (typeof source === 'string' ? !source.trim() : !source) continue;
    out.push({ event: name, source });
  }
  return out.length ? out : null;
}

class Movie {
  // FONT_ID: the imported font's character id; content ids start above it.
  static FONT_ID = 1;

  constructor(width, height, {
    fps = 30, name = 'movie', background = [0, 0, 0],
    fontName = '_normal_Font', fontUrl = '_normal_Font.swf',
    frames = null, stopAtStart = null,
  } = {}) {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.name = name;
    this.background = background;
    this.fontName = fontName;
    this.fontUrl = fontUrl;
    this._items = [];
    this._script = new Uint8Array(0);
    this._needsFont = false;
    // Frame metadata: one entry per frame, each { label }. A movie with no
    // declared frames is a single unlabelled frame, exactly as before.
    this._frames = [];
    this._frameScripts = new Map();   // frame index -> AVM1 bytes
    this._exports = [];               // [{ name, itemIndex }]
    if (frames) this.setFrames(frames);
    // A multi-frame movie loops forever unless told otherwise, which is almost
    // never what a state-machine HUD wants. Defaults to stopping when there is
    // more than one frame, and never overrides an explicit choice.
    this._stopAtStart = stopAtStart;
  }

  // frames: ['idle', 'alert'] or [{label:'idle'}, {}]
  setFrames(frames) {
    this._frames = frames.map(f => (typeof f === 'string' ? { label: f } : { label: f.label || null }));
    return this;
  }

  frameCount() {
    return Math.max(1, this._frames.length);
  }

  // Exports the most recently added item under a public symbol name, so script
  // can attachMovie() it. Only sprite-backed items (clips) are meaningful
  // targets, since that's what attachMovie instantiates.
  exportAs(symbolName) {
    if (!this._items.length) throw new Error('exportAs() needs an item to export');
    this._exports.push({ name: symbolName, itemIndex: this._items.length - 1 });
    return this;
  }

  // -- content ------------------------------------------------------------

  // fill: [r,g,b,a] for solid, or {type:'linear'|'radial', direction, stops:
  // [{ratio,color}]} for a gradient. options: {radius (px corner radius),
  // stroke: {width, color}}. Omitting both keeps the exact original
  // plain-solid-rectangle output (see emitRectShape in _emitItem).
  rect(x, y, w, h, fill = [255, 255, 255], { radius = 0, stroke = null, frames = null, alpha = null, name = null } = {}) {
    this._items.push({
      kind: 'rect', x, y, w, h, fill: normalizeFill(fill), radius, stroke: normalizeStroke(stroke),
      frames: normalizeFrames(frames), alpha, name,
    });
    return this;
  }

  // Text options beyond the original size/color/varName/width now cover the
  // DefineEditText flags the format supports — multiline, wordWrap, html,
  // border, align, selectable and friends. Omitting them all reproduces the
  // previous single-line read-only field byte for byte.
  // `name` gives the placed field an instance name, so script can reach the
  // field object itself (`_root.hp_txt.text`, `.textWidth`, `.setTextFormat`)
  // rather than only its bound variable's value. The game's own movies work
  // this way — `text_txt` and `text_mc` are among the most common identifiers
  // across the shipped UI.
  text(x, y, string, {
    size = 13, color = [255, 255, 255], varName = null, width = null,
    height = null, frames = null, alpha = null, name = null,
    multiline = false, wordWrap = false, html = false, border = false,
    selectable = false, align = null, leading = 0, maxLength = null,
  } = {}) {
    this._needsFont = true;
    const w = width !== null ? width : Math.max(8, this.width - x - 4);
    this._items.push({
      kind: 'text', x, y, w, h: height, size, text: string, color: rgba(color),
      varName: varName || '', frames: normalizeFrames(frames), alpha, name,
      textOptions: { multiline, wordWrap, html, border, selectable, align, leading, maxLength },
    });
    return this;
  }

  button(x, y, w, h, event, {
    arg = null, fill = [52, 58, 68], hover = [74, 82, 96],
    label = null, labelColor = [235, 238, 242], labelSize = 13,
    radius = 0, stroke = null, frames = null,
  } = {}) {
    if (label !== null) this._needsFont = true;
    this._items.push({
      kind: 'button', x, y, w, h, event, arg, fill: normalizeFill(fill),
      hover: hover ? normalizeFill(hover) : null, label, labelColor: rgba(labelColor), labelSize,
      radius, stroke: normalizeStroke(stroke), frames: normalizeFrames(frames),
    });
    return this;
  }

  // `events` attaches AS2 handlers to the placed clip:
  //   { release: 'fscommand("fire", 1);', rollOver: '...' }
  // Sources are compiled at build time. This is the interactive primitive the
  // shipped game movies actually use — see the note on clipActions in swf.js.
  clip(name, x, y, w, h, fill = [255, 255, 255], {
    radius = 0, stroke = null, frames = null, alpha = null, events = null,
    scale9 = null,
  } = {}) {
    this._items.push({
      kind: 'clip', name, x, y, w, h, color: normalizeFill(fill), radius,
      stroke: normalizeStroke(stroke), frames: normalizeFrames(frames), alpha,
      events: normalizeEvents(events), scale9,
    });
    return this;
  }

  // imageData: {width, height, data: Uint8ClampedArray/Uint8Array in RGBA
  // order} — typically a canvas ImageData object. Embedded losslessly via
  // DefineBitsLossless2; see js/codec/bitmap.js for the encoder and its
  // confidence notes (this is the one part of the codec without an
  // independent reference to check pixel-format correctness against).
  image(x, y, w, h, imageData, { frames = null, alpha = null } = {}) {
    this._items.push({ kind: 'image', x, y, w, h, imageData, frames: normalizeFrames(frames), alpha });
    return this;
  }

  menu(x, y, options, {
    width = 170, rowH = 22, gap = 2, event = 'menuClick',
    fill = [40, 44, 52], hover = [66, 72, 84], highlight = [120, 190, 255],
    textColor = [235, 238, 242], textSize = 13, highlightName = 'sel',
    highlightWidth = 6,
  } = {}) {
    this._needsFont = true;
    const step = rowH + gap;
    options.forEach((label, i) => {
      this.button(x, y + i * step, width, rowH, event, {
        arg: i, fill, hover, label, labelColor: textColor, labelSize: textSize,
      });
    });
    this.clip(highlightName, x, y, highlightWidth, rowH, highlight);
    // SetSelected(i): _root.<name>._y = y + i*step  (pixels)
    const value = concatBytes(
      avm1.push(Math.trunc(y)), avm1.var('i'), avm1.push(Math.trunc(step)), avm1.MULTIPLY, avm1.ADD2
    );
    const target = avm1.getMember(avm1.root(), highlightName);
    const body = avm1.setMember(target, '_y', value);
    this._script = concatBytes(this._script, avm1.defineFunction('SetSelected', ['i'], body));
    return {
      selectFn: 'SetSelected', event, count: options.length,
      labels: options.slice(), highlight: highlightName,
    };
  }

  // Frame 0's script by default; pass a frame index to attach actions to a
  // later frame instead.
  script(scriptOrBytes, frameIndex = null) {
    const body = typeof scriptOrBytes.body === 'function' ? scriptOrBytes.body() : scriptOrBytes;
    if (frameIndex === null || frameIndex === 0) {
      this._script = concatBytes(this._script, body);
    } else {
      const prev = this._frameScripts.get(frameIndex) || new Uint8Array(0);
      this._frameScripts.set(frameIndex, concatBytes(prev, body));
    }
    return this;
  }

  // -- output -------------------------------------------------------------

  build() {
    let tags = concatBytes(
      swf.exporterInfo(this.name),
      swf.fileAttributes(),
      swf.setBackgroundColor(this.background)
    );
    if (this._needsFont) {
      tags = concatBytes(tags, swf.importFont(this.fontUrl, Movie.FONT_ID, this.fontName));
    }

    this._cid = Movie.FONT_ID;
    this._depth = 0;

    // Pass 1: emit every definition tag up front and record what each item
    // needs placed, at which depth. Depths are assigned once and stay fixed
    // for the whole timeline, so a re-place on a later frame lands on the same
    // slot and a RemoveObject2 targets the right thing.
    const placements = [];   // [{ item, tags: Uint8Array[] }] in item order
    for (const it of this._items) {
      const r = this._emitItem(it, tags, new Uint8Array(0));
      tags = r.tags;
      placements.push({ item: it, places: r.places, charIds: r.charIds || [] });
    }

    // ExportAssets, so script can attachMovie() the named symbols.
    if (this._exports.length) {
      const entries = [];
      for (const ex of this._exports) {
        const p = placements[ex.itemIndex];
        const id = p && p.charIds.length ? p.charIds[p.charIds.length - 1] : null;
        if (id !== null) entries.push({ id, name: ex.name });
      }
      if (entries.length) tags = concatBytes(tags, swf.exportAssets(entries));
    }

    const frameCount = this.frameCount();
    const isMultiFrame = frameCount > 1;

    // Which item indices are visible on a given frame. `frames: null` means
    // every frame.
    const visibleOn = (f) => {
      const set = new Set();
      placements.forEach((p, i) => {
        const fr = p.item.frames;
        // an item built through a path that never set `frames` is on every
        // frame, same as an explicit null
        if (!fr || fr.indexOf(f) >= 0) set.add(i);
      });
      return set;
    };

    // Pass 2: walk the timeline, diffing each frame against the previous one.
    let prev = new Set();
    for (let f = 0; f < frameCount; f++) {
      const meta = this._frames[f];
      if (meta && meta.label) tags = concatBytes(tags, swf.frameLabel(meta.label));

      const now = visibleOn(f);
      // Anything that was on the previous frame and isn't on this one has to
      // be explicitly removed — a placed object otherwise persists.
      for (const i of prev) {
        if (!now.has(i)) {
          for (const d of (placements[i].item.depths || [])) tags = concatBytes(tags, swf.removeObject2(d));
        }
      }
      for (const i of now) {
        if (!prev.has(i)) tags = concatBytes(tags, placements[i].places);
      }

      // Frame actions. Frame 0 additionally gets an implicit stop() on a
      // multi-frame movie, so a state-machine HUD sits on its first state
      // instead of cycling through every frame forever.
      let frameScript = f === 0 ? this._script : (this._frameScripts.get(f) || new Uint8Array(0));
      const wantStop = this._stopAtStart === null ? isMultiFrame : this._stopAtStart;
      if (f === 0 && wantStop) frameScript = concatBytes(avm1.STOP, frameScript);
      if (frameScript.length) {
        tags = concatBytes(tags, swf.doAction(concatBytes(frameScript, avm1.END)));
      }

      tags = concatBytes(tags, swf.SHOW_FRAME);
      prev = now;
    }

    tags = concatBytes(tags, swf.END);
    return swf.buildGfx(this.width, this.height, this.fps, tags, frameCount);
  }

  _nextCid() {
    this._cid += 1;
    return this._cid;
  }

  _nextDepth() {
    this._depth += 1;
    return this._depth;
  }

  // Emits an item's definition tags and its placement tags. `it.depths`
  // records every depth the item occupies so the timeline can remove it again
  // on a frame where it isn't present; `charIds` feeds ExportAssets.
  //
  // Placement uses the plain placeObject()/placeNamed() path whenever nothing
  // new is in play, keeping existing output byte-identical, and only reaches
  // for the fuller placeObject2() when alpha or event handlers are present.
  _emitItem(it, tags, places) {
    const kind = it.kind;
    it.depths = [];
    const charIds = [];
    const cx = (it.alpha === null || it.alpha === undefined) ? null : swf.alphaCxform(it.alpha);

    const place = (cid, matrix, name) => {
      const depth = this._nextDepth();
      it.depths.push(depth);
      if (!cx && !name) return swf.placeObject(cid, depth, matrix || swf.IDENTITY_MATRIX);
      if (!cx && name) return swf.placeNamed(cid, depth, name, matrix || swf.IDENTITY_MATRIX);
      return swf.placeObject2({
        charId: cid, depth, matrix: matrix || swf.IDENTITY_MATRIX, name: name || null, cxform: cx,
      });
    };

    if (kind === 'rect') {
      const cid = this._nextCid(); charIds.push(cid);
      tags = concatBytes(tags, emitRectShape(swf, cid, it.x, it.y, it.x + it.w, it.y + it.h, it.fill, it.radius, it.stroke));
      places = concatBytes(places, place(cid, null, it.name || null));
    } else if (kind === 'text') {
      const cid = this._nextCid(); charIds.push(cid);
      const opts = it.textOptions || {};
      // A multiline field needs real height; a single-line one keeps the
      // original one-line-plus-padding box so existing output is unchanged.
      const bottom = it.h != null ? it.y + it.h : it.y + it.size + 6;
      tags = concatBytes(tags, swf.defineEditText(
        cid, it.x, it.y, it.x + it.w, bottom,
        Movie.FONT_ID, it.size, it.text, it.color, it.varName, opts
      ));
      places = concatBytes(places, place(cid, null, it.name || null));
    } else if (kind === 'button') {
      const x1 = it.x, y1 = it.y, x2 = it.x + it.w, y2 = it.y + it.h;
      const up = this._nextCid();
      tags = concatBytes(tags, emitRectShape(swf, up, x1, y1, x2, y2, it.fill, it.radius, it.stroke));
      let records;
      if (it.hover) {
        const ov = this._nextCid();
        tags = concatBytes(tags, emitRectShape(swf, ov, x1, y1, x2, y2, it.hover, it.radius, it.stroke));
        records = [
          [swf.BTN_UP | swf.BTN_HIT, up, 1, swf.IDENTITY_MATRIX],
          [swf.BTN_OVER | swf.BTN_DOWN, ov, 1, swf.IDENTITY_MATRIX],
        ];
      } else {
        records = [[swf.BTN_UP | swf.BTN_OVER | swf.BTN_DOWN | swf.BTN_HIT, up, 1, swf.IDENTITY_MATRIX]];
      }
      const arg = it.arg !== null ? avm1.push(it.arg) : avm1.push('');
      const action = avm1.fscommand(it.event, arg);
      const btn = this._nextCid(); charIds.push(btn);
      tags = concatBytes(tags, swf.defineButton(btn, records, action));
      places = concatBytes(places, place(btn));
      if (it.label) {
        const lb = this._nextCid();
        const ly = y1 + Math.max(0, Math.floor((it.h - it.labelSize) / 2)) - 1;
        tags = concatBytes(tags, swf.defineEditText(
          lb, x1 + 6, ly, x2 - 2, y2, Movie.FONT_ID, it.labelSize, it.label, it.labelColor, ''
        ));
        places = concatBytes(places, place(lb));
      }
    } else if (kind === 'clip') {
      const hl = this._nextCid();
      tags = concatBytes(tags, emitRectShape(swf, hl, 0, 0, it.w, it.h, it.color, it.radius, it.stroke));
      const sprite = this._nextCid(); charIds.push(sprite);
      const control = concatBytes(swf.placeObject(hl, 1), swf.SHOW_FRAME, swf.END);
      tags = concatBytes(tags, swf.defineSprite(sprite, control));
      // 9-slice guides, so a panel's corners keep their size when scaled.
      // Applies to the sprite, and is given in coordinates local to it.
      if (it.scale9) {
        const g = it.scale9;
        tags = concatBytes(tags, swf.defineScale9Grid(sprite, g.left, g.top, g.right, g.bottom));
      }
      const matrix = encodeMatrix(px(it.x), px(it.y));
      if (it.events) {
        // Compiled here rather than at clip() time so a handler's source can
        // be edited right up until build, and so compile errors surface with
        // everything else's.
        const handlers = it.events.map(h => ({
          events: [h.event],
          actions: typeof h.source === 'string' ? Compiler.compileSource(h.source) : h.source,
        }));
        const depth = this._nextDepth();
        it.depths.push(depth);
        places = concatBytes(places, swf.placeObject2({
          charId: sprite, depth, matrix, name: it.name, cxform: cx,
          clipActions: swf.clipActions(handlers),
        }));
      } else {
        places = concatBytes(places, place(sprite, matrix, it.name));
      }
    } else if (kind === 'image') {
      // Bitmap is referenced here (inside a method body) rather than via a
      // top-level alias like the other modules use, because movie.js loads
      // before bitmap.js — a top-level `const bitmap = Bitmap` would run
      // immediately at load time and throw. Inside a method it's fine: this
      // only executes on build(), by which point everything has loaded.
      const bid = this._nextCid(); charIds.push(bid);
      tags = concatBytes(tags, Bitmap.defineBitsLossless2(bid, it.imageData.width, it.imageData.height, it.imageData));
      const scaleX = px(it.w) / it.imageData.width;
      const scaleY = px(it.h) / it.imageData.height;
      const matrix = encodeMatrix(px(it.x), px(it.y), [scaleX, scaleY]);
      places = concatBytes(places, place(bid, matrix));
    }
    return { tags, places, charIds };
  }
}

  return { Movie };
})();
