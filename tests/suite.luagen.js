// Lua host-script generator (luagen.js): faithful idiom, event/function
// scraping, region mapping, and --#user preservation across regeneration.
const { loadContext, test, assert, assertEqual } = require('./run.js');

const project = {
  stage: { name: 'hud', width: 380, height: 150 },
  items: [
    { kind: 'button', event: 'quit', label: 'QUIT' },
    { kind: 'button', event: 'quit', label: 'QUIT2' }, // same event -> one handler
    { kind: 'menu', event: 'menuClick' },
    { kind: 'text', var: 'hp_val' },
  ],
  script: 'function SetHealth(n) {\n  _root.hp_val = n;\n  _root.bar._xscale = n;\n  if (n < 25) { fscommand("warn", n); }\n}\n',
};

const count = (s, sub) => s.split(sub).length - 1;

test('luagen: emits the verified FlashWidget host idiom', () => {
  const { code } = loadContext().Luagen.generate(project);
  assert(code.includes('MrxGuiBase.FlashWidget:new()'), 'spawns via FlashWidget:new');
  assert(code.includes('w:SetSwfFile("hud.gfx", nil, nil)'), 'loads the movie by asset name');
  assert(code.includes('MrxGuiManager.AddWidgetToHud(player, w)'), 'adds to HUD');
  assert(code.includes('_G.HUD = _G.HUD or {}'), 'per-movie persistent table from the asset name');
  assert(code.includes('local KEYVAL = "insert"'), 'default keybind');
  // repeat-press toggle must track state and use SetVisible; IsVisible is not a
  // real widget method (the API is GetVisible), and `not <0/1>` is truthy in Lua.
  assert(code.includes('S.w:SetVisible(S.shown)'), 'toggle uses tracked S.shown + SetVisible');
  assert(!code.includes('IsVisible'), 'never calls the nonexistent IsVisible method');
});

test('luagen: one handler per distinct event, from buttons and menus', () => {
  const { code, regions } = loadContext().Luagen.generate(project);
  assert(code.includes('w:SetFlashEventHandler("quit", function(_, v)'), 'quit handler');
  assert(code.includes('w:SetFlashEventHandler("menuClick", function(_, v)'), 'menu handler');
  assert(code.includes('w:SetFlashEventHandler("warn", function(_, v)'), 'handler for a script-fired fscommand (movie -> Lua)');
  assert(regions.some(r => r.kind === 'on' && r.key === 'warn'), 'warn region present');
  assertEqual(count(code, 'gfxforge:on quit'), 1, 'duplicate event collapses to a single handler');
  assert(regions.some(r => r.kind === 'on' && r.key === 'quit'), 'quit region present');
  assert(regions.some(r => r.kind === 'on' && r.key === 'menuClick'), 'menu region present');
  assert(regions.some(r => r.kind === 'build'), 'build region present');
});

test('luagen: scrapes script functions with the fields they update', () => {
  const { code, functions } = loadContext().Luagen.generate(project);
  assertEqual(functions.length, 1, 'one function found');
  assertEqual(functions[0].name, 'SetHealth', 'function name');
  assert(code.includes('call("SetHealth", { 0 })'), 'call example with a numeric placeholder');
  assert(code.includes('updates "hp_val"'), 'annotates the _root field it writes');
  assert(code.includes('moves "bar"'), 'annotates the clip it scales');
  assert(code.includes('Dynamic text fields you can drive: "hp_val"'), 'lists dynamic fields');
});

test('luagen: default bodies teach bidirectional patterns', () => {
  const { code } = loadContext().Luagen.generate(project);
  assert(code.includes('Event.Create(Event.TimerRelative'), 'helpers shows a self-rescheduling timer');
  assert(code.includes('read a real game value'), 'helpers shows reading a value to push in');
  assert(code.includes('call("SetHealth", { v })'), 'helpers poll pushes via the scene setter');
});

test('luagen: generates a live, clamped menu key-watch (not a broken comment)', () => {
  const menuProject = {
    stage: { name: 'hud' },
    items: [{ kind: 'menu', event: 'menuClick', options: ['New Game', 'Options', 'Quit'] }],
    script: 'function SetSelected(i) {\n  _root.sel._y = 50 + i * 24;\n}\n',
  };
  const { code, regions } = loadContext().Luagen.generate(menuProject);
  assert(code.includes('local function menu_keys()'), 'emits a live key-watch, not a comment');
  assert(code.includes('MENU_ROWS = 3'), 'row count comes from the menu options');
  assert(code.includes('math.min(MENU_ROWS - 1, S.sel + 1)'), 'down is clamped to the last row');
  assert(code.includes('d and not pd'), 'edge-triggered: one press moves one row');
  assert(code.includes('if S.w then menu_keys() end'), 'starts even if the HUD is already built');
  assert(regions.some(r => r.kind === 'menu'), 'menu region present for re-sync');
  assert(!code.includes('add edge-detection'), 'no incomplete example left behind');
});

test('luagen: keybind is configurable', () => {
  const { code } = loadContext().Luagen.generate(project, { key: 'delete' });
  assert(code.includes('local KEYVAL = "delete"'), 'honours opts.key');
  assert(code.includes('hud.lua=delete'), 'deploy note matches the key');
});

test('luagen: findRegions gives inclusive line spans that bracket the handler', () => {
  const ctx = loadContext();
  const { code } = ctx.Luagen.generate(project);
  const lines = code.split('\n');
  const r = ctx.Luagen.findRegions(code).find(x => x.kind === 'on' && x.key === 'quit');
  assert(r, 'found the quit region');
  assert(/--#region gfxforge:on quit/.test(lines[r.start - 1]), 'start line is the region marker');
  assert(/--#endregion/.test(lines[r.end - 1]), 'end line is the endregion marker');
  assert(r.end > r.start + 1, 'spans the handler body');
});

test('luagen: regeneration preserves the modder --#user code, resets the glue', () => {
  const ctx = loadContext();
  const first = ctx.Luagen.generate(project).code;
  assert(first.includes('TODO: your code for "quit"'), 'starts with the default body');

  // modder edits the quit handler body
  const edited = first.replace(
    /(--#user on:quit\n)[\s\S]*?(\n\s*--#enduser)/,
    '$1        Loader.Printf("SENTINEL_CUSTOM")$2'
  );
  assert(edited.includes('SENTINEL_CUSTOM'), 'sanity: edit applied');

  // re-sync (e.g. after adding another button elsewhere)
  const second = ctx.Luagen.generate(project, { existing: edited }).code;
  assert(second.includes('SENTINEL_CUSTOM'), 'custom code survives regeneration');
  assert(!second.includes('TODO: your code for "quit"'), 'default body was replaced by the kept one');
  assert(second.includes('TODO: your code for "menuClick"'), 'untouched handlers keep their default');
  // extractUserBlocks round-trips the key
  assert('on:quit' in ctx.Luagen.extractUserBlocks(second), 'user block key preserved');
});
