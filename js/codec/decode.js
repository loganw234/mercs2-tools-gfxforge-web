// .gfx -> editor project decoder ("import / scrape existing movie").
//
// Best-effort recovery: it correlates definition tags (DefineShape3, EditText,
// Button, Sprite, ExternalImage/Gradient) with their PlaceObject2 placements and
// emits editor items (rect / text / button / clip) positioned by the placement
// matrix. Content GFx keeps *external* (images, gradients) can't be pixel-
// recovered from the .gfx alone, so those come back as labelled placeholders,
// and compiled AVM1 is reported but not decompiled. Everything unrecoverable is
// collected into `notes` for the UI to surface.
//
// Deliberately its own reader (not swf.js's writer) so it reads the spec fresh.
const Decode = (function() {

  class BitReader {
    constructor(bytes, byteOffset = 0) { this.b = bytes; this.pos = byteOffset; this.bit = 0; }
    ubits(n) { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((this.b[this.pos] >> (7 - this.bit)) & 1); if (++this.bit === 8) { this.bit = 0; this.pos++; } } return v >>> 0; }
    sbits(n) { const v = this.ubits(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
    align() { if (this.bit) { this.bit = 0; this.pos++; } }
    u8() { this.align(); return this.b[this.pos++]; }
    u16() { this.align(); const v = this.b[this.pos] | (this.b[this.pos + 1] << 8); this.pos += 2; return v; }
  }

  function readRect(r) {
    const nb = r.ubits(5);
    const xmin = r.sbits(nb), xmax = r.sbits(nb), ymin = r.sbits(nb), ymax = r.sbits(nb);
    r.align();
    return { xmin, xmax, ymin, ymax };
  }
  function readMatrix(r) {
    let scaleX = 1, scaleY = 1, rot0 = 0, rot1 = 0;
    if (r.ubits(1)) { const nb = r.ubits(5); scaleX = r.sbits(nb) / 65536; scaleY = r.sbits(nb) / 65536; }
    if (r.ubits(1)) { const nb = r.ubits(5); rot0 = r.sbits(nb) / 65536; rot1 = r.sbits(nb) / 65536; }
    const nb = r.ubits(5);
    const translateX = nb ? r.sbits(nb) : 0, translateY = nb ? r.sbits(nb) : 0;
    r.align();
    return { scaleX, scaleY, rot0, rot1, translateX, translateY };
  }
  function cstr(b, o) { let e = o; while (e < b.length && b[e] !== 0) e++; return { s: latin1(b.subarray(o, e)), next: e + 1 }; }
  function latin1(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; }
  function px(twips) { return Math.round(twips / 20); }

  // screen box (px) = placement matrix applied to a definition's twip bounds
  function screenBox(m, b) {
    const x1 = m.translateX + m.scaleX * b.xmin, x2 = m.translateX + m.scaleX * b.xmax;
    const y1 = m.translateY + m.scaleY * b.ymin, y2 = m.translateY + m.scaleY * b.ymax;
    return { x: px(Math.min(x1, x2)), y: px(Math.min(y1, y2)), w: px(Math.abs(x2 - x1)), h: px(Math.abs(y2 - y1)) };
  }

  // --- container ---
  function parseContainer(bytes) {
    const magic = latin1(bytes.subarray(0, 3));
    if (magic !== 'GFX' && magic !== 'FWS') {
      throw new Error(magic === 'CFX' || magic === 'CWS'
        ? 'compressed movie (CFX/CWS) — the importer inflates these before decoding'
        : 'not a GFX/SWF movie (magic ' + JSON.stringify(magic) + ')');
    }
    const r = new BitReader(bytes, 8);          // skip magic+version+filelen
    const stage = readRect(r);
    const fps = r.u16() >> 8;                    // 8.8 fixed
    r.u16();                                     // frame count
    const tags = [];
    let o = r.pos;
    while (o + 2 <= bytes.length) {
      const rh = bytes[o] | (bytes[o + 1] << 8); o += 2;
      const code = rh >> 6; let len = rh & 0x3f;
      if (len === 0x3f) { len = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24); o += 4; }
      tags.push({ code, body: bytes.subarray(o, o + len) });
      o += len;
      if (code === 0) break;
    }
    return { stage, fps, tags };
  }

  // --- definition decoders ---
  function decodeShape(body) {
    const r = new BitReader(body, 2);           // skip shapeId
    const bounds = readRect(r);
    let o = r.pos;
    const nFills = body[o++];
    let fill = [200, 200, 200, 255], wasGradient = false;
    for (let i = 0; i < nFills; i++) {
      const t = body[o++];
      if (t === 0x00) { if (i === 0) fill = [body[o], body[o + 1], body[o + 2], body[o + 3]]; o += 4; }
      else if (t === 0x10 || t === 0x12) {      // gradient: skip matrix + stops, keep first stop color
        const mr = new BitReader(body, o); readMatrix(mr); o = mr.pos;
        const nStops = body[o++] & 0x0f;
        if (i === 0 && nStops) fill = [body[o + 1], body[o + 2], body[o + 3], body[o + 4]];
        o += nStops * 5; wasGradient = true;
      } else return { bounds, fill, stroke: null, wasGradient, complex: true };
    }
    const nLines = body[o++];
    let stroke = null;
    for (let i = 0; i < nLines; i++) {
      const w = body[o] | (body[o + 1] << 8); const col = [body[o + 2], body[o + 3], body[o + 4], body[o + 5]]; o += 6;
      if (i === 0) stroke = { width: px(w), color: col };
    }
    return { bounds, fill, stroke, wasGradient, complex: false };
  }

  const EDIT = { HasText: 0x80, HasTextColor: 0x04, HasMaxLength: 0x02, HasFont: 0x01 };
  const EDIT2 = { HasFontClass: 0x80, HasLayout: 0x20 };
  function decodeEditText(body) {
    const r = new BitReader(body, 2);
    const bounds = readRect(r);
    let o = r.pos;
    const b0 = body[o++], b1 = body[o++];
    let size = 13;
    if (b0 & EDIT.HasFont) { o += 2; size = px(body[o] | (body[o + 1] << 8)); o += 2; }
    if (b1 & EDIT2.HasFontClass) { o = cstr(body, o).next; }
    let color = [255, 255, 255, 255];
    if (b0 & EDIT.HasTextColor) { color = [body[o], body[o + 1], body[o + 2], body[o + 3]]; o += 4; }
    if (b0 & EDIT.HasMaxLength) o += 2;
    if (b1 & EDIT2.HasLayout) o += 1 + 2 + 2 + 2 + 2;
    const vn = cstr(body, o); o = vn.next;
    let text = '';
    if (b0 & EDIT.HasText) text = cstr(body, o).s;
    return { bounds, size, color, text, varName: vn.s };
  }

  function decodeButton(body) {                 // tag 7
    let o = 2;                                  // skip buttonId
    let upChar = null;
    while (body[o] !== 0 && o < body.length) {
      o++;                                      // flags
      const charId = body[o] | (body[o + 1] << 8); o += 2;
      o += 2;                                   // depth
      const mr = new BitReader(body, o); readMatrix(mr); o = mr.pos;
      if (upChar === null) upChar = charId;
    }
    o++;                                        // end-of-records 0
    const actions = body.subarray(o);           // AVM1: look for the fscommand string
    const s = latin1(actions);
    const m = s.match(/FSCommand:([^\x00]*)/);
    return { upChar, event: m ? m[1] : 'click' };
  }

  function decodeSprite(body) {                 // tag 39 -> its inner placements (for recursion)
    // [spriteId u16][frameCount u16][control tags...]
    const placements = [];
    let o = 4;
    while (o + 2 <= body.length) {
      const rh = body[o] | (body[o + 1] << 8); o += 2;
      const code = rh >> 6; let len = rh & 0x3f;
      if (len === 0x3f) { len = body[o] | (body[o + 1] << 8) | (body[o + 2] << 16) | (body[o + 3] << 24); o += 4; }
      if (code === 26) { try { placements.push(decodePlace(body.subarray(o, o + len))); } catch (e) { /* skip */ } }
      if (code === 0) break;
      o += len;
    }
    return { placements };
  }

  function decodePlace(body) {                   // tag 26
    const flags = body[0]; let o = 1;
    const depth = body[o] | (body[o + 1] << 8); o += 2;
    let charId = null, name = null, matrix = { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
    if (flags & 0x02) { charId = body[o] | (body[o + 1] << 8); o += 2; }
    if (flags & 0x04) { const r = new BitReader(body, o); matrix = readMatrix(r); o = r.pos; }
    if (flags & 0x08) { const r = new BitReader(body, o); if (r.ubits(1)) { const n = r.ubits(4); r.ubits(n * 4); } if (r.ubits(1)) { const n = r.ubits(4); r.ubits(n * 4); } r.align(); o = r.pos; }  // cxform
    if (flags & 0x10) o += 2;                    // ratio
    if (flags & 0x20) { const c = cstr(body, o); name = c.s; o = c.next; }
    return { depth, charId, name, matrix };
  }

  function exporterName(body) { try { const n = body[9]; return latin1(body.subarray(10, 10 + n)); } catch (e) { return 'imported'; } }

  // --- orchestration ---
  function decodeGfx(bytes) {
    const { stage, fps, tags } = parseContainer(bytes);
    const defs = new Map();
    const placements = [];
    const notes = [];
    let name = 'imported';
    let scriptBytes = 0;

    for (const { code, body } of tags) {
      try {
        if (code === 1000) name = exporterName(body) || 'imported';
        else if (code === 32 || code === 22 || code === 2) { defs.set(body[0] | (body[1] << 8), { kind: 'shape', ...decodeShape(body) }); }
        else if (code === 37) { defs.set(body[0] | (body[1] << 8), { kind: 'text', ...decodeEditText(body) }); }
        else if (code === 7 || code === 34) { defs.set(body[0] | (body[1] << 8), { kind: 'button', ...decodeButton(body) }); }
        else if (code === 39) { defs.set(body[0] | (body[1] << 8), { kind: 'sprite', ...decodeSprite(body) }); }
        else if (code === 1001 || code === 1007 || code === 6 || code === 20 || code === 36) { defs.set(body[0] | (body[1] << 8), { kind: 'image' }); }
        else if (code === 1003) { defs.set(body[0] | (body[1] << 8), { kind: 'gradient' }); }
        else if (code === 26) placements.push(decodePlace(body));
        else if (code === 12) scriptBytes += body.length;
      } catch (e) { notes.push('tag ' + code + ': ' + e.message); }
    }

    // Walk the display list, recursing into sprites (with composed transforms) so
    // nested movieclip content is flattened out. A named single-shape sprite is
    // our own clip() primitive, so keep it editable as a clip instead.
    const IDENTITY = { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
    const compose = (P, C) => ({
      scaleX: P.scaleX * C.scaleX, scaleY: P.scaleY * C.scaleY,
      translateX: P.translateX + P.scaleX * C.translateX,
      translateY: P.translateY + P.scaleY * C.translateY,
    });
    const items = [];
    const stat = { ext: 0, gradFlat: 0, approx: 0 };

    function emit(def, M) {
      const box = def.bounds ? screenBox(M, def.bounds) : { x: px(M.translateX), y: px(M.translateY), w: 48, h: 48 };
      if (def.kind === 'shape') {
        if (box.w <= 0 || box.h <= 0) return;
        const it = { kind: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: def.fill };
        if (def.stroke) it.stroke = def.stroke;
        items.push(it);
        if (def.wasGradient) stat.gradFlat++;
        if (def.complex) stat.approx++;
      } else if (def.kind === 'text') {
        const it = { kind: 'text', x: box.x, y: box.y, width: box.w, size: def.size, color: def.color, text: def.text };
        if (def.varName) it.var = def.varName;
        items.push(it);
      } else if (def.kind === 'button') {
        const shape = defs.get(def.upChar);
        const bb = shape ? screenBox(M, shape.bounds) : box;
        items.push({ kind: 'button', x: bb.x, y: bb.y, w: bb.w || 80, h: bb.h || 24, event: def.event, fill: shape ? shape.fill : [52, 58, 68, 255], hover: null });
      } else if (def.kind === 'image' || def.kind === 'gradient') {
        stat.ext++;
        items.push({ kind: 'rect', x: box.x, y: box.y, w: box.w || 48, h: box.h || 48, fill: def.kind === 'image' ? [255, 0, 255, 110] : [255, 200, 0, 110] });
      }
    }

    function walk(pl, parentM, depth) {
      if (depth > 8) return;
      for (const p of pl) {
        if (p.charId === null) continue;
        const def = defs.get(p.charId);
        if (!def) continue;
        const M = compose(parentM, p.matrix);
        if (def.kind === 'sprite') {
          const inner = def.placements.length === 1 ? defs.get(def.placements[0].charId) : null;
          if (p.name && inner && inner.kind === 'shape') {          // our clip() primitive — keep editable
            const box = screenBox(M, inner.bounds);
            items.push({ kind: 'clip', name: p.name, x: box.x, y: box.y, w: box.w || 60, h: box.h || 12, fill: inner.fill });
          } else {
            walk(def.placements, M, depth + 1);                     // flatten nested movieclip content
          }
        } else {
          try { emit(def, M); } catch (e) { notes.push('char ' + p.charId + ': ' + e.message); }
        }
      }
    }
    walk(placements, IDENTITY, 0);

    if (stat.gradFlat) notes.push(stat.gradFlat + ' gradient fill(s) flattened to their first colour');
    if (stat.approx) notes.push(stat.approx + ' non-rectangular shape(s) approximated as their bounding rect');
    if (stat.ext) notes.push(stat.ext + ' external image/gradient asset(s) shown as translucent placeholders — the pixels/ramps live in separate WAD assets, not the .gfx');
    if (scriptBytes) notes.push(scriptBytes + ' bytes of ActionScript (AVM1) present — not decompiled');

    const project = {
      version: 1,
      stage: { width: px(stage.xmax - stage.xmin) || 380, height: px(stage.ymax - stage.ymin) || 150, fps: fps || 30, name },
      items,
      script: '',
    };
    return { project, notes };
  }

  return { decodeGfx, _internal: { parseContainer, decodeShape, decodeEditText, BitReader } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Decode;
