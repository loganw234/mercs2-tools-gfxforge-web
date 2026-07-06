// Left sidebar: the generated Lua host script.
//
// Zero-dependency editor: a transparent <textarea> for editing sits over a
// syntax-highlighted <pre> that mirrors its text (the classic "highlight in a
// textarea" trick), so we get colour + selection linking without pulling in a
// heavyweight editor and without breaking the offline single-file bundle.
//
// The panel stays in sync with the scene: structural edits regenerate the glue
// (Luagen preserves your --#user code), and selecting an element on the stage
// scrolls to and highlights its handler. See js/codec/luagen.js.

let luaInput = null;         // the editable textarea
let luaHighlight = null;     // the coloured <pre> behind it
let luaStaleEl = null;       // the "scene changed" badge
let luaStaleFlag = false;    // scene changed while the textarea was focused
let luaHlRange = null;       // {a, b} 1-based inclusive lines to highlight, or null

const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if',
  'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

function luaEsc(s) {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

// One source line -> highlighted HTML. Marker lines (--#region / --#user …) get
// their own colour so the managed structure reads at a glance.
function luaHighlightLine(line) {
  if (/^\s*--#(region|endregion|user|enduser)\b/.test(line)) {
    return '<span class="mk">' + luaEsc(line) + '</span>';
  }
  const re = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(--.*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(line)) !== null) {
    out += luaEsc(line.slice(last, m.index));
    if (m[1]) out += '<span class="str">' + luaEsc(m[1]) + '</span>';
    else if (m[2]) out += '<span class="com">' + luaEsc(m[2]) + '</span>';
    else if (m[3]) out += '<span class="num">' + m[3] + '</span>';
    else if (m[4]) out += LUA_KEYWORDS.has(m[4]) ? '<span class="kw">' + m[4] + '</span>' : m[4];
    last = re.lastIndex;
  }
  out += luaEsc(line.slice(last));
  return out;
}

function syncLuaScroll() {
  if (!luaHighlight || !luaInput) return;
  luaHighlight.scrollTop = luaInput.scrollTop;
  luaHighlight.scrollLeft = luaInput.scrollLeft;
}

function renderLuaHighlight() {
  if (!luaInput || !luaHighlight) return;
  const lines = luaInput.value.split('\n');
  const html = lines.map((ln, i) => {
    const h = luaHighlightLine(ln);
    const n = i + 1;
    return (luaHlRange && n >= luaHlRange.a && n <= luaHlRange.b)
      ? '<span class="hl-line">' + h + '</span>'
      : h;
  }).join('\n');
  luaHighlight.innerHTML = html;
  syncLuaScroll();
}

// Keep a given 1-based line comfortably within the textarea's viewport.
function scrollLuaToLine(lineNo) {
  if (!luaInput) return;
  const lh = 18, padTop = 10; // must track the CSS (12px * 1.5 line-height, 10px pad)
  const top = padTop + (lineNo - 1) * lh;
  const viewTop = luaInput.scrollTop, viewH = luaInput.clientHeight;
  if (top < viewTop + padTop) luaInput.scrollTop = top - padTop;
  else if (top + lh > viewTop + viewH - padTop) luaInput.scrollTop = top + lh - viewH + padTop;
  syncLuaScroll();
}

function setLuaStale(on) {
  luaStaleFlag = !!on;
  if (luaStaleEl) luaStaleEl.classList.toggle('show', !!on);
}

// Regenerate the script from the current scene. With preserve, the modder's
// --#user blocks and their chosen KEYVAL are carried over.
function luaGenerateFromScene(opts) {
  opts = opts || {};
  if (!luaInput || typeof Luagen === 'undefined' || typeof state === 'undefined') return;
  const project = { stage: state.stage || {}, items: state.items || [], script: state.script || '' };
  const existing = opts.preserve ? luaInput.value : '';
  let key = 'insert';
  const km = /local KEYVAL = "([^"]*)"/.exec(existing);
  if (km) key = km[1];
  const res = Luagen.generate(project, { existing, key });
  const prevScroll = luaInput.scrollTop;
  luaInput.value = res.code;
  setLuaStale(false);
  luaHlRange = null;
  renderLuaHighlight();
  luaInput.scrollTop = prevScroll;
  syncLuaScroll();
  updateLuaSelectionHighlight();
}

// Called from renderProperties(): highlight the selected element's handler.
function updateLuaSelectionHighlight() {
  if (!luaInput) return;
  let range = null;
  const sel = (typeof getSelected === 'function') ? getSelected() : null;
  if (sel && (sel.event || sel.kind === 'menu')) {
    const ev = sel.event || 'menuClick';
    const r = Luagen.findRegions(luaInput.value).find((x) => x.kind === 'on' && x.key === ev);
    if (r) range = { a: r.start, b: r.end };
  }
  luaHlRange = range;
  renderLuaHighlight();
  if (range) scrollLuaToLine(range.a);
}

// Called from afterStructuralChange(): mid-edit we only flag it; otherwise we
// regenerate so a new button instantly grows a handler.
function onSceneStructureChanged() {
  if (!luaInput) return;
  if (document.activeElement === luaInput) { setLuaStale(true); return; }
  luaGenerateFromScene({ preserve: true });
}

// Click in the script -> select the element whose handler you clicked into.
function onLuaClick() {
  const pos = luaInput.value.slice(0, luaInput.selectionStart).split('\n').length; // 1-based caret line
  const r = Luagen.findRegions(luaInput.value).find((x) => x.kind === 'on' && pos >= x.start && pos <= x.end);
  if (!r || typeof state === 'undefined') return;
  const item = (state.items || []).find((it) => (it.event || (it.kind === 'menu' ? 'menuClick' : null)) === r.key);
  if (item && typeof selectOnly === 'function') { selectOnly(item.id); if (typeof render === 'function') render(); }
}

function luaCopy() {
  const done = () => (typeof showToast === 'function') && showToast('Lua script copied', 'success');
  try { navigator.clipboard.writeText(luaInput.value).then(done, () => { luaInput.select(); document.execCommand('copy'); done(); }); }
  catch (e) { luaInput.select(); document.execCommand('copy'); done(); }
}

function luaDownload() {
  const asset = (state.stage && state.stage.name) || 'hud';
  const blob = new Blob([luaInput.value], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = asset + '.lua';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (typeof showToast === 'function') showToast('Downloaded ' + asset + '.lua', 'success');
}

function wireLuaPanel() {
  luaInput = document.getElementById('luaInput');
  luaHighlight = document.getElementById('luaHighlight');
  luaStaleEl = document.getElementById('luaStale');
  if (!luaInput) return;

  luaInput.addEventListener('input', () => { luaHlRange = null; renderLuaHighlight(); });
  luaInput.addEventListener('scroll', syncLuaScroll);
  luaInput.addEventListener('click', onLuaClick);
  luaInput.addEventListener('blur', () => { if (luaStaleFlag) luaGenerateFromScene({ preserve: true }); });

  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  on('btnLuaSync', () => luaGenerateFromScene({ preserve: true }));
  on('btnLuaCopy', luaCopy);
  on('btnLuaDownload', luaDownload);
  on('btnLuaHide', () => document.getElementById('mainGrid').classList.add('lua-hidden'));
  on('btnLuaToggle', () => document.getElementById('mainGrid').classList.toggle('lua-hidden'));

  luaGenerateFromScene({ preserve: false }); // initial skeleton from the loaded project
}
