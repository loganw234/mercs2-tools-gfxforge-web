
// -- sample project + help content --------------------------------------------

const SAMPLE_PROJECT = {
  version: 1,
  stage: { width: 380, height: 150, fps: 30, name: 'hud', background: [22, 24, 28] },
  items: [
    { kind: 'rect', x: 0, y: 0, w: 380, h: 30, fill: [232, 140, 24] },
    { kind: 'text', x: 14, y: 6, text: 'OPERATOR STATUS', size: 15, color: [25, 25, 25] },
    { kind: 'text', x: 16, y: 40, text: '--', size: 13, color: [255, 196, 72], var: 'hp_val', width: 100 },
    { kind: 'button', x: 20, y: 90, w: 120, h: 24, event: 'quit', label: 'QUIT' },
    { kind: 'menu', x: 220, y: 20, options: ['New Game', 'Options', 'Quit'], width: 140 },
  ],
  script: 'function SetHealth(n) {\n    _root.hp_val = n;\n    if (n < 25) { fscommand("warn", n); }\n}\n',
};

function buildHelpBody() {
  const body = document.getElementById('helpBody');
  const schema = `{
  "version": 1,
  "stage": {
    "width": 380, "height": 150, "fps": 30, "name": "hud",
    "background": [22,24,28],
    "font_name": "_normal_Font", "font_url": "_normal_Font.swf"
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

    { "kind": "button", "x":20, "y":90, "w":120, "h":24, "event":"quit",
      "arg": null, "label":"QUIT",
      "fill":[52,58,68], "hover":[74,82,96],
      "label_color":[235,238,242], "label_size":13 },
      // "hover": null means no over/down state (single-state button)

    { "kind": "clip", "name":"bar", "x":4, "y":44, "w":100, "h":8,
      "fill":[0,200,0] },
      // named MovieClip -- the only thing script/host can move by name

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
  body.appendChild(el('p', { class: 'small-note', text: 'Plain gfxforge AS2-subset source (same editor as the Script tab): literals (incl. arrays [1,2,3]), variables, obj.member / obj[key], + - * / % and += -= *= /= %=, comparisons, && ||, ! -, calls, fscommand("evt", x), if/else, while, for(;;), break, continue, function, return. Compile errors report a line and column.' }));

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
