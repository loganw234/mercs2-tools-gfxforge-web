// Test-only decoder for DefineShape3-family tag bodies. Deliberately
// independent of swf.js's encoder logic (reads the spec fields fresh) so
// agreement between the two is meaningful, not circular.
class BitReader {
  constructor(bytes, byteOffset = 0) {
    this.bytes = bytes;
    this.bytePos = byteOffset;
    this.bitPos = 0; // 0..7, MSB-first within each byte (matches BitWriter)
  }
  ubits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const bit = (this.bytes[this.bytePos] >> (7 - this.bitPos)) & 1;
      v = (v << 1) | bit;
      this.bitPos += 1;
      if (this.bitPos === 8) { this.bitPos = 0; this.bytePos += 1; }
    }
    return v >>> 0;
  }
  sbits(n) {
    const v = this.ubits(n);
    const signBit = 1 << (n - 1);
    return (v & signBit) ? v - (1 << n) : v;
  }
  alignByte() {
    if (this.bitPos !== 0) { this.bitPos = 0; this.bytePos += 1; }
  }
  u8() { this.alignByte(); return this.bytes[this.bytePos++]; }
  u16() { this.alignByte(); const v = this.bytes[this.bytePos] | (this.bytes[this.bytePos + 1] << 8); this.bytePos += 2; return v; }
}

function decodeRectHeader(bytes) {
  const r = new BitReader(bytes);
  const nb = r.ubits(5);
  const xmin = r.sbits(nb), xmax = r.sbits(nb), ymin = r.sbits(nb), ymax = r.sbits(nb);
  r.alignByte();
  return { xmin, xmax, ymin, ymax, nextByteOffset: r.bytePos };
}

function decodeMatrix(r) {
  let scaleX = 1, scaleY = 1;
  if (r.ubits(1)) {
    const nb = r.ubits(5);
    scaleX = r.sbits(nb) / 65536;
    scaleY = r.sbits(nb) / 65536;
  }
  let rotateSkew0 = 0, rotateSkew1 = 0;
  if (r.ubits(1)) {
    const nb = r.ubits(5);
    rotateSkew0 = r.sbits(nb) / 65536;
    rotateSkew1 = r.sbits(nb) / 65536;
  }
  const tNb = r.ubits(5);
  const translateX = tNb ? r.sbits(tNb) : 0;
  const translateY = tNb ? r.sbits(tNb) : 0;
  return { scaleX, scaleY, rotateSkew0, rotateSkew1, translateX, translateY };
}

// Decodes a DefineShape3-shaped tag body (id, rect, fillstyles, linestyles,
// numFill/LineBits, shape records) into a plain structure for assertions.
function decodeShape3Body(body) {
  const shapeId = body[0] | (body[1] << 8);
  const rectInfo = decodeRectHeader(body.subarray(2));
  let off = 2 + rectInfo.nextByteOffset;

  const fillStyleCount = body[off]; off += 1;
  const fillStyles = [];
  for (let i = 0; i < fillStyleCount; i++) {
    const type = body[off]; off += 1;
    if (type === 0x00) {
      const color = [body[off], body[off + 1], body[off + 2], body[off + 3]]; off += 4;
      fillStyles.push({ type: 'solid', color });
    } else if (type === 0x10 || type === 0x12) {
      // MATRIX is bit-packed but individually byte-flushed at its end (same
      // convention as RECT, and as encodeMatrix()/encodeMatrixFull() already
      // use elsewhere in this codebase) — decode it properly rather than
      // assuming a fixed byte width, since its length varies with the
      // scale/rotate/translate bit-widths actually needed.
      const mr = new BitReader(body, off);
      const matrix = decodeMatrix(mr);
      mr.alignByte();
      off = mr.bytePos;
      const specByte = body[off]; off += 1;
      const spreadMode = (specByte >> 6) & 0x3, interp = (specByte >> 4) & 0x3, numGrad = specByte & 0xf;
      const stops = [];
      for (let g = 0; g < numGrad; g++) {
        const ratio = body[off]; off += 1;
        const color = [body[off], body[off + 1], body[off + 2], body[off + 3]]; off += 4;
        stops.push({ ratio, color });
      }
      fillStyles.push({ type: type === 0x10 ? 'linear' : 'radial', matrix, spreadMode, interp, stops });
    } else {
      throw new Error(`decoder: unsupported fill style type 0x${type.toString(16)} (extend the test decoder if this is intentional)`);
    }
  }

  const lineStyleCount = body[off]; off += 1;
  const lineStyles = [];
  for (let i = 0; i < lineStyleCount; i++) {
    const width = body[off] | (body[off + 1] << 8); off += 2;
    const color = [body[off], body[off + 1], body[off + 2], body[off + 3]]; off += 4;
    lineStyles.push({ width, color });
  }

  const r = new BitReader(body, off);
  const numFillBits = r.ubits(4), numLineBits = r.ubits(4);

  // Walk shape records, reconstructing an absolute path plus which style
  // indices were active. We only need to support what our own encoder can
  // produce: one style-change (move + select fill/line) then straight
  // and/or curved edges, ending at EndShapeRecord.
  let x = 0, y = 0;
  const path = []; // {type:'move'|'line'|'curve', ...absolute coords}
  let fillStyle1 = 0, lineStyle = 0;
  for (;;) {
    const first = r.ubits(1);
    if (first === 0) {
      // could be a style-change record or EndShapeRecord (all-zero flags)
      const stateNewStyles = r.ubits(1);
      const stateLineStyle = r.ubits(1);
      const stateFillStyle1 = r.ubits(1);
      const stateFillStyle0 = r.ubits(1);
      const stateMoveTo = r.ubits(1);
      if (!stateNewStyles && !stateLineStyle && !stateFillStyle1 && !stateFillStyle0 && !stateMoveTo) {
        break; // EndShapeRecord
      }
      if (stateMoveTo) {
        const moveBits = r.ubits(5);
        x = r.sbits(moveBits); y = r.sbits(moveBits);
        path.push({ type: 'move', x, y });
      }
      if (stateFillStyle0) r.ubits(numFillBits);
      if (stateFillStyle1) fillStyle1 = r.ubits(numFillBits);
      if (stateLineStyle) lineStyle = r.ubits(numLineBits);
      if (stateNewStyles) throw new Error('decoder: StateNewStyles not supported (encoder never emits it)');
    } else {
      const straightFlag = r.ubits(1);
      const numBits = r.ubits(4) + 2;
      if (straightFlag) {
        const generalLine = r.ubits(1);
        let dx = 0, dy = 0;
        if (generalLine) { dx = r.sbits(numBits); dy = r.sbits(numBits); }
        else { const vert = r.ubits(1); const d = r.sbits(numBits); if (vert) dy = d; else dx = d; }
        x += dx; y += dy;
        path.push({ type: 'line', x, y, dx, dy });
      } else {
        const cdx = r.sbits(numBits), cdy = r.sbits(numBits);
        const cx = x + cdx, cy = y + cdy;
        const adx = r.sbits(numBits), ady = r.sbits(numBits);
        x = cx + adx; y = cy + ady;
        path.push({ type: 'curve', controlX: cx, controlY: cy, x, y });
      }
    }
  }

  return { shapeId, rect: rectInfo, fillStyles, lineStyles, numFillBits, numLineBits, path, fillStyle1, lineStyle };
}

module.exports = { decodeShape3Body, BitReader };
