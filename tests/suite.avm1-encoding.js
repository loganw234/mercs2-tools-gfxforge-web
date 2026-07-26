const { loadContext, test, assert } = require('./run.js');

function hex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }
function bytes(str) { return Uint8Array.from(str.trim().split(/\s+/).map(h => parseInt(h, 16))); }

// --- ActionPush double byte order -------------------------------------------
//
// These are ground-truth byte sequences lifted out of shipped Mercenaries 2
// movies (type-6 pushes inside real DoAction blocks), not values this codec
// produced. GFx reads the two 32-bit halves swapped — high word first — so a
// plain little-endian float64 decodes as a denormal (~5.3e-315) instead of the
// authoring value. See doublele() in js/codec/avm1.js.
//
// Guarding this with real bytes matters more than usual: encoder and
// interpreter agreeing with each other is exactly how the original bug stayed
// invisible through a passing test suite.
const REAL_DOUBLES = [
  { wire: '00 00 d0 3f 00 00 00 00', value: 0.25 },
  { wire: '00 c0 4d 40 00 00 00 00', value: 59.5 },
  { wire: '00 00 04 40 00 00 00 00', value: 2.5 },
  { wire: '00 00 29 40 00 00 00 00', value: 12.5 },
  { wire: '00 00 00 00 00 00 00 00', value: 0 },
];

test('avm1: ActionPush doubles encode word-swapped, matching real game movies', () => {
  const ctx = loadContext();
  for (const { wire, value } of REAL_DOUBLES) {
    const got = ctx.Avm1.push(value + 0.0);
    // push() emits a whole action record: 96 <u16 len> <type> <8 bytes>
    const body = got.subarray(4);
    // integral values take the i32 path, so only exercise the double path
    if (Number.isInteger(value)) continue;
    assert(hex(body) === hex(bytes(wire)),
      `push(${value}) encoded ${hex(body)}, real movies contain ${hex(bytes(wire))}`);
  }
});

test('avm1: the interpreter reads back exactly what the assembler wrote', () => {
  const ctx = loadContext();
  for (const v of [0.25, 59.5, 2.5, 12.5, -1.5, 0.1, 1e-8, -273.15, 1234.5678]) {
    // a bare push leaves the value on the stack and falls off the end, so the
    // probe body needs an explicit return to hand it back
    const code = ctx.Swf._internal.concatBytes(ctx.Avm1.push(v), ctx.Avm1.RETURN);
    const rt = ctx.Avm1Interp.createInterpreter([], {});
    rt.functions.set('probe', { params: [], bodyStart: 0, bodyEnd: code.length, code });
    const got = rt.callByName('probe', []);
    assert(got === v, `round-trip of ${v} produced ${got}`);
  }
});

test('avm1: real game double bytes decode to their authoring values', () => {
  const ctx = loadContext();
  for (const { wire, value } of REAL_DOUBLES) {
    // Hand-assemble the push record around the real payload so the decode path
    // sees bytes that came from the game, not from our encoder.
    const payload = bytes(wire);
    const rec = ctx.Swf._internal.concatBytes(
      Uint8Array.from([0x96, payload.length + 1, 0x00, 0x06]), payload, ctx.Avm1.RETURN
    );
    const rt = ctx.Avm1Interp.createInterpreter([], {});
    rt.functions.set('p', { params: [], bodyStart: 0, bodyEnd: rec.length, code: rec });
    const got = rt.callByName('p', []);
    assert(got === value, `game bytes ${wire} decoded to ${got}, expected ${value}`);
  }
});

// --- multi-byte action framing ----------------------------------------------

test('avm1: DefineFunction2 header matches the layout GFx parses', () => {
  const ctx = loadContext();
  const body = ctx.Avm1.push(1);
  const fn = ctx.Avm1.defineFunction2('Foo', [{ name: 'a', register: 1 }, { name: 'b', register: 2 }], body,
    { flags: ctx.Avm1.FN2.PRELOAD_THIS });
  assert(fn[0] === 0x8e, 'opcode should be 0x8e');
  const hdrLen = fn[1] | (fn[2] << 8);
  // name(4) + nargs(2) + registerCount(1) + flags(2) + (reg+name) per arg + codeSize(2)
  const expected = 4 + 2 + 1 + 2 + (1 + 2) + (1 + 2) + 2;
  assert(hdrLen === expected, `header length ${hdrLen}, expected ${expected}`);
  assert(fn.length === 3 + hdrLen + body.length, 'body must follow the header');
  // registerCount is auto-sized to max register + 1
  assert(fn[3 + 4 + 2] === 3, `registerCount should be 3, got ${fn[3 + 4 + 2]}`);
});

test('avm1: ConstantPool frames count + NUL-terminated strings', () => {
  const ctx = loadContext();
  const cp = ctx.Avm1.constantPool(['ab', 'c']);
  assert(cp[0] === 0x88, 'opcode should be 0x88');
  const len = cp[1] | (cp[2] << 8);
  assert(len === 2 + 3 + 2, `body length ${len}, expected 7`);
  assert((cp[3] | (cp[4] << 8)) === 2, 'count should be 2');
  assert(hex(cp.subarray(5)) === '6162006300', 'strings should be NUL-terminated latin1');
});

test('avm1: gotoFrame2 sets the play bit and optional scene bias', () => {
  const ctx = loadContext();
  assert(hex(ctx.Avm1.gotoFrame2(false)) === '9f010000', 'stop form');
  assert(hex(ctx.Avm1.gotoFrame2(true)) === '9f010001', 'play form');
  assert(hex(ctx.Avm1.gotoFrame2(true, 4)) === '9f0300030400', 'scene-bias form sets bit 1');
});

test('avm1: storeRegister carries a single register byte', () => {
  const ctx = loadContext();
  assert(hex(ctx.Avm1.storeRegister(3)) === '87010003', 'storeRegister(3)');
});

test('avm1: push wrappers cover null/undefined/register/constant', () => {
  const ctx = loadContext();
  const A = ctx.Avm1;
  assert(hex(A.push(A.NULL)) === '96010002', 'null is type 2');
  assert(hex(A.push(A.UNDEFINED)) === '96010003', 'undefined is type 3');
  assert(hex(A.push(A.reg(2))) === '9602000402', 'register is type 4');
  assert(hex(A.push(A.constant(5))) === '9602000805', 'constant8 is type 8');
  assert(hex(A.push(A.constant(300))) === '960300092c01', 'constant16 is type 9 past 255');
});
