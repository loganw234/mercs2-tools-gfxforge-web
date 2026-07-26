#!/usr/bin/env node
// Phase-0 spike for the Ess.UI rework: does GFx 2.1.57 in Mercenaries 2 actually
// support the runtime creation + drawing API, and can a runtime-created text
// field resolve the movie's IMPORTED font?
//
// The SDK source says yes to all of it (createEmptyMovieClip, createTextField,
// beginFill/curveTo/endFill, TextFormat, attachMovie, getNextHighestDepth,
// removeMovieClip are all on GFxSprite's method table). This confirms it in the
// real engine, because "the SDK has the method" and "it works in this build with
// this movie's font setup" are different claims.
//
// There is no way to see the game's screen from the harness, so nothing here
// relies on looking at pixels. Every check reports a NUMBER or a flag that would
// be impossible to produce if the feature were broken:
//
//   * drawing         -> getBounds() on the drawn clip. Non-zero extents mean
//                        real geometry landed in the display list.
//   * font resolution -> textWidth after setting text + TextFormat. A positive
//                        width means glyphs were found and measured; 0 means the
//                        font did not resolve, which is the failure that would
//                        force the design back to pooled attachMovie rows.
//   * an authored field's textWidth is reported alongside as a CONTROL, so a
//                        zero can be attributed to "runtime fields can't get the
//                        font" rather than "this movie has no font at all".
//
// Build:  node examples/mercs2/ess_probe.js   -> examples/mercs2/ess_probe.gfx
// Drive:  examples/mercs2/ess_probe.lua       (same directory)
//
// SHARED CONTRACT with ess_probe.lua — both sides must agree:
//   asset name      "ess_probe"        (inject as this)
//   Lua -> movie    RunProbe()         runs every check, returns + fires the event
//   movie -> Lua    fscommand("essProbe", "<k=v;k=v;...>")
//   exported symbol "ProbeRow"         attachMovie target
//   authored field  instance "ctl"     the font control

const path = require('path');
const fs = require('fs');

// The codec is browser-style (IIFE + globals), so load it through the repo's own
// test harness rather than re-implementing the sandbox — same approach as
// battery_test.js, and it exercises the real source files.
const { loadContext } = require(path.join(__dirname, '..', '..', 'tests', 'run.js'));
const { Compiler, GFMovie, Verify } = loadContext();

