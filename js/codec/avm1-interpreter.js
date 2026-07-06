const Avm1Interp = (function() {

// -- value coercion helpers ---------------------------------------------------
// Deliberately approximate, matching JS's own numeric/string coercion, which
// is close enough to AVM1's for basic HUD scripting. See README for the
// documented list of simplifications.

function toNum(v) { return Number(v); }
function toStr(v) { return v === undefined ? 'undefined' : v === null ? 'null' : String(v); }
function toBool(v) { return Boolean(v); }
function looseEquals(a, b) { return a == b; } // eslint-disable-line eqeqeq
function avm1Add(a, b) { return a + b; }

function fmt(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(fmt).join(', ') + ']';
  return String(v);
}

function readCString(code, pos) {
  let end = pos;
  while (code[end] !== 0) end += 1;
  const str = String.fromCharCode(...code.subarray(pos, end)); // latin1: byte value == char code
  return { str, next: end + 1 };
}

function u16(code, pos) { return code[pos] | (code[pos + 1] << 8); }
function i16(code, pos) { const v = u16(code, pos); return v >= 0x8000 ? v - 0x10000 : v; }
function f64(code, pos) { return new DataView(code.buffer, code.byteOffset + pos, 8).getFloat64(0, true); }
function i32(code, pos) { return new DataView(code.buffer, code.byteOffset + pos, 4).getInt32(0, true); }

// -- runtime object model -----------------------------------------------------
//
// _root is represented by a sentinel object (rt.root). Getting/setting a
// member on it resolves, in order: a text item's bound variable name, a named
// clip (returns/uses a ClipProxy), then falls back to a plain dynamic
// property bag — so `_root.score = 0` works for bookkeeping variables that
// aren't tied to any on-stage item. Bare (non-`.`) variable names resolve the
// same way once local (function-parameter) scope has been checked, since in
// a single-timeline movie "global" and "_root's properties" are the same
// store — matching real single-timeline Flash/GFx behaviour.

class ClipProxy {
  constructor(item) { this.item = item; }
  get(name) {
    const it = this.item;
    switch (name) {
      case '_x': return it.x;
      case '_y': return it.y;
      case '_xscale': return it._xscale ?? 100;
      case '_yscale': return it._yscale ?? 100;
      case '_alpha': return it._alpha ?? 100;
      case '_visible': return it._visible !== false;
      case '_rotation': return it._rotation ?? 0;
      case '_width': return it.w * ((it._xscale ?? 100) / 100);
      case '_height': return it.h * ((it._yscale ?? 100) / 100);
      case '_name': return it.name;
      default: return undefined;
    }
  }
  set(name, value) {
    const it = this.item;
    switch (name) {
      case '_x': it.x = toNum(value); break;
      case '_y': it.y = toNum(value); break;
      case '_xscale': it._xscale = toNum(value); break;
      case '_yscale': it._yscale = toNum(value); break;
      case '_alpha': it._alpha = toNum(value); break;
      case '_visible': it._visible = toBool(value); break;
      case '_rotation': it._rotation = toNum(value); break;
      default: break; // unknown pseudo-property: silently ignored, matching Flash's forgiving behaviour
    }
  }
}

const CLIP_METHODS = new Set(['gotoAndStop', 'gotoAndPlay', 'play', 'stop', 'swapDepths', 'removeMovieClip']);
const ARRAY_METHODS = ['push', 'pop', 'shift', 'unshift', 'reverse', 'sort', 'slice', 'splice', 'join', 'indexOf', 'concat'];

class Runtime {
  constructor(items, callbacks) {
    this.items = items; // live reference — mutations show up immediately for rendering
    this.trace = (callbacks && callbacks.onTrace) || (() => {});
    this.onFsCommandCb = (callbacks && callbacks.onFsCommand) || (() => {});
    this.onMutate = (callbacks && callbacks.onMutate) || (() => {});
    this.root = { __isRoot: true };
    this.textValues = new Map();   // varName -> current value
    this.rootDynamic = new Map();  // arbitrary _root-level properties
    this.functions = new Map();    // name -> {params, bodyStart, bodyEnd, code}
    this.instructionBudget = 250000;

    for (const it of items) {
      if (it.kind === 'text' && it.varName) this.textValues.set(it.varName, it.text);
    }
  }

  findBoundTextItem(name) {
    return this.items.find(it => it.kind === 'text' && it.varName === name && !it.hidden);
  }
  findClipItem(name) {
    return this.items.find(it => it.kind === 'clip' && it.name === name && !it.hidden);
  }
  clipProxyFor(item) {
    if (!item.__proxy) item.__proxy = new ClipProxy(item);
    return item.__proxy;
  }

  getRootProperty(name) {
    const textItem = this.findBoundTextItem(name);
    if (textItem) return this.textValues.get(name);
    const clipItem = this.findClipItem(name);
    if (clipItem) return this.clipProxyFor(clipItem);
    return this.rootDynamic.has(name) ? this.rootDynamic.get(name) : undefined;
  }

  setRootProperty(name, value) {
    const textItem = this.findBoundTextItem(name);
    if (textItem) {
      this.textValues.set(name, value);
      this.trace(`${name} = ${fmt(value)}  (bound text field)`);
      this.onMutate();
      return;
    }
    const clipItem = this.findClipItem(name);
    if (clipItem) {
      this.trace(`(can't assign directly to clip "${name}" — try ${name}._x, ._y, ._visible, etc.)`);
      return;
    }
    this.rootDynamic.set(name, value);
    this.trace(`${name} = ${fmt(value)}`);
  }

  getVariable(locals, name) {
    if (locals && locals.has(name)) return locals.get(name);
    if (name === '_root' || name === '_root.') return this.root;
    return this.getRootProperty(name);
  }

  setVariable(locals, name, value) {
    if (locals && locals.has(name)) { locals.set(name, value); return; }
    this.setRootProperty(name, value);
  }

  getMember(obj, name) {
    if (obj === this.root) return this.getRootProperty(name);
    if (obj instanceof ClipProxy) return obj.get(name);
    if (obj === null || obj === undefined) { this.trace(`⚠ can't read "${name}" of ${fmt(obj)}`); return undefined; }
    return obj[name];
  }

  setMember(obj, name, value) {
    if (obj === this.root) { this.setRootProperty(name, value); return; }
    if (obj instanceof ClipProxy) {
      obj.set(name, value);
      this.trace(`${obj.item.name}.${name} = ${fmt(value)}`);
      this.onMutate();
      return;
    }
    if (obj === null || obj === undefined) { this.trace(`⚠ can't set "${name}" on ${fmt(obj)}`); return; }
    obj[name] = value;
  }

  callByName(name, args) {
    const fn = this.functions.get(name);
    if (!fn) { this.trace(`⚠ call to undefined function "${name}(...)"`); return undefined; }
    const locals = new Map();
    fn.params.forEach((p, i) => locals.set(p, args[i]));
    return execRange(this, fn.code, fn.bodyStart, fn.bodyEnd, locals);
  }

  callMethod(obj, name, args) {
    if (Array.isArray(obj)) {
      if (ARRAY_METHODS.includes(name) && typeof obj[name] === 'function') {
        return obj[name](...args);
      }
      this.trace(`⚠ array method "${name}" not supported in the simulator`);
      return undefined;
    }
    if (obj instanceof ClipProxy) {
      if (CLIP_METHODS.has(name)) {
        this.trace(`(${obj.item.name}.${name}(${args.map(fmt).join(', ')}) — no-op: this simulator has no timeline to move through)`);
        return undefined;
      }
      this.trace(`⚠ method "${name}" not supported in the simulator`);
      return undefined;
    }
    if (obj && typeof obj[name] === 'function') return obj[name](...args);
    this.trace(`⚠ method "${name}" not supported in the simulator`);
    return undefined;
  }

  // Runs a whole compiled script once (as a real player does on entering the
  // frame): executes top-level statements immediately, registers any named
  // functions for later calling, and skips over their bodies.
  runTopLevel(code) {
    try {
      this.trace('▶ running top-level script');
      execRange(this, code, 0, code.length, null);
    } catch (e) {
      this.trace(`⚠ error running top-level script: ${e.message}`);
    }
  }

  // Public entry point for the "call a function" panel — invokes a
  // previously-registered named function with the given arguments.
  callFunction(name, args) {
    if (!this.functions.has(name)) {
      this.trace(`⚠ "${name}" is not a defined function`);
      return undefined;
    }
    try {
      this.trace(`→ call ${name}(${args.map(fmt).join(', ')})`);
      const result = this.callByName(name, args);
      if (result !== undefined) this.trace(`  ↳ returned ${fmt(result)}`);
      return result;
    } catch (e) {
      this.trace(`⚠ error in ${name}(): ${e.message}`);
      return undefined;
    }
  }

  functionNames() {
    return Array.from(this.functions.keys());
  }

  functionParams(name) {
    const fn = this.functions.get(name);
    return fn ? fn.params.slice() : [];
  }
}

// -- bytecode execution loop --------------------------------------------------
//
// Decodes exactly the opcode set avm1.js/compiler.js can emit (see that
// file's header). Single-byte opcodes (<0x80) have no length/payload framing;
// opcodes >=0x80 are [opcode][u16 length][length bytes], per the standard
// SWF action-record format.

function execRange(rt, code, pcStart, pcEnd, locals) {
  const stack = [];
  let pc = pcStart;
  let steps = 0;

  while (pc < pcEnd) {
    if (++steps > rt.instructionBudget) {
      rt.trace(`⚠ execution stopped — exceeded ${rt.instructionBudget} instructions (possible infinite loop)`);
      return undefined;
    }
    const op = code[pc]; pc += 1;

    if (op === 0x00) return undefined; // End

    if (op < 0x80) {
      switch (op) {
        case 0x1c: { const name = toStr(stack.pop()); stack.push(rt.getVariable(locals, name)); break; }
        case 0x1d: { const value = stack.pop(); const name = toStr(stack.pop()); rt.setVariable(locals, name, value); break; }
        case 0x4e: { const name = toStr(stack.pop()); const obj = stack.pop(); stack.push(rt.getMember(obj, name)); break; }
        case 0x4f: { const value = stack.pop(); const name = toStr(stack.pop()); const obj = stack.pop(); rt.setMember(obj, name, value); break; }
        case 0x47: { const b = stack.pop(), a = stack.pop(); stack.push(avm1Add(a, b)); break; }
        case 0x0b: { const b = stack.pop(), a = stack.pop(); stack.push(toNum(a) - toNum(b)); break; }
        case 0x0c: { const b = stack.pop(), a = stack.pop(); stack.push(toNum(a) * toNum(b)); break; }
        case 0x0d: { const b = stack.pop(), a = stack.pop(); stack.push(toNum(a) / toNum(b)); break; }
        case 0x3f: { const b = stack.pop(), a = stack.pop(); stack.push(toNum(a) % toNum(b)); break; }
        case 0x48: { const b = stack.pop(), a = stack.pop(); stack.push(toNum(a) < toNum(b)); break; }
        case 0x67: { const b = stack.pop(), a = stack.pop(); stack.push(toNum(a) > toNum(b)); break; }
        case 0x49: { const b = stack.pop(), a = stack.pop(); stack.push(looseEquals(a, b)); break; }
        case 0x10: { const b = stack.pop(), a = stack.pop(); stack.push(toBool(a) && toBool(b)); break; }
        case 0x11: { const b = stack.pop(), a = stack.pop(); stack.push(toBool(a) || toBool(b)); break; }
        case 0x12: { stack.push(!toBool(stack.pop())); break; }
        case 0x17: { stack.pop(); break; }
        case 0x3e: { return stack.pop(); } // Return
        case 0x3d: { // CallFunction
          const name = toStr(stack.pop());
          const n = toNum(stack.pop());
          const args = [];
          for (let i = 0; i < n; i++) args.push(stack.pop());
          stack.push(rt.callByName(name, args));
          break;
        }
        case 0x52: { // CallMethod
          const name = toStr(stack.pop());
          const obj = stack.pop();
          const n = toNum(stack.pop());
          const args = [];
          for (let i = 0; i < n; i++) args.push(stack.pop());
          stack.push(rt.callMethod(obj, name, args));
          break;
        }
        case 0x42: { // InitArray: pop count, pop that many values (reverse order -> un-reverse)
          const n = toNum(stack.pop());
          const vals = [];
          for (let i = 0; i < n; i++) vals.push(stack.pop());
          vals.reverse();
          stack.push(vals);
          break;
        }
        default:
          rt.trace(`⚠ unsupported single-byte action 0x${op.toString(16)}`);
      }
      continue;
    }

    // >= 0x80: length-prefixed actions
    const len = u16(code, pc); pc += 2;
    const bodyStart = pc;

    if (op === 0x96) { // Push
      let p = bodyStart;
      const end = bodyStart + len;
      while (p < end) {
        const type = code[p]; p += 1;
        if (type === 0x00) { const r = readCString(code, p); stack.push(r.str); p = r.next; }
        else if (type === 0x02) { stack.push(null); }
        else if (type === 0x03) { stack.push(undefined); }
        else if (type === 0x05) { stack.push(code[p] !== 0); p += 1; }
        else if (type === 0x06) { stack.push(f64(code, p)); p += 8; }
        else if (type === 0x07) { stack.push(i32(code, p)); p += 4; }
        else { rt.trace(`⚠ unsupported push type 0x${type.toString(16)}`); break; }
      }
      pc = end;
    } else if (op === 0x9a) { // GetURL2 (fscommand)
      const target = stack.pop();
      const url = toStr(stack.pop());
      if (url.startsWith('FSCommand:')) {
        rt.onFsCommandCb(url.slice('FSCommand:'.length), target);
      } else {
        rt.trace(`GetURL2 (non-fscommand) url=${JSON.stringify(url)}`);
      }
      pc = bodyStart + len;
    } else if (op === 0x9b) { // DefineFunction
      let p = bodyStart;
      const r1 = readCString(code, p); const name = r1.str; p = r1.next;
      const nparams = u16(code, p); p += 2;
      const params = [];
      for (let i = 0; i < nparams; i++) { const r = readCString(code, p); params.push(r.str); p = r.next; }
      const codeSize = u16(code, p); p += 2;
      const bodyStart2 = p;
      const bodyEnd2 = p + codeSize;
      rt.functions.set(name, { params, bodyStart: bodyStart2, bodyEnd: bodyEnd2, code });
      pc = bodyEnd2; // definitions don't execute their body — only calling does
    } else if (op === 0x99) { // Jump
      const off = i16(code, bodyStart);
      pc = bodyStart + len + off;
    } else if (op === 0x9d) { // If
      const off = i16(code, bodyStart);
      const cond = toBool(stack.pop());
      pc = bodyStart + len;
      if (cond) pc += off;
    } else {
      rt.trace(`⚠ unsupported action 0x${op.toString(16)}`);
      pc = bodyStart + len;
    }
  }
  return undefined;
}

// -- public API ----------------------------------------------------------------

function createInterpreter(items, callbacks) {
  return new Runtime(items, callbacks);
}

return { createInterpreter, ClipProxy };
})();
