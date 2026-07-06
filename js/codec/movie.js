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

class Movie {
  // FONT_ID: the imported font's character id; content ids start above it.
  static FONT_ID = 1;

  constructor(width, height, {
    fps = 30, name = 'movie', background = [0, 0, 0],
    fontName = '_normal_Font', fontUrl = '_normal_Font.swf',
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
  }

  // -- content ------------------------------------------------------------

  // fill: [r,g,b,a] for solid, or {type:'linear'|'radial', direction, stops:
  // [{ratio,color}]} for a gradient. options: {radius (px corner radius),
  // stroke: {width, color}}. Omitting both keeps the exact original
  // plain-solid-rectangle output (see emitRectShape in _emitItem).
  rect(x, y, w, h, fill = [255, 255, 255], { radius = 0, stroke = null } = {}) {
    this._items.push({ kind: 'rect', x, y, w, h, fill: normalizeFill(fill), radius, stroke: normalizeStroke(stroke) });
    return this;
  }

  text(x, y, string, { size = 13, color = [255, 255, 255], varName = null, width = null } = {}) {
    this._needsFont = true;
    const w = width !== null ? width : Math.max(8, this.width - x - 4);
    this._items.push({
      kind: 'text', x, y, w, size, text: string, color: rgba(color), varName: varName || '',
    });
    return this;
  }

  button(x, y, w, h, event, {
    arg = null, fill = [52, 58, 68], hover = [74, 82, 96],
    label = null, labelColor = [235, 238, 242], labelSize = 13,
    radius = 0, stroke = null,
  } = {}) {
    if (label !== null) this._needsFont = true;
    this._items.push({
      kind: 'button', x, y, w, h, event, arg, fill: normalizeFill(fill),
      hover: hover ? normalizeFill(hover) : null, label, labelColor: rgba(labelColor), labelSize,
      radius, stroke: normalizeStroke(stroke),
    });
    return this;
  }

  clip(name, x, y, w, h, fill = [255, 255, 255], { radius = 0, stroke = null } = {}) {
    this._items.push({ kind: 'clip', name, x, y, w, h, color: normalizeFill(fill), radius, stroke: normalizeStroke(stroke) });
    return this;
  }

  // imageData: {width, height, data: Uint8ClampedArray/Uint8Array in RGBA
  // order} — typically a canvas ImageData object. Embedded losslessly via
  // DefineBitsLossless2; see js/codec/bitmap.js for the encoder and its
  // confidence notes (this is the one part of the codec without an
  // independent reference to check pixel-format correctness against).
  image(x, y, w, h, imageData) {
    this._items.push({ kind: 'image', x, y, w, h, imageData });
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

  script(scriptOrBytes) {
    const body = typeof scriptOrBytes.body === 'function' ? scriptOrBytes.body() : scriptOrBytes;
    this._script = concatBytes(this._script, body);
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
    let places = new Uint8Array(0);
    for (const it of this._items) {
      const r = this._emitItem(it, tags, places);
      tags = r.tags;
      places = r.places;
    }

    tags = concatBytes(tags, places);
    if (this._script.length) {
      tags = concatBytes(tags, swf.doAction(concatBytes(this._script, avm1.END)));
    }
    tags = concatBytes(tags, swf.SHOW_FRAME, swf.END);
    return swf.buildGfx(this.width, this.height, this.fps, tags);
  }

  _nextCid() {
    this._cid += 1;
    return this._cid;
  }

  _nextDepth() {
    this._depth += 1;
    return this._depth;
  }

  _emitItem(it, tags, places) {
    const kind = it.kind;
    if (kind === 'rect') {
      const cid = this._nextCid();
      tags = concatBytes(tags, emitRectShape(swf, cid, it.x, it.y, it.x + it.w, it.y + it.h, it.fill, it.radius, it.stroke));
      places = concatBytes(places, swf.placeObject(cid, this._nextDepth()));
    } else if (kind === 'text') {
      const cid = this._nextCid();
      tags = concatBytes(tags, swf.defineEditText(
        cid, it.x, it.y, it.x + it.w, it.y + it.size + 6,
        Movie.FONT_ID, it.size, it.text, it.color, it.varName
      ));
      places = concatBytes(places, swf.placeObject(cid, this._nextDepth()));
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
      const btn = this._nextCid();
      tags = concatBytes(tags, swf.defineButton(btn, records, action));
      places = concatBytes(places, swf.placeObject(btn, this._nextDepth()));
      if (it.label) {
        const lb = this._nextCid();
        const ly = y1 + Math.max(0, Math.floor((it.h - it.labelSize) / 2)) - 1;
        tags = concatBytes(tags, swf.defineEditText(
          lb, x1 + 6, ly, x2 - 2, y2, Movie.FONT_ID, it.labelSize, it.label, it.labelColor, ''
        ));
        places = concatBytes(places, swf.placeObject(lb, this._nextDepth()));
      }
    } else if (kind === 'clip') {
      const hl = this._nextCid();
      tags = concatBytes(tags, emitRectShape(swf, hl, 0, 0, it.w, it.h, it.color, it.radius, it.stroke));
      const sprite = this._nextCid();
      const control = concatBytes(swf.placeObject(hl, 1), swf.SHOW_FRAME, swf.END);
      tags = concatBytes(tags, swf.defineSprite(sprite, control));
      const matrix = encodeMatrix(px(it.x), px(it.y));
      places = concatBytes(places, swf.placeNamed(sprite, this._nextDepth(), it.name, matrix));
    } else if (kind === 'image') {
      // Bitmap is referenced here (inside a method body) rather than via a
      // top-level alias like the other modules use, because movie.js loads
      // before bitmap.js — a top-level `const bitmap = Bitmap` would run
      // immediately at load time and throw. Inside a method it's fine: this
      // only executes on build(), by which point everything has loaded.
      const bid = this._nextCid();
      tags = concatBytes(tags, Bitmap.defineBitsLossless2(bid, it.imageData.width, it.imageData.height, it.imageData));
      const scaleX = px(it.w) / it.imageData.width;
      const scaleY = px(it.h) / it.imageData.height;
      const matrix = encodeMatrix(px(it.x), px(it.y), [scaleX, scaleY]);
      places = concatBytes(places, swf.placeObject(bid, this._nextDepth(), matrix));
    }
    return { tags, places };
  }
}

  return { Movie };
})();
