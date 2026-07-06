const Avm1 = (function() {
// Port of gfxforge/avm1.py — AVM1 (ActionScript 1/2) bytecode assembler.
// GFx 2.x runs AVM1: define functions the host can call, bind variables that
// text fields display, and fscommand back out to the host.

const { concatBytes, u8, u16le, i32le, cstr } = Swf._internal;

// opcodes with no payload
const GET_VARIABLE = u8(0x1c);
const SET_VARIABLE = u8(0x1d);
const GET_MEMBER = u8(0x4e);
const SET_MEMBER = u8(0x4f);
const ADD2 = u8(0x47);
const SUBTRACT = u8(0x0b);
const MULTIPLY = u8(0x0c);
const DIVIDE = u8(0x0d);
const MODULO = u8(0x3f);
const LESS2 = u8(0x48);
const EQUALS2 = u8(0x49);
const GREATER = u8(0x67);
const AND = u8(0x10);
const OR = u8(0x11);
const NOT = u8(0x12);
const POP = u8(0x17);
const RETURN = u8(0x3e);
const CALL_FUNCTION = u8(0x3d);
const CALL_METHOD = u8(0x52);
const INIT_ARRAY = u8(0x42);
const END = u8(0x00);

function doublele(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return b;
}

// ActionPush. Accepts string (type 0), boolean (5), whole-number (7, i32),
// non-whole number (6, f64). JS has no separate int/float type, so — matching
// how gfxforge's own callers already decide (compiler.py normalises whole
// literals to Python `int` before pushing) — integral JS numbers encode as
// SWF INTEGER and non-integral ones as SWF DOUBLE.
function push(...values) {
  let body = new Uint8Array(0);
  for (const v of values) {
    if (typeof v === 'string') {
      body = concatBytes(body, u8(0x00), cstr(v));
    } else if (typeof v === 'boolean') {
      body = concatBytes(body, u8(0x05), u8(v ? 1 : 0));
    } else if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        body = concatBytes(body, u8(0x07), i32le(v));
      } else {
        body = concatBytes(body, u8(0x06), doublele(v));
      }
    } else {
      throw new TypeError(`push: unsupported value ${JSON.stringify(v)}`);
    }
  }
  return concatBytes(u8(0x96), u16le(body.length), body);
}

function getUrl2(flags = 0) {
  return concatBytes(u8(0x9a), u16le(1), u8(flags));
}

// ActionDefineFunction. A non-empty name defines the fn in the current scope
// (e.g. _root, so the host can call it by name); an empty name pushes the fn
// object on the stack. `body` bytes follow the header and are skipped at
// definition time (CodeSize).
function defineFunction(name, params, body) {
  let hdr = concatBytes(cstr(name), u16le(params.length));
  for (const p of params) hdr = concatBytes(hdr, cstr(p));
  hdr = concatBytes(hdr, u16le(body.length));
  return concatBytes(u8(0x9b), u16le(hdr.length), hdr, body);
}

// --- convenience expression/statement fragments -----------------------------

function v(name) {
  // Value of variable `name` (leaves it on the stack).
  return concatBytes(push(name), GET_VARIABLE);
}

function literal(value) {
  return push(value);
}

function root() {
  return concatBytes(push('_root'), GET_VARIABLE);
}

function getMember(obj, name) {
  return concatBytes(obj, push(name), GET_MEMBER);
}

function setMember(obj, name, value) {
  return concatBytes(obj, push(name), value, SET_MEMBER);
}

function setRoot(member, value) {
  return setMember(root(), member, value);
}

function fscommand(command, value) {
  return concatBytes(push('FSCommand:' + command), value, getUrl2(0));
}

class Script {
  constructor() {
    this._b = new Uint8Array(0);
  }

  set(name, value) {
    this._b = concatBytes(this._b, setRoot(name, push(value)));
    return this;
  }

  function(name, params, body) {
    this._b = concatBytes(this._b, defineFunction(name, params, body));
    return this;
  }

  raw(actionBytes) {
    this._b = concatBytes(this._b, actionBytes);
    return this;
  }

  body() {
    return this._b;
  }

  toAction() {
    return concatBytes(this._b, END);
  }
}

const api = {
  GET_VARIABLE, SET_VARIABLE, GET_MEMBER, SET_MEMBER, ADD2, SUBTRACT, MULTIPLY,
  DIVIDE, MODULO, LESS2, EQUALS2, GREATER, AND, OR, NOT, POP, RETURN,
  CALL_FUNCTION, CALL_METHOD, INIT_ARRAY, END,
  push, getUrl2, defineFunction, var: v, literal, root, getMember, setMember,
  setRoot, fscommand, Script,
};

  return api;
})();
