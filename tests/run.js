#!/usr/bin/env node
// Test harness for gfxforge-web. Loads the actual source files (not a
// rebuilt bundle) directly in dependency order inside a minimal DOM stub,
// then runs assertions against them. Run with: node tests/run.js
//
// This is not a browser test — it cannot exercise real canvas painting or
// mouse/touch event dispatch. It exists to catch regressions in the pure
// logic: codec byte output, project load/save, the AVM1 interpreter, the
// compiler, and any other DOM-independent behaviour.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const CODEC_FILES = [
  'js/codec/bitio.js', 'js/codec/swf.js', 'js/codec/avm1.js',
  'js/codec/compiler.js', 'js/codec/movie.js', 'js/codec/verify.js',
  'js/codec/avm1-interpreter.js', 'js/codec/bitmap.js', 'js/codec/decode.js',
];
const EDITOR_FILES = [
  'js/editor/project-io.js', 'js/editor/render.js', 'js/editor/interaction.js',
  'js/editor/touch.js', 'js/editor/panels.js', 'js/editor/layers-script.js',
  'js/editor/play.js', 'js/editor/reference-image.js',
  'js/editor/wiring.js', 'js/editor/autosave.js', 'js/editor/init.js',
];

// --- minimal DOM/window stub -------------------------------------------------
// Just enough that the editor's top-level code (event listener registration,
// `document.readyState` check, etc.) doesn't throw while loading. Nowhere
// near a real DOM — anything that actually needs elements should be tested
// through pure logic functions instead.
function makeStubDocument() {
  const noopEl = () => ({
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, querySelectorAll: () => [], querySelector: () => null,
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    getContext: () => ({
      setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillText() {}, measureText: () => ({ width: 0 }),
      drawImage() {}, translate() {}, rotate() {}, scale() {}, setLineDash() {},
      rect() {}, arcTo() {}, closePath() {}, arc() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ width: 0, height: 0, data: new Uint8ClampedArray(0) }),
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    click() {}, focus() {}, select() {}, blur() {},
  });
  const cache = new Map();
  return {
    readyState: 'loading',
    addEventListener() {}, removeEventListener() {},
    getElementById: (id) => {
      if (!cache.has(id)) cache.set(id, noopEl());
      return cache.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => noopEl(),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    createDocumentFragment: () => ({ appendChild() {} }),
    body: noopEl(),
  };
}

function loadContext() {
  const sandbox = {
    console, Math, JSON, Date, Array, Object, String, Number, Boolean,
    Uint8Array, DataView, ArrayBuffer, Float64Array, Set, Map, RegExp, Error, TypeError, SyntaxError,
    URL: class { static createObjectURL() { return 'blob:stub'; } static revokeObjectURL() {} },
    Blob: class { constructor() {} },
    FileReader: class { readAsText() {} readAsDataURL() {} },
    setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {},
    devicePixelRatio: 1,
  };
  sandbox.window = sandbox;
  sandbox.document = makeStubDocument();
  sandbox.navigator = { clipboard: {} };
  const localStorageBacking = new Map();
  sandbox.localStorage = {
    getItem: (k) => (localStorageBacking.has(k) ? localStorageBacking.get(k) : null),
    setItem: (k, v) => { localStorageBacking.set(k, String(v)); },
    removeItem: (k) => { localStorageBacking.delete(k); },
    clear: () => { localStorageBacking.clear(); },
  };
  vm.createContext(sandbox);
  for (const rel of [...CODEC_FILES, ...EDITOR_FILES]) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  // vm.createContext's sandbox only receives *properties* the scripts assign
  // (or `var`s); top-level `const`/`let` bindings live in that context's own
  // lexical environment and are otherwise invisible from the outside. Copy
  // everything the test suites need onto the sandbox object explicitly, in
  // the same context so this can still see those bindings.
  vm.runInContext(`
    (function exposeForTests() {
      const names = [
        'Bitio', 'Swf', 'Avm1', 'Compiler', 'GFMovie', 'Verify', 'Avm1Interp', 'Bitmap', 'Decode',
        'state', 'loadProjectFromObject', 'serializeProject', 'serializeItem',
        'expandMenuSpec', 'hitHandle', 'itemBounds', 'buildMovieFromState',
        'nudgeSelected', 'toggleLock', 'makeItem', 'defaultItemFields',
        'normColor', 'toHex', 'hexToRgb',
        'enterPlayMode', 'exitPlayMode', 'getPlayCtx', 'onPlayCanvasClick',
        'simulateButtonClick', 'syncRuntimeText',
        'isGradient', 'defaultGradientFor', 'renderProperties', 'buildItemPanel', 'buildStagePanel',
        'selectOnly', 'toggleSelection', 'clearSelection', 'getMultiSelection',
        'alignSelection', 'distributeSelection', 'bulkToggle', 'deleteSelected', 'duplicateSelected',
        'detectStorageBackend', 'storageSet', 'storageGet', 'storageDelete', 'scheduleAutosave',
        'doAutosave', 'checkForAutosaveOnStartup', 'AUTOSAVE_KEY', 'SAMPLE_PROJECT',
        'getReferenceImage', 'loadReferenceImageFile', 'removeReferenceImage', 'drawReferenceImage',
        'buildHelpBody', 'sectionTitle',
      ];
      for (const n of names) {
        try { globalThis[n] = eval(n); } catch (e) { /* not defined (yet) — fine, skip it */ }
      }
    })();
  `, sandbox, { filename: '(test-export-shim)' });
  return sandbox;
}

// --- tiny test runner ---------------------------------------------------------

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push({ name, error: e.stack || String(e) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + (msg || ''));
}
function assertEqual(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`assertEqual failed${msg ? ' (' + msg + ')' : ''}: ${sa} !== ${sb}`);
}

module.exports = { loadContext, test, assert, assertEqual, get pass() { return pass; }, get fail() { return fail; }, failures };

// If run directly (not required by another suite file), just load the
// context and report it's ready — the actual test suites are separate files
// under tests/ that require() this module.
if (require.main === module) {
  const suiteFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('suite.') && f.endsWith('.js'));
  for (const f of suiteFiles) {
    require(path.join(__dirname, f));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    for (const f of failures) {
      console.log(`\nFAIL: ${f.name}\n${f.error}`);
    }
    process.exitCode = 1;
  }
}