// ---------------------------------------------------------------- the AS2 probe
//
// Deliberately written against only the compiler's supported subset. Every
// result is stringified into one compact line because the live-test harness
// reads results out of a log file and truncates at the first newline.
const AS2 = `
// Runs every capability check and reports one flat "k=v;k=v;..." line.
// Called from Lua rather than running on frame 1, so the host's event handler is
// certainly registered before anything fires.
function RunProbe() {
    var r = "";
    var root = _root;

    // --- 1. runtime clip creation -------------------------------------------
    var holder = root.createEmptyMovieClip("probeHolder", 500);
    r = r + "cec=" + (holder == undefined ? "0" : "1") + ";";

    // --- 2. the vector drawing API ------------------------------------------
    // Includes curveTo, since rounded chrome is the whole point of drawing
    // procedurally rather than stretching authored art.
    holder.lineStyle(1, 0x59D0FF, 100);
    holder.beginFill(0x1A1C22, 90);
    holder.moveTo(0, 0);
    holder.lineTo(120, 0);
    holder.lineTo(120, 34);
    holder.curveTo(120, 40, 114, 40);
    holder.lineTo(0, 40);
    holder.lineTo(0, 0);
    holder.endFill();

    // getBounds is the only observable proof geometry landed -- no screenshots.
    var b = holder.getBounds(root);
    if (b == undefined) {
        r = r + "bw=nil;bh=nil;";
    } else {
        r = r + "bw=" + Math.round(b.xMax - b.xMin) + ";bh=" + Math.round(b.yMax - b.yMin) + ";";
    }

    // --- 3. gradient fill ----------------------------------------------------
    // Reported separately: a gradient failing while a solid fill works would
    // only cost the theme its gradients, not the design.
    var g = root.createEmptyMovieClip("probeGrad", 501);
    var okg = 1;
    g.beginGradientFill("linear", [0x59D0FF, 0x1A1C22], [100, 100], [0, 255]);
    g.moveTo(0, 0); g.lineTo(60, 0); g.lineTo(60, 20); g.lineTo(0, 20); g.lineTo(0, 0);
    g.endFill();
    var gb = g.getBounds(root);
    if (gb == undefined) { okg = 0; } else { if (gb.xMax - gb.xMin < 1) { okg = 0; } }
    r = r + "grad=" + okg + ";";

    // --- 4. runtime text field + the IMPORTED font --------------------------
    // The load-bearing check. textWidth > 0 means the font resolved.
    holder.createTextField("t1", 1, 4, 4, 110, 18);
    var t = holder.t1;
    r = r + "ctf=" + (t == undefined ? "0" : "1") + ";";
    if (t != undefined) {
        var fmt = new TextFormat();
        fmt.font = "_normal_Font";
        fmt.size = 13;
        fmt.color = 0xE1E5EC;
        r = r + "tfm=" + (fmt == undefined ? "0" : "1") + ";";
        t.text = "PROBE0123";
        t.setTextFormat(fmt);
        r = r + "tw=" + Math.round(t.textWidth) + ";";
        // Retry with embedFonts, which is what actually forces an imported
        // (rather than device) font in Flash. Reported separately so we learn
        // WHICH of the two works, not just that one of them did.
        t.embedFonts = true;
        t.setTextFormat(fmt);
        r = r + "twe=" + Math.round(t.textWidth) + ";";
        // and whether autoSize/wordWrap are honoured on a runtime field
        t.wordWrap = true;
        t.multiline = true;
        r = r + "th=" + Math.round(t.textHeight) + ";";
    }

    // --- 5. control: an AUTHORED field, same font ---------------------------
    // Isolates "runtime fields can't reach the font" from "no font at all".
    if (root.ctl == undefined) {
        r = r + "atw=nil;";
    } else {
        r = r + "atw=" + Math.round(root.ctl.textWidth) + ";";
    }

    // --- 6. attachMovie of an exported symbol -------------------------------
    var am = root.attachMovie("ProbeRow", "probeRow0", 520);
    r = r + "am=" + (am == undefined ? "0" : "1") + ";";
    // does the attached clip accept a runtime event handler? (mouse support)
    if (root.probeRow0 != undefined) {
        root.probeRow0.onRelease = function () { fscommand("essProbeClick", "row0"); };
        r = r + "evt=" + (root.probeRow0.onRelease == undefined ? "0" : "1") + ";";
    }

    // --- 7. depth allocation + teardown ------------------------------------
    r = r + "nhd=" + root.getNextHighestDepth() + ";";
    holder.removeMovieClip();
    r = r + "rm=" + (root.probeHolder == undefined ? "1" : "0") + ";";

    fscommand("essProbe", r);
    return r;
}

// A second entry point so the host can confirm Lua -> movie calls work at all,
// independently of whether any of the runtime API does.
function Ping() {
    fscommand("essProbe", "ping=1;");
    return 1;
}

// Lets the host write into the on-screen status field. There is no SetVariable
// native on FlashWidget, so a bound variable can only be reached through an AS2
// setter like this one.
function SetStatus(s) {
    _root.probe_status = s;
}
`;

// ------------------------------------------------------------------ the movie
const m = new GFMovie.Movie(320, 200, {
  name: 'ess_probe',
  fps: 30,
  background: [16, 17, 21],
});

// A visible frame so there's something on screen if anyone does look, and a
// baseline that the movie itself loads at all.
m.rect(0, 0, 320, 22, [232, 140, 24]);
m.text(6, 3, 'ESS PROBE', { size: 13, color: [25, 25, 25] });

// The font CONTROL: an authored field with an instance name, so the probe can
// read its textWidth. Also what pulls the ImportAssets2 font tag into the movie
// — without at least one authored text item there'd be no font to resolve.
m.text(6, 30, 'PROBE0123', { size: 13, color: [225, 229, 236], name: 'ctl', width: 200 });

// A status field the host can write into, so a human watching the screen sees
// the same answer the log gets.
m.text(6, 52, '(waiting)', { size: 11, color: [150, 156, 168], varName: 'probe_status', width: 300 });

// attachMovie needs an exported symbol. A clip placed off-stage keeps it out of
// the way while still defining the sprite that ProbeRow names.
m.clip('rowSrc', -400, -400, 100, 16, [52, 58, 68]).exportAs('ProbeRow');

m.script(Compiler.compileSource(AS2));

const out = m.build();
const dest = path.join(__dirname, 'ess_probe.gfx');
fs.writeFileSync(dest, out);

// Verify before shipping it into a game launch — a malformed movie would waste
// the whole round trip.
const summary = Verify.verifyGfx(out, { functions: ['RunProbe', 'Ping'] });
console.log('wrote ' + dest + '  (' + out.length + ' bytes)');
console.log('functions: ' + summary.functions.join(', '));
console.log('tags: ' + JSON.stringify(summary.tags));
