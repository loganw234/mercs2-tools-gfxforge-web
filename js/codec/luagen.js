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
// guard), parameterised by the scene.
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

  // A lua-safe identifier fragment from an arbitrary fscommand/event name.
  function ident(s) {
    const t = String(s || '').replace(/[^A-Za-z0-9_]/g, '_');
    return /^[A-Za-z_]/.test(t) ? t : '_' + t;
  }

  // Distinct events the movie can fire, in first-appearance order, with a human
  // label for the comment. Buttons carry `.event`; a `menu` shorthand item
  // fires one shared event for all its rows.
  function collectEvents(items) {
    const seen = new Map();
    for (const it of items || []) {
      let ev = null, label = null;
      if (it.kind === 'button' && it.event) { ev = it.event; label = it.label || 'button'; }
      else if (it.kind === 'menu') { ev = it.event || 'menuClick'; label = 'menu'; }
      if (!ev || seen.has(ev)) continue;
      seen.set(ev, { event: ev, label });
    }
    return [...seen.values()];
  }

  // Walk from the params ')' to the matching '}' of a function body. Good enough
  // for the AS2 subset (no braces-in-strings gymnastics needed in practice).
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

  // Script functions the host can call, with their params and any _root.<var>
  // fields they write (so we can tell the modder what each call updates).
  function collectFunctions(script) {
    const out = [];
    const re = /function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(script || '')) !== null) {
      const name = m[1];
      const params = m[2].split(',').map(s => s.trim()).filter(Boolean);
      const body = functionBody(script, re.lastIndex);
      const vars = [];
      const vre = /_root\.([A-Za-z_]\w*)\s*=/g;
      let vm;
      while ((vm = vre.exec(body)) !== null) if (!vars.includes(vm[1])) vars.push(vm[1]);
      out.push({ name, params, vars });
    }
    return out;
  }

  // Text fields the movie exposes to the host (dynamic, var-bound text items).
  function collectVars(items) {
    const out = [];
    for (const it of items || []) if (it.kind === 'text' && it.var && !out.includes(it.var)) out.push(it.var);
    return out;
  }

  // A placeholder argument list for a call example, based on param names.
  function exampleArgs(params) {
    return params.map(p => /n|num|val|health|hp|amount|count|i|idx|index|sel/i.test(p) ? '0' : '""').join(', ');
  }

  // --- marker parsing (shared by the panel for highlighting + preservation) --

  const RE_REGION = /^\s*--#region\s+gfxforge:(\w+)(?:\s+(\S+))?\s*$/;
  const RE_ENDREGION = /^\s*--#endregion\s*$/;
  const RE_USER = /^\s*--#user\s+(\S+)\s*$/;
  const RE_ENDUSER = /^\s*--#enduser\s*$/;

  // All gfxforge:<kind> regions with their 1-based inclusive line spans. Nested
  // regions are supported (a handler region lives inside the build region).
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

  // Map of --#user key -> the raw inner lines (verbatim, markers excluded).
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
    const G = '_G.' + ident(asset).toUpperCase();       // per-movie persistent table
    const w = Math.round(stage.width || 380);
    const h = Math.round(stage.height || 150);

    const events = collectEvents(items);
    const funcs = collectFunctions(script);
    const vars = collectVars(items);

    // preserved modder code from a previous version of this file
    const kept = opts.existing ? extractUserBlocks(opts.existing) : {};
    // a --#user block: preserved lines if we have them, else the given default
    const userBlock = (k, indent, defaultLines) => {
      const pad = indent;
      const inner = Object.prototype.hasOwnProperty.call(kept, k)
        ? kept[k].split('\n')
        : defaultLines;
      return [pad + '--#user ' + k, ...inner, pad + '--#enduser'];
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
      p('    -- one handler per fscommand the movie can fire:');
      for (const ev of events) {
        p('    --#region gfxforge:on ' + ev.event);
        p('    -- Fired when the player triggers "' + ev.event + '"  (' + ev.label + ').');
        p('    pcall(function() w:SetFlashEventHandler("' + ev.event + '", function(_, v)');
        userBlock('on:' + ev.event, '        ', [
          '        -- v is the fscommand argument (a string) or nil.',
          '        -- TODO: your code for "' + ev.event + '".',
          '        Loader.Printf("[' + asset + '] ' + ev.event + ' -> " .. tostring(v))',
        ]).forEach(p);
        p('    end, {}) end)');
        p('    --#endregion');
      }
    } else {
      p('    -- (no buttons/menus in the scene yet, so no fscommand handlers)');
    }
    p('    return w');
    p('end');
    p('--#endregion');
    p('');
    p('--#region gfxforge:calls');
    p('-- Push values INTO the movie by calling its script functions:');
    if (funcs.length) {
      for (const fn of funcs) {
        const updates = fn.vars.length ? '   -- updates ' + fn.vars.map(v => '"' + v + '"').join(', ') : '';
        p('--   call("' + fn.name + '", { ' + exampleArgs(fn.params) + ' })' + updates);
      }
    } else {
      p('--   (add functions in the movie\'s Script tab, then Sync from scene)');
    }
    if (vars.length) {
      p('-- Dynamic text fields in this movie: ' + vars.map(v => '"' + v + '"').join(', ') + '.');
    }
    p('--#endregion');
    p('');
    p('-- Your own helpers, timers, and state can live here (kept across syncs):');
    userBlock('helpers', '', [
      '-- Example: a repeating timer that pushes a value every 0.3s.',
      '-- local function tick()',
      '--     Event.Create(Event.TimerRelative, { 0.30 }, tick)',
      '--     if S.w then call("SetHealth", { 100 }) end',
      '-- end',
    ]).forEach(p);
    p('');
    p('-- ---- build on first press, hide/show on repeat ----------------------');
    p('local ok, err = pcall(function()');
    p('    if not S.w then');
    p('        build()');
    p('        Loader.Printf("[' + asset + '] built")');
    userBlock('onbuild', '        ', [
      '        -- Runs once, right after the HUD is built. Set initial values:',
      '        -- call("SetHealth", { 100 })',
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
