// Scene -> Mercenaries 2 Lua host-script generator.
//
// The .gfx movie is only half of a custom HUD; the other half is a lua-loader
// "OnKey" script that spawns the FlashWidget, feeds it values
// (CallActionScriptCallback), and reacts to the fscommands it fires
// (SetFlashEventHandler). This module turns an editor project into a faithful
// skeleton of that script so a new modder gets a working, deployable starting
// point instead of a blank file.
//
// The emitted idiom mirrors the in-game-verified examples/mercs2/battery_test.lua
// exactly (MrxGuiBase.FlashWidget:new / SetLocation / SetSwfFile / the _G re-run
// guard), parameterised by the scene. It leans toward teaching: handlers cover
// both directions (movie->Lua fscommands and Lua->movie calls), and the default
// bodies carry small, correct, commented examples (poll a value and push it,
// move a clip, drive a menu highlight) for a beginner to adapt.
//
// Managed-region model: the whole file is regenerated on every "Sync from
// scene", but two kinds of fences let the modder's work survive:
//   --#region gfxforge:<kind> [key] ... --#endregion   -> generated glue, and
//                                                          the highlight anchors
//   --#user <key> ... --#enduser                        -> the modder's code,
//                                                          carried across syncs
// So generate(project, { existing }) re-emits the glue but re-inserts every
// --#user block found in `existing`, matched by key.
const Luagen = (function() {

  // --- small helpers ---------------------------------------------------------

  function ident(s) {
    const t = String(s || '').replace(/[^A-Za-z0-9_]/g, '_');
    return /^[A-Za-z_]/.test(t) ? t : '_' + t;
  }

  // Distinct events, in first-appearance order. Two directions of "event":
  //   - UI items (buttons/menus) the player triggers, and
  //   - fscommand("name", ...) calls the movie's own script fires back.
  // Each carries a source so the generated comment can explain what fires it.
  function collectEvents(items, script) {
    const seen = new Map();
    const btnCount = {};
    const add = (ev, label, source) => { if (ev && !seen.has(ev)) seen.set(ev, { event: ev, label, source }); };
    for (const it of items || []) {
      if (it.kind === 'button' && it.event) { btnCount[it.event] = (btnCount[it.event] || 0) + 1; add(it.event, it.label || 'button', 'button'); }
      else if (it.kind === 'menu') add(it.event || 'menuClick', 'menu', 'menu');
    }
    const fre = /fscommand\s*\(\s*["']([^"']+)["']/g;
    let m;
    while ((m = fre.exec(script || '')) !== null) add(m[1], 'fscommand', 'script');
    // several buttons sharing one event = a menu group (this is what a menu
    // expands into on load), so describe it as a row selection, not a button.
    for (const e of seen.values()) if (e.source === 'button' && btnCount[e.event] > 1) e.source = 'menu';
    return [...seen.values()];
  }

  function functionBody(src, fromIndex) {
    const open = src.indexOf('{', fromIndex);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
    }
    return src.slice(open + 1);
  }

  // Script functions the host can call, with the _root text fields they write
  // (vars) and the clips they move/scale (moves) -- so we can tell the modder
  // what each call actually does.
  function collectFunctions(script) {
    const out = [];
    const re = /function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(script || '')) !== null) {
      const name = m[1];
      const params = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      const body = functionBody(script, re.lastIndex);
      const vars = [], moves = [];
      let vm;
      const vre = /_root\.([A-Za-z_]\w*)\s*=/g;
      while ((vm = vre.exec(body)) !== null) if (!vars.includes(vm[1])) vars.push(vm[1]);
      const mre = /_root\.([A-Za-z_]\w*)\.(?:_x|_y|_xscale|_yscale|_rotation|_alpha|_visible)\b/g;
      while ((vm = mre.exec(body)) !== null) if (!moves.includes(vm[1])) moves.push(vm[1]);
      out.push({ name, params, vars, moves });
    }
    return out;
  }

  function collectVars(items) {
    const out = [];
    for (const it of items || []) if (it.kind === 'text' && it.var && !out.includes(it.var)) out.push(it.var);
    return out;
  }

  function exampleArgs(params) {
    return params.map((p) => (/n|num|val|health|hp|amount|count|i|idx|index|sel|pct|scale/i.test(p) ? '0' : '""')).join(', ');
  }

  // "   -- updates "hp_val"; moves "bar""  for a call cheat-sheet line.
  function callNote(fn) {
    const notes = [];
    if (fn.vars.length) notes.push('updates ' + fn.vars.map((v) => '"' + v + '"').join(', '));
    if (fn.moves.length) notes.push('moves ' + fn.moves.map((v) => '"' + v + '"').join(', '));
    return notes.length ? '   -- ' + notes.join('; ') : '';
  }

  // --- marker parsing (shared by the panel for highlighting + preservation) --

  const RE_REGION = /^\s*--#region\s+gfxforge:(\w+)(?:\s+(\S+))?\s*$/;
  const RE_ENDREGION = /^\s*--#endregion\s*$/;
  const RE_USER = /^\s*--#user\s+(\S+)\s*$/;
  const RE_ENDUSER = /^\s*--#enduser\s*$/;

  function findRegions(text) {
    const lines = String(text).split('\n');
    const stack = [], out = [];
    for (let i = 0; i < lines.length; i++) {
      const mr = RE_REGION.exec(lines[i]);
      if (mr) { stack.push({ kind: mr[1], key: mr[2] || null, start: i + 1 }); continue; }
      if (RE_ENDREGION.test(lines[i]) && stack.length) {
        const r = stack.pop();
        out.push({ kind: r.kind, key: r.key, start: r.start, end: i + 1 });
      }
    }
    return out;
  }

  function extractUserBlocks(text) {
    const lines = String(text).split('\n');
    const blocks = {};
    let key = null, buf = null;
    for (const line of lines) {
      if (key === null) {
        const mu = RE_USER.exec(line);
        if (mu) { key = mu[1]; buf = []; }
      } else if (RE_ENDUSER.test(line)) {
        blocks[key] = buf.join('\n');
        key = null; buf = null;
      } else {
        buf.push(line);
      }
    }
    return blocks;
  }

  // --- generation ------------------------------------------------------------

  function generate(project, opts) {
    opts = opts || {};
    const stage = (project && project.stage) || {};
    const items = (project && project.items) || [];
    const script = (project && project.script) || '';
    const asset = stage.name || 'hud';
    const key = opts.key || 'insert';
    const G = '_G.' + ident(asset).toUpperCase();
    const w = Math.round(stage.width || 380);
    const h = Math.round(stage.height || 150);

    const events = collectEvents(items, script);
    const funcs = collectFunctions(script);
    const vars = collectVars(items);
    const hasMenuNav = funcs.some((f) => /^SetSelected$/i.test(f.name)) || items.some((it) => it.kind === 'menu');
    const setter = funcs.find((f) => f.vars.length) || funcs[0] || null; // a good function to demo in examples

    const kept = opts.existing ? extractUserBlocks(opts.existing) : {};
    const userBlock = (k, indent, defaultLines) => {
      const inner = Object.prototype.hasOwnProperty.call(kept, k) ? kept[k].split('\n') : defaultLines;
      return [indent + '--#user ' + k, ...inner, indent + '--#enduser'];
    };

    const L = [];
    const p = (s) => L.push(s === undefined ? '' : s);

    p('-- =====================================================================');
    p('--  Generated by gfxforge for the movie "' + asset + '".');
    p('--');
    p('--  HOW THIS WORKS');
    p('--  The lua-loader re-runs this whole file each time you press the key');
    p('--  below (KEYVAL). First press builds the HUD; press again to hide it.');
    p('--');
    p('--  Two directions of talking to the movie:');
    p('--    Lua -> movie   call("Fn", { args })         (push values in)');
    p('--    movie -> Lua   w:SetFlashEventHandler(...)  (react to fscommands)');
    p('--');
    p('--  Blocks fenced by  --#region gfxforge:... --#endregion  are rewritten');
    p('--  when you click "Sync from scene". Put YOUR code in the --#user blocks');
    p('--  -- those are kept across syncs.');
    p('--');
    p('--  DEPLOY:  save as   <game>\\scripts\\OnKey\\' + asset + '.lua');
    p('--           then add  ' + asset + '.lua=' + key + '   under [OnKey] in lua_loader.ini');
    p('-- =====================================================================');
    p('local KEYVAL = "' + key + '"          -- key that runs this script (first 10 lines)');
    p('');
    p('import("MrxGuiBase")');
    p('import("MrxGuiManager")');
    p('');
    p(G + ' = ' + G + ' or {}          -- survives the re-run on each keypress');
    p('local S = ' + G);
    p('');
    p('-- Lua -> movie: call one of the movie\'s script functions (guarded).');
    p('local function call(fn, args)');
    p('    if S.w then pcall(function() S.w:CallActionScriptCallback(fn, args or {}) end) end');
    p('end');
    p('');
    p('--#region gfxforge:build');
    p('-- Creates the FlashWidget, loads ' + asset + '.gfx, and wires up events.');
    p('local function build()');
    p('    local player = Player.GetLocalPlayer()');
    p('    local w = MrxGuiBase.FlashWidget:new()');
    p('    pcall(function() w:SetOwner(player) end)');
    p('    w:SetLocation(40, 40, ' + w + ', ' + h + ')          -- x, y, then the movie w, h');
    p('    w:SetSwfFile("' + asset + '.gfx", nil, nil)');
    p('    MrxGuiBase.AddWidget(w)');
    p('    pcall(function() w:SetVisible(true) end)');
    p('    pcall(function() MrxGuiManager.AddWidgetToHud(player, w) end)');
    p('    S.w = w');
    if (events.length) {
      p('');
      p('    -- movie -> Lua: one handler per event the movie can fire.');
      for (const ev of events) {
        p('    --#region gfxforge:on ' + ev.event);
        if (ev.source === 'script') p('    -- Fires when the movie script calls fscommand("' + ev.event + '", ...).');
        else if (ev.source === 'menu') p('    -- Fires when the player picks a menu row (v = the row index).');
        else p('    -- Fires when the player clicks the "' + ev.label + '" button.');
        p('    pcall(function() w:SetFlashEventHandler("' + ev.event + '", function(_, v)');
        userBlock('on:' + ev.event, '        ', [
          '        -- v is the value the movie passed with the fscommand (a string), or nil.',
          '        -- TODO: your code for "' + ev.event + '".',
          '        Loader.Printf("[' + asset + '] ' + ev.event + ' -> " .. tostring(v))',
        ]).forEach(p);
        p('    end, {}) end)');
        p('    --#endregion');
      }
    } else {
      p('    -- (no buttons/menus or fscommands in the scene yet, so no handlers)');
    }
    p('    return w');
    p('end');
    p('--#endregion');
    p('');
    p('--#region gfxforge:calls');
    p('-- Lua -> movie: push values in by calling the movie\'s script functions.');
    if (funcs.length) {
      for (const fn of funcs) p('--   call("' + fn.name + '", { ' + exampleArgs(fn.params) + ' })' + callNote(fn));
    } else {
      p('--   (add functions in the movie\'s Script tab, then Sync from scene)');
    }
    if (vars.length) p('-- Dynamic text fields you can drive: ' + vars.map((v) => '"' + v + '"').join(', ') + '.');
    if (hasMenuNav) {
      p('--');
      p('-- Move a menu highlight from the keyboard: poll up/down and call SetSelected.');
      p('--   local i = 0');
      p('--   local function keys()');
      p('--       Event.Create(Event.TimerRelative, { 0.05 }, keys)   -- reschedule');
      p('--       if not S.w then return end');
      p('--       -- (add edge-detection so one press moves exactly one row)');
      p('--       if Loader.IsKeyDown(0x26) then i = i - 1; call("SetSelected", { i }) end   -- up');
      p('--       if Loader.IsKeyDown(0x28) then i = i + 1; call("SetSelected", { i }) end   -- down');
      p('--   end');
      p('--   keys()');
    }
    p('--#endregion');
    p('');
    p('-- Your own helpers, timers, and state can live here (kept across syncs):');
    userBlock('helpers', '', setter ? [
      '-- Example: poll a value ~3x a second and push it into the HUD.',
      '-- Uncomment, then swap the fake read for a real game value.',
      '-- local function poll()',
      '--     Event.Create(Event.TimerRelative, { 0.30 }, poll)   -- reschedule self',
      '--     if not S.w then return end',
      '--     local v = 100      -- TODO: read a real game value here',
      '--     call("' + setter.name + '", { v })' + callNote(setter),
      '-- end',
      '-- poll()',
    ] : [
      '-- local function tick()',
      '--     Event.Create(Event.TimerRelative, { 0.30 }, tick)   -- reschedule self',
      '--     if not S.w then return end',
      '--     -- call your movie functions here',
      '-- end',
      '-- tick()',
    ]).forEach(p);
    p('');
    p('-- ---- build on first press, hide/show on repeat ----------------------');
    p('local ok, err = pcall(function()');
    p('    if not S.w then');
    p('        build()');
    p('        Loader.Printf("[' + asset + '] built")');
    userBlock('onbuild', '        ', [
      '        -- Runs once, right after the HUD is built. Push initial values here:',
      setter ? '        -- call("' + setter.name + '", { 100 })' : '        -- call("YourFn", { 0 })',
    ]).forEach(p);
    p('    else');
    p('        pcall(function() S.w:SetVisible(not S.w:IsVisible()) end)');
    p('    end');
    p('end)');
    p('if not ok then Loader.Printf("[' + asset + '] ERROR: " .. tostring(err)) end');

    const code = L.join('\n') + '\n';
    return { code, regions: findRegions(code), events, functions: funcs };
  }

  return { generate, findRegions, extractUserBlocks, _internal: { collectEvents, collectFunctions, collectVars, ident } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Luagen;
