const fs = require('fs');
const path = require('path');
const { loadContext, test, assert, assertEqual } = require('./run.js');

// Rebuilds the uilib UI-kit movies from their gfxforge .json sources and diffs
// against the .gfx files that shipped with the kit.
//
// Those movies are the templates Ess.UI drives in-game, and they were built by
// this codebase before the timeline/placement/text work landed. Byte-identical
// output is therefore direct evidence that none of that work disturbed existing
// projects — considerably stronger than asserting it feature by feature.
//
// The kit lives outside this repo, so when it isn't present these assertions are
// skipped and say so, matching how the python3 zlib cross-checks behave rather
// than failing on a machine that just doesn't have the files.
const KIT_DIRS = [
  path.join(process.env.USERPROFILE || process.env.HOME || '', 'OneDrive', 'Desktop', 'uilib'),
  path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', 'uilib'),
];

const PAIRS = [
  ['ui_panel.json', 'ui_panel.gfx'],
  ['ui_bar.json', 'ui_bar.gfx'],
  ['ui_toast.json', 'ui_toast.gfx'],
  ['ui_confirm.json', 'ui_confirm.gfx'],
  ['ui_input.json', 'ui_input.gfx'],
  ['ui_list.json', 'ui_list.gfx'],
  ['chat_window.json', 'chat.gfx'],
  ['contracts_board.json', 'contracts.gfx'],
  ['forge.gfxproj.json', 'forge.gfx'],
];

function findKit() {
  for (const d of KIT_DIRS) {
    if (d && fs.existsSync(path.join(d, 'ui_panel.json'))) return d;
  }
  return null;
}

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');

function buildFromJson(ctx, obj) {
  const loaded = ctx.loadProjectFromObject(obj);
  ctx.state.stage = loaded.stage;
  ctx.state.items = loaded.items;
  ctx.state.script = loaded.script;
  return { bytes: ctx.buildMovieFromState().build(), warnings: loaded.warnings };
}

test('uikit: every kit movie still rebuilds byte-identically from its .json source', () => {
  const kit = findKit();
  if (!kit) {
    console.log('    (skipped: uilib kit not found next to this checkout — looked in '
      + KIT_DIRS.join(' and ') + ')');
    return;
  }
  const diffs = [];
  let checked = 0;
  for (const [jsonName, gfxName] of PAIRS) {
    const jsonPath = path.join(kit, jsonName);
    const gfxPath = path.join(kit, gfxName);
    if (!fs.existsSync(jsonPath) || !fs.existsSync(gfxPath)) continue;
    const ctx = loadContext();   // fresh module state per project
    const { bytes } = buildFromJson(ctx, JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    const ref = fs.readFileSync(gfxPath);
    checked++;
    if (hex(bytes) !== hex(ref)) {
      const a = Buffer.from(bytes);
      let i = 0;
      while (i < Math.min(a.length, ref.length) && a[i] === ref[i]) i++;
      diffs.push(`${jsonName}: built ${a.length}B vs shipped ${ref.length}B, first difference at byte ${i}`);
    }
  }
  assert(checked > 0, 'kit directory found but no json/gfx pairs were readable');
  assert(diffs.length === 0, `${diffs.length} of ${checked} kit movies changed:\n  ` + diffs.join('\n  '));
});

test('uikit: kit projects load without warnings and pass structural verification', () => {
  const kit = findKit();
  if (!kit) {
    console.log('    (skipped: uilib kit not found)');
    return;
  }
  const problems = [];
  for (const [jsonName] of PAIRS) {
    const jsonPath = path.join(kit, jsonName);
    if (!fs.existsSync(jsonPath)) continue;
    const ctx = loadContext();
    const { bytes, warnings } = buildFromJson(ctx, JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    if (warnings && warnings.length) problems.push(`${jsonName}: ${warnings.join(' | ')}`);
    try { ctx.Verify.verifyGfx(bytes); }
    catch (e) { problems.push(`${jsonName}: ${e.message}`); }
  }
  assert(problems.length === 0, 'kit projects reported problems:\n  ' + problems.join('\n  '));
});

test('uikit: the text fields Ess.UI binds by name survive a rebuild', () => {
  const kit = findKit();
  if (!kit) {
    console.log('    (skipped: uilib kit not found)');
    return;
  }
  // Ess.UI addresses these movies purely through bound variable names and clip
  // instance names, so those are the contract that must not drift. Reading them
  // back out of the built bytes (rather than off the project) checks the whole
  // encode path, not just the loader.
  const jsonPath = path.join(kit, 'ui_panel.json');
  if (!fs.existsSync(jsonPath)) return;
  const ctx = loadContext();
  const obj = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const expected = obj.items.filter(i => i.var).map(i => i.var);
  assert(expected.length > 0, 'ui_panel.json should bind some variables');
  const { bytes } = buildFromJson(ctx, obj);
  const { project } = ctx.Decode.decodeGfx(bytes);
  const got = project.items.filter(i => i.var).map(i => i.var);
  for (const name of expected) {
    assert(got.indexOf(name) >= 0, `bound variable "${name}" is missing from the rebuilt movie`);
  }
  // and the named clip Ess.UI resizes
  const clips = obj.items.filter(i => i.kind === 'clip').map(i => i.name);
  const gotClips = project.items.filter(i => i.kind === 'clip').map(i => i.name);
  for (const name of clips) {
    assert(gotClips.indexOf(name) >= 0, `clip instance "${name}" is missing from the rebuilt movie`);
  }
});
