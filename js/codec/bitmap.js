const Bitmap = (function() {
// Embeds a raster image as a DefineBitsLossless2 tag (36, 32-bit ARGB).
//
// Confidence notes (see project README for the full picture): the zlib
// "stored block" framing below is cross-checked against Python's real zlib
// in the test suite and decompresses correctly — that part is solid. What's
// NOT independently verified is the higher-level pixel format: this follows
// the documented convention (format 5 = 32-bit, row-major, 4 bytes/pixel as
// Alpha/Red/Green/Blue, non-premultiplied), but there's no reference GFx
// renderer available to confirm colors/alpha come out right in practice.
// Treat this feature as experimental and check a test image in-engine
// before relying on it.

const { concatBytes, u8, u16le } = Swf._internal;
const { tag } = Swf;

function adler32(bytes) {
  let a = 1, b = 0;
  const MOD = 65521;
  // Process in chunks to keep a/b from growing unboundedly between mods
  // (standard adler32 optimization — mod every ~5552 bytes' worth of adds).
  let i = 0;
  while (i < bytes.length) {
    const chunkEnd = Math.min(i + 5552, bytes.length);
    for (; i < chunkEnd; i++) {
      a += bytes[i];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// Wraps `data` as a spec-valid zlib stream using only DEFLATE "stored"
// (uncompressed) blocks — legal per the DEFLATE spec, just larger than real
// compression would produce. Verified against Python's zlib.decompress for
// empty input, single bytes, exact block-size boundaries, and multi-block
// data; see tests/suite.bitmap.js.
function zlibStore(data) {
  const chunks = [];
  const CMF = 0x78; // deflate, 32K window
  let FLG = 0x01;
  while (((CMF << 8) | FLG) % 31 !== 0) FLG += 1;
  chunks.push(Uint8Array.from([CMF, FLG]));

  const MAXBLOCK = 65535;
  let pos = 0;
  if (data.length === 0) {
    chunks.push(Uint8Array.from([1, 0, 0, 0xff, 0xff])); // one final, empty stored block
  }
  while (pos < data.length) {
    const remaining = data.length - pos;
    const blockLen = Math.min(MAXBLOCK, remaining);
    const isFinal = (pos + blockLen) >= data.length ? 1 : 0;
    const nlen = (~blockLen) & 0xffff;
    const header = Uint8Array.from([isFinal, blockLen & 0xff, (blockLen >> 8) & 0xff, nlen & 0xff, (nlen >> 8) & 0xff]);
    chunks.push(header, data.subarray(pos, pos + blockLen));
    pos += blockLen;
  }
  const trailer = new Uint8Array(4);
  new DataView(trailer.buffer).setUint32(0, adler32(data), false); // big-endian, per zlib spec
  chunks.push(trailer);
  return concatBytes(...chunks);
}

// imageData: a Canvas ImageData-like object ({width, height, data:
// Uint8ClampedArray in RGBA order}). Converts to the ARGB byte order
// DefineBitsLossless2 format 5 expects.
function rgbaToArgb(imageData) {
  const { width, height, data } = imageData;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    out[i * 4] = a; out[i * 4 + 1] = r; out[i * 4 + 2] = g; out[i * 4 + 3] = b;
  }
  return out;
}

function defineBitsLossless2(bitmapId, width, height, imageData) {
  const argb = rgbaToArgb(imageData);
  const compressed = zlibStore(argb);
  const body = concatBytes(u16le(bitmapId), u8(5), u16le(width), u16le(height), compressed);
  return tag(36, body);
}

return { zlibStore, rgbaToArgb, defineBitsLossless2, adler32 };
})();
