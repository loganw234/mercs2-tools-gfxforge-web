
// -- sample project + help content --------------------------------------------

// The starter project. Deliberately a "bit of everything" so a beginner can
// read one small scene + its generated Lua and see each capability once:
// static shapes, two live text fields, a clip the script scales (the bar), a
// button and a menu that fire events back to Lua, and a script that talks both
// directions (SetHealth pushes text + moves the bar + fires "warn" when low).
const SAMPLE_PROJECT = {
  version: 1,
  stage: { width: 460, height: 220, fps: 30, name: 'hud', background: [22, 24, 28] },
  items: [
    // Background panel. The stage "background" colour is only an editor
    // preview -- in-game the widget composites transparent, so a real HUD
    // panel needs an actual full-stage rect behind everything.
    { kind: 'rect', x: 0, y: 0, w: 460, h: 220, fill: [22, 24, 28] },
    { kind: 'rect', x: 0, y: 0, w: 460, h: 34, fill: [232, 140, 24] },
    { kind: 'text', x: 14, y: 8, text: 'OPERATOR STATUS', size: 15, color: [25, 25, 25] },

    // live health readout + a bar clip the script scales via _xscale
    { kind: 'text', x: 16, y: 52, text: 'HEALTH', size: 11, color: [150, 156, 168] },
    { kind: 'text', x: 16, y: 68, text: '100%', size: 20, color: [255, 196, 72], var: 'hp_val', width: 150 },
    { kind: 'rect', x: 16, y: 104, w: 200, h: 12, fill: [40, 44, 52] },
    { kind: 'clip', name: 'bar', x: 16, y: 104, w: 200, h: 12, fill: [90, 208, 120] },

    // a second live field, driven by SetStatus(s)
    { kind: 'text', x: 16, y: 134, text: 'STATUS', size: 11, color: [150, 156, 168] },
    { kind: 'text', x: 16, y: 150, text: 'ONLINE', size: 14, color: [120, 210, 255], var: 'status_val', width: 200 },

    // a button and a menu that fire fscommand events back to Lua
    { kind: 'button', x: 16, y: 182, w: 130, h: 30, event: 'quit', label: 'QUIT' },
    { kind: 'menu', x: 260, y: 52, options: ['New Game', 'Options', 'Quit'], width: 184, event: 'menuClick' },
  ],
  // Movie side (AS2). The host (Lua) calls these; SetHealth also fires an event
  // back. The menu wizard appends a SetSelected(i) on load (moves the highlight).
  script: [
    'function SetHealth(n) {',
    '    _root.hp_val = n + "%";           // update the health text field',
    '    _root.bar._xscale = n;            // scale the health bar clip (0..100)',
    '    if (n < 25) { fscommand("warn", n); }   // movie -> Lua: tell the host we are low',
    '}',
    'function SetStatus(s) {',
    '    _root.status_val = s;             // update the status text field',
    '}',
  ].join('\n') + '\n',
};

function buildHelpBody() {
  const body = document.getElementById('helpBody');
  const schema = `{
  "version": 1,
  "stage": {
    "width": 380, "height": 150, "fps": 30, "name": "hud",
    "background": [22,24,28],
    "font_name": "_normal_Font", "font_url": "_normal_Font.swf",
    "frames": ["idle","alert"]
    // optional. Declares a timeline of named frames, which script reaches
    // with gotoAndStop("alert") / gotoAndPlay("idle"). Omit it (or use one
    // frame) for an ordinary static HUD. A multi-frame movie gets an
    // implicit stop() on frame 1 so it holds its first state instead of
    // cycling. This is how the game's own menus model UI state.
  },
  "items": [
    { "kind": "rect", "x":0, "y":0, "w":380, "h":30, "fill":[232,140,24] },

    { "kind": "rect", "x":0, "y":100, "w":380, "h":40,
      "fill": { "type":"linear", "direction":"vertical",
                "stops":[{"ratio":0,"color":[80,80,80]},
                         {"ratio":255,"color":[20,20,20]}] },
      "radius": 8,
      "stroke": { "width":1, "color":[255,255,255,120] } },
      // fill accepts a solid [r,g,b,a] OR a gradient object as shown here
      // ("direction" is "horizontal" or "vertical" for "linear", or omit
      // it and use "radial"). radius and stroke work the same way on
      // rect/button/clip. All three are optional -- omit for a plain shape.

    { "kind": "text", "x":14, "y":6, "text":"HELLO", "size":15,
      "color":[25,25,25], "var":"hp_val", "width":100 },
      // "var" is optional -- set it to bind a live/host-updatable field

    { "kind": "text", "x":14, "y":40, "text":"Long wrapped body copy",
      "size":12, "color":[220,220,220], "width":200, "height":60,
      "multiline": true, "word_wrap": true, "align":"center",
      "html": false, "border": false, "selectable": false,
      "leading": 2, "max_length": null },
      // All optional. Without them a text field is a single read-only
      // non-selectable line, which is what it always used to be. "height"
      // only matters once "multiline" is on. "align" is left/right/center/
      // justify.

    { "kind": "button", "x":20, "y":90, "w":120, "h":24, "event":"quit",
      "arg": null, "label":"QUIT",
      "fill":[52,58,68], "hover":[74,82,96],
      "label_color":[235,238,242], "label_size":13 },
      // "hover": null means no over/down state (single-state button)

    { "kind": "clip", "name":"bar", "x":4, "y":44, "w":100, "h":8,
      "fill":[0,200,0] },
      // named MovieClip -- the only thing script/host can move by name

    { "kind": "clip", "name":"fireBtn", "x":20, "y":60, "w":90, "h":24,
      "fill":[52,58,68],
      "events": { "release": "fscommand(\\"fire\\", 1);",
                  "rollOver": "_root.fireBtn._alpha = 100;",
                  "rollOut":  "_root.fireBtn._alpha = 70;" },
      "export": "FireButton",
      "scale9": { "left":6, "top":6, "right":84, "bottom":18 } },
      // "events" attaches AS2 handlers to this clip's placement -- press,
      // release, releaseOutside, rollOver, rollOut, dragOver, dragOut,
      // enterFrame, load, unload, keyDown, keyUp. This is how the game's own
      // UI does interaction; "button" below uses a real Button character,
      // which the shipped movies barely touch.
      // "export" emits an ExportAssets entry so script can attachMovie() it.
      // "scale9" marks 9-slice guides (clip-local coords) so corners keep
      // their size when the clip is scaled.
      // Handlers only apply to "clip" items; on any other kind they're
      // ignored with a warning.

    { "kind": "image", "x":10, "y":10, "w":32, "h":32,
      "data_url": "data:image/png;base64,...." },
      // embedded as a lossless bitmap. data_url is whatever a file picker
      // produces -- the editor's Image tool writes this for you, hand
      // authoring one isn't realistic. EXPERIMENTAL, see notes below.

    { "kind": "menu", "x":220, "y":20,
      "options":["New Game","Options","Quit"],
      "width":140, "row_h":22, "gap":2, "event":"menuClick" }
      // shorthand only: expands into buttons + a highlight clip + a
      // generated SetSelected(i) function on load. Re-saving the
      // project emits the expanded (button/clip) form, not "menu".
  ],
  // Every item also accepts these two, whatever its kind:
  //   "frames": [0]     which timeline frames it appears on (0-based).
  //                     Omit for "every frame", which is the default and
  //                     the only sensible answer without a timeline.
  //                     Content on one frame but not the next is removed
  //                     with RemoveObject2 and re-placed at the same depth
  //                     if it comes back later.
  //   "alpha": 0.5      placement opacity, 0..1. Omit (or 1) for opaque.
  "script": "function SetHealth(n) {\n  _root.hp_val = n;\n}\n"
}`;
  body.innerHTML = '';
  body.appendChild(el('p', { class: 'small-note', text: 'This is the whole file format. Colours are [r,g,b] or [r,g,b,a], 0-255. Field names match the original gfxforge Python library\'s keyword arguments, so this is easy to hand-write or to ask an AI to generate -- paste the result with "Paste JSON..." .' }));
  body.appendChild(el('pre', { class: 'schema-pre', text: schema }));

  body.appendChild(sectionTitle('Any item can also have'));
  body.appendChild(el('pre', { class: 'schema-pre', text: `"hidden": true       // kept in the project, skipped on export
"lock_pos": true     // can't be dragged on the stage (still resizable)
"lock_size": true    // handles hidden (still movable)` }));

  body.appendChild(sectionTitle('Script'));
  body.appendChild(el('p', { class: 'small-note', text: 'Plain gfxforge AS2-subset source (same editor as the Script tab). Literals: numbers (decimal and 0xHEX), strings, booleans, null, undefined, arrays [1,2,3], objects {a:1}. Expressions: variables, this, obj.member, obj[key], calls, method calls, new C(a), function expressions, ternary c ? a : b. Operators: + - * / % , comparisons including === and !==, && || (short-circuiting), ! - + ~, typeof, delete, instanceof, bitwise & | ^ << >> >>>, ++ and -- in both fixities, and compound assignment (+= -= *= /= %= &= |= ^= <<= >>= >>>=). Statements: if/else, while, do/while, for(;;), for-in, switch/case/default, break, continue, var, function, return, fscommand("evt", x). Built-ins that lower to single opcodes: trace(), random(n), getTimer(), int(), Number(), String(), ord(), chr(), and the timeline verbs play(), stop(), gotoAndStop(f), gotoAndPlay(f). Compile errors report a line and column.' }));
  body.appendChild(el('p', { class: 'small-note', text: 'Not supported on purpose: try/catch/throw. This player routes the try opcode to its "unsupported opcode" branch, so a movie using it would load and then silently skip the handler — better to fail at compile time than to ship that. Also note && and || return the operand value (as in real AS2), not a coerced boolean, and var inside a function is a true local rather than a _root global.' }));

  body.appendChild(sectionTitle('Confidence notes'));
  body.appendChild(el('p', { class: 'small-note', text: 'The core codec (shapes, text, buttons, AVM1 scripting) is checked byte-for-byte against the original Python gfxforge library and is solid. Gradients/strokes/rounded corners are new and independently verified by decoding the encoder\'s own output and checking the geometry, since no external reference exists for that part of the SWF spec. Image import is the newest and least-verified piece -- the zlib compression is checked against Python\'s real zlib, but the exact bitmap pixel format has no reference to check against, so treat it as experimental and check a test image in-engine before relying on it for real assets.' }));
}

// -- wire canvas mouse/touch events --------------------------------------------

function wireCanvas() {
  const canvas = document.getElementById('stageCanvas');
  canvas.addEventListener('mousedown', onCanvasMouseDown);
  canvas.addEventListener('dblclick', onCanvasDblClick);
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  wireTouch();
}

// -- init -----------------------------------------------------------------------

function init() {
  wireCanvas();
  wireToolRail();
  wireTabs();
  wireFileMenu();
  wireMenuWizard();
  wireScriptPanel();
  wirePlayMode();
  wireImageUpload();
  wireReferenceImage();
  buildHelpBody();

  const restoring = checkForAutosaveOnStartup();
  if (!restoring) {
    loadProjectJsonText(JSON.stringify(SAMPLE_PROJECT), 'sample HUD');
    showToast('Loaded a sample HUD to start from — File ▸ New for a blank stage.', 'success');
  }
  setTool('select');
  fitZoom();
  updateHistoryButtons();
  renderFramesBar();
  wireLuaPanel();
  wireResizers();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
