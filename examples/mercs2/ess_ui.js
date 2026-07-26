#!/usr/bin/env node
// Builds ess_ui.gfx -- the Ess.UI runtime movie.
//
// This is NOT a layout. The movie ships an AS2 UI toolkit and builds everything
// at runtime from parameters Lua sends, which is what lets one asset replace the
// eight fixed-slot templates and removes every capacity cap in the kit.
//
// Confirmed live in-game before any of this was written (see
// ess_probe.results.md): createEmptyMovieClip, createTextField + TextFormat
// against the movie's IMPORTED font, the vector drawing API including curveTo,
// attachMovie, getNextHighestDepth, removeMovieClip, and the movie -> Lua
// fscommand channel.
//
// Build: node examples/mercs2/ess_ui.js   -> examples/mercs2/ess_ui.gfx
// Drive: examples/mercs2/ess_ui_test.lua
//
// SHARED CONTRACT with the Lua side -- both must agree:
//   asset            "ess_ui"      -> SetSwfFile("ess_ui.gfx")
//   Lua -> movie     see ENTRY POINTS below
//   movie -> Lua     fscommand("essui", "<k=v;...>")     diagnostics
//                    fscommand("essuiRow", "<id>:<i>")   a row was clicked
//                    fscommand("essuiReady", "1")        movie finished loading

const path = require('path');
const fs = require('fs');
const { loadContext } = require(path.join(__dirname, '..', '..', 'tests', 'run.js'));
const { Compiler, GFMovie, Verify } = loadContext();

// ---------------------------------------------------------------------------
// The AS2 runtime.
//
// Written against the compiler's supported subset: objects, arrays, function
// expressions, for/while, switch, ++/--, ===. No try/catch -- this player routes
// the try opcode to "unsupported", so it is not available and not used.
//
// Conventions:
//   * persistent state hangs off _root explicitly (TH, W, POOL) rather than
//     relying on timeline-variable scope resolution
//   * every public entry point tolerates being called before its widget exists,
//     because Lua's call order is not guaranteed and a dropped early call is
//     normal (SetSwfFile is async)
//   * coordinates are the movie's own 640x480 virtual canvas; Scaleform scales
//     it to whatever the display is
// ---------------------------------------------------------------------------
const AS2 = `
// ============================ theme ==================================
// Every drawn value comes from here, so a theme is data rather than art. Lua
// pushes overrides with ThemeSet() and then calls ThemeApply() to redraw.
// Defaults reproduce the current kit's look so adopting this changes nothing
// visually until someone asks it to.
function ThemeDefaults() {
    return {
        accent: 0xE88C18, accentText: 0x191919,
        panelFill: 0x181A1F, panelAlpha: 92, panelBorder: 0x2A2E37, borderWidth: 1,
        rowFill: 0x1E2127, rowFillAlt: 0x22252C,
        rowHover: 0x2E333C, rowSelected: 0x59D0FF, rowSelectedText: 0x10151A,
        textPrimary: 0xE1E5EC, textDim: 0x969CA8, textAccent: 0x78D2FF,
        textHeader: 0xE1E5EC,
        barFill: 0x5AD078, barTrack: 0x282C34,
        // Not drawn by any chrome -- a shared palette for script authors to reference via
        // Ess.UI.Theme.get("danger"), so a mod's own colours track the active theme.
        warn: 0xFFC448, danger: 0xE05252,
        radius: 4, rowHeight: 18, titleHeight: 26, padding: 8,
        scrollbarWidth: 4,
        font: "_normal_Font", sizeTitle: 13, sizeBody: 11, sizeSmall: 10,
        // gradientAngle is the box-matrix rotation in radians. 1.5707963 (90 deg)
        // runs the ramp top-to-bottom across a header band. Exposed rather than
        // hardcoded because the right value depends on the band's aspect ratio,
        // and getting it wrong renders as a flat fill rather than an error.
        gradientHeader: 0, gradientAngle: 1.5707963, hoverEnabled: 0,
        // Body-resize easing, the "Forge feel" the old Lua heartbeat produced by
        // lerping a _yscale. Done in the movie now so it is frame-rate driven
        // rather than tied to a 20 Hz Lua tick, and so the heartbeat no longer
        // has to stay awake to animate. 0 disables it (snap).
        easing: 0.35,
        crumbHeight: 14, hintHeight: 14
    };
}

function ThemeInit() {
    if (_root.TH == undefined) { _root.TH = ThemeDefaults(); }
    if (_root.W == undefined) { _root.W = {}; }
    if (_root.NEXTD == undefined) { _root.NEXTD = 100; }
}

// A single override. Unknown keys are accepted rather than rejected so a newer
// Lua side can talk to an older movie without erroring; a nil value falls back
// to the default so a typo degrades gracefully instead of drawing nothing.
function ThemeSet(k, v) {
    ThemeInit();
    if (v == undefined || v == null) {
        var d = ThemeDefaults();
        _root.TH[k] = d[k];
    } else {
        _root.TH[k] = v;
    }
}

function ThemeGet(k) {
    ThemeInit();
    var v = _root.TH[k];
    if (v == undefined) { var d = ThemeDefaults(); return d[k]; }
    return v;
}

// Re-apply the theme to every live widget.
//
// This must RE-FIT, not just repaint. A theme can change rowHeight, titleHeight,
// padding or font size, and those move the row CLIPS and resize their text
// fields -- things Redraw() does not touch. An earlier version only called
// Redraw(), which painted row backgrounds at the new rowHeight while the clips
// stayed positioned at the old one: the selection bar visibly straddled two
// rows and every label sat offset from its background.
function ThemeApply() {
    ThemeInit();
    for (var id in _root.W) {
        var w = _root.W[id];
        if (w != undefined) {
            w.dirty = 1;
            if (w.kind == "rows") { RowsFit(id, w.nrows); }
            else if (w.kind == "panel") { PanelFit(id, w.nrows); }
            else { Redraw(id); }
        }
    }
}

// ============================ drawing =================================
// Rounded rectangle path. curveTo's control point sits on the sharp corner --
// a quadratic can't trace a true arc, but it is the standard approximation and
// it is what the authored shapes already use.
function PathRound(mc, x, y, w, h, r) {
    if (r > w / 2) { r = w / 2; }
    if (r > h / 2) { r = h / 2; }
    if (r <= 0) {
        mc.moveTo(x, y);
        mc.lineTo(x + w, y);
        mc.lineTo(x + w, y + h);
        mc.lineTo(x, y + h);
        mc.lineTo(x, y);
        return;
    }
    mc.moveTo(x + r, y);
    mc.lineTo(x + w - r, y);
    mc.curveTo(x + w, y, x + w, y + r);
    mc.lineTo(x + w, y + h - r);
    mc.curveTo(x + w, y + h, x + w - r, y + h);
    mc.lineTo(x + r, y + h);
    mc.curveTo(x, y + h, x, y + h - r);
    mc.lineTo(x, y + r);
    mc.curveTo(x, y, x + r, y);
}

// Solid (optionally bordered, optionally rounded) box.
function DrawBox(mc, x, y, w, h, fill, alpha, border, borderW, r) {
    if (borderW > 0) { mc.lineStyle(borderW, border, 100); } else { mc.lineStyle(); }
    mc.beginFill(fill, alpha);
    PathRound(mc, x, y, w, h, r);
    mc.endFill();
}

// Gradient box.
//
// The matrix is the FIFTH argument and it is MANDATORY: GFx checks NArgs > 4
// before touching the gradient at all (GFxSprite.cpp, GFx_SpriteCreateGradient),
// so a four-argument call silently draws a flat fill instead. That exact mistake
// produced a flat rectangle in the Phase-0 probe. The {matrixType:"box"} form is
// supported -- x/y/w/h/r, with r a rotation.
function DrawGradientBox(mc, x, y, w, h, c1, c2, a1, a2, r) {
    mc.lineStyle();
    mc.beginGradientFill("linear", [c1, c2], [a1, a2], [0, 255],
        { matrixType: "box", x: x, y: y, w: w, h: h, r: ThemeGet("gradientAngle") });
    PathRound(mc, x, y, w, h, r);
    mc.endFill();
}

// ============================ text ====================================
// createTextField + TextFormat against the movie's imported font. Verified
// live: a runtime field measures text identically to an authored one, so the
// imported font really does resolve here.
function MkText(parent, name, depth, x, y, w, h, size, color, wrap) {
    parent.createTextField(name, depth, x, y, w, h);
    var t = parent[name];
    if (t == undefined) { return undefined; }
    t.selectable = false;
    t.embedFonts = true;
    if (wrap) { t.multiline = true; t.wordWrap = true; }
    var fmt = new TextFormat();
    fmt.font = ThemeGet("font");
    fmt.size = size;
    fmt.color = color;
    t.setTextFormat(fmt);
    // Stash the format so SetText can reapply it -- assigning .text resets
    // formatting on a dynamic field.
    t.essFmt = fmt;
    return t;
}

function SetText(t, s) {
    if (t == undefined) { return; }
    t.text = s;
    if (t.essFmt != undefined) { t.setTextFormat(t.essFmt); }
}

// Re-style an EXISTING field after a theme change. Pooled fields outlive the
// theme they were created under, so size/colour/box have to be re-pushed or a
// live theme change only moves the chrome and leaves the text as it was.
function RestyleText(t, size, color, w, h) {
    if (t == undefined) { return; }
    var fmt = new TextFormat();
    fmt.font = ThemeGet("font");
    fmt.size = size;
    fmt.color = color;
    t.essFmt = fmt;
    if (w != undefined) { t._width = w; }
    if (h != undefined) { t._height = h; }
    t.setTextFormat(fmt);
    // reapply through the text itself, since assigning .text is what resets
    // formatting on a dynamic field
    SetText(t, t.text);
}

// ============================ depth allocation ========================
// Runtime clips get depths from a reserved range so they can never collide with
// anything authored. getNextHighestDepth exists but mixing it with authored
// depths invites surprises, so this keeps its own counter.
function NextDepth() {
    ThemeInit();
    _root.NEXTD = _root.NEXTD + 1;
    return _root.NEXTD;
}

// ============================ layout helpers ==========================
// Shared by the fit functions and Redraw, so the row positions and the chrome
// height can never disagree about where the body starts -- which is the class of
// bug that had a bar drawn through a panel earlier on.
// A widget with no title gets NO header band at all -- an empty accent-coloured bar
// above one line of text is what made toasts look unruly. Anything that wants a
// header simply sets one.
function RowTopFor(e) {
    var top = 0;
    if (e.title != undefined && e.title != "") { top = ThemeGet("titleHeight"); }
    else { top = ThemeGet("padding") / 2; }
    if (e.crumb != undefined && e.crumb != "") { top = top + ThemeGet("crumbHeight"); }
    return top;
}

function HintSpaceFor(e) {
    if (e.hint != undefined && e.hint != "") { return ThemeGet("hintHeight") + 4; }
    return 0;
}

// Vertical room the optional footer + two-option strip need, so a fit() reserves
// space for them instead of drawing them over the body text.
function ExtraSpaceFor(e) {
    var extra = 0;
    if (e.foot != undefined && e.foot != "") { extra = extra + ThemeGet("hintHeight") + 4; }
    if (e.choiceA != undefined && e.choiceA != "") { extra = extra + ThemeGet("rowHeight") + 10; }
    return extra;
}

// ============================ widget core =============================
// A widget is a plain object in _root.W plus one container clip. Nothing is
// pre-placed; the container is created on first use.
// Numeric guard. AS2 has no reliable isNaN here, but NaN is the only value that
// is not equal to itself -- so this catches both undefined and NaN, which is what
// matters: a NaN height silently makes beginFill draw NOTHING and poisons the rest
// of the fill session, so the panel background, row fills and selection highlight
// all vanish at once. That is exactly what happened when Rows() passed no height
// and the easing then computed h - undefined.
function Num(v, fallback) {
    if (v == undefined) { return fallback; }
    if (v != v) { return fallback; }
    return v;
}

function Ensure(id, x, y, w, h) {
    ThemeInit();
    var e = _root.W[id];
    if (e == undefined) {
        var d = NextDepth();
        var mc = _root.createEmptyMovieClip("essui_" + id, d);
        // dh is the DISPLAYED height, eased toward h. They start equal so a
        // widget's first draw is at its real size rather than growing into it.
        e = { id: id, mc: mc, depth: d, x: x, y: y, w: w, h: h, dh: h,
              title: "", crumb: "", hint: "", empty: "",
              lines: [], rows: [], nrows: 0, sel: -1,
              scrollOff: 0, scrollTotal: 0, scrollVis: 0,
              kind: "panel", value: 0, label: "", dirty: 1, fitted: -1 };
        _root.W[id] = e;
    }
    if (x != undefined) { e.x = x; }
    if (y != undefined) { e.y = y; }
    if (w != undefined) { e.w = w; }
    if (h != undefined) { e.h = h; }
    // Keep both heights numeric no matter what the caller passed. Rows() legitimately
    // omits h (the row count decides it), so h arrives undefined and must not be
    // allowed to reach the drawing code.
    e.h = Num(e.h, 0);
    e.dh = Num(e.dh, e.h);
    e.mc._x = e.x;
    e.mc._y = e.y;
    return e;
}

function Get(id) {
    ThemeInit();
    return _root.W[id];
}

// ============================ panel ===================================
// Title bar + an unbounded number of body lines. The 8-line cap in the current
// kit exists only because ui_panel.json hand-lists eight text fields; here rows
// are created on demand, so :line(20, ...) simply works.
function Panel(id, x, y, w, h) {
    var e = Ensure(id, x, y, w, h);
    e.kind = "panel";
    e.dirty = 1;
    Redraw(id);
    return 1;
}

function PanelTitle(id, s) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.title = s;
    if (e.titleTxt != undefined) { SetText(e.titleTxt, s); }
    return 1;
}

// i is 0-based, matching Ess.UI.Panel:line(i, s). No upper bound.
function PanelLine(id, i, s) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.lines[i] = s;
    if (i + 1 > e.nrows) { PanelFit(id, i + 1); }
    var t = e.rows[i];
    if (t != undefined) { SetText(t.txt, s); }
    return 1;
}

// Grows/shrinks the body to n lines, creating fields as needed and REUSING
// hidden ones rather than removing them -- the existing kit already prefers
// reuse over destroy churn, and hiding avoids depending on removeMovieClip
// clearing the screen.
function PanelFit(id, n) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    if (n < 0) { n = 0; }
    e.nrows = n;
    var rh = ThemeGet("rowHeight");
    var pad = ThemeGet("padding");
    var th = ThemeGet("titleHeight");
    for (var i = 0; i < n; i++) {
        var row = e.rows[i];
        if (row == undefined) {
            var holder = e.mc.createEmptyMovieClip("row" + i, NextDepth());
            var t = MkText(holder, "t", 1, 0, 0, e.w - pad * 2, rh,
                           ThemeGet("sizeBody"), ThemeGet("textPrimary"), 0);
            row = { mc: holder, txt: t };
            e.rows[i] = row;
        } else {
            // a pooled row may predate the current theme
            RestyleText(row.txt, ThemeGet("sizeBody"), ThemeGet("textPrimary"), e.w - pad * 2, rh);
        }
        row.mc._x = pad;
        row.mc._y = RowTopFor(e) + pad / 2 + i * rh;
        row.mc._visible = true;
        if (e.lines[i] != undefined) { SetText(row.txt, e.lines[i]); }
    }
    // hide the surplus instead of removing it
    var total = e.rows.length;
    for (var j = n; j < total; j++) {
        if (e.rows[j] != undefined) { e.rows[j].mc._visible = false; }
    }
    e.h = RowTopFor(e) + pad + n * rh + pad / 2 + HintSpaceFor(e) + ExtraSpaceFor(e);
    e.dirty = 1;
    StartEase(id);
    Redraw(id);
    return 1;
}

function PanelClear(id) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.lines = [];
    PanelFit(id, 0);
    return 1;
}

// ============================ bar =====================================
function Bar(id, x, y, w, h, label, value) {
    var e = Ensure(id, x, y, w, h);
    e.kind = "bar";
    e.label = label;
    e.value = value;
    e.dirty = 1;
    Redraw(id);
    return 1;
}

function BarSet(id, value, label) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.value = value;
    if (label != undefined) { e.label = label; }
    e.dirty = 1;
    Redraw(id);
    return 1;
}

// ============================ rows / list =============================
// The list body. Rows are pooled and reused; a header row is skipped by the
// cursor, matching Ess.UI.List's contract.
function Rows(id, x, y, w, n) {
    var e = Ensure(id, x, y, w, undefined);
    e.kind = "rows";
    RowsFit(id, n);
    return 1;
}

function RowsFit(id, n) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    var rh = ThemeGet("rowHeight");
    var pad = ThemeGet("padding");
    var th = ThemeGet("titleHeight");
    e.nrows = n;
    for (var i = 0; i < n; i++) {
        var row = e.rows[i];
        if (row == undefined) {
            var holder = e.mc.createEmptyMovieClip("r" + i, NextDepth());
            var t = MkText(holder, "t", 1, pad, 1, e.w - pad * 2 - ThemeGet("scrollbarWidth"),
                           rh, ThemeGet("sizeBody"), ThemeGet("textPrimary"), 0);
            row = { mc: holder, txt: t, header: 0, label: "", idx: i };
            e.rows[i] = row;
            // Mouse support is OPT-IN. Some users would rather keep the mouse on
            // camera-look and navigate with the arrow keys they already use, so
            // handlers are only attached when the theme asks for them.
            if (ThemeGet("hoverEnabled")) { AttachRowMouse(e, row, id, i); }
        } else {
            RestyleText(row.txt, ThemeGet("sizeBody"), ThemeGet("textPrimary"),
                        e.w - pad * 2 - ThemeGet("scrollbarWidth"), rh);
            // force Redraw to re-apply the state colour, since the restyle above just
            // reset this row to the plain one
            row.curColor = undefined;
            // a theme may have turned mouse support on since this row was pooled
            if (ThemeGet("hoverEnabled") && row.mouse != 1) { AttachRowMouse(e, row, id, i); }
        }
        row.mc._y = RowTopFor(e) + i * rh;
        row.mc._visible = true;
    }
    var total = e.rows.length;
    for (var j = n; j < total; j++) {
        if (e.rows[j] != undefined) { e.rows[j].mc._visible = false; }
    }
    e.h = RowTopFor(e) + n * rh + HintSpaceFor(e) + ExtraSpaceFor(e) + 2;
    e.dirty = 1;
    StartEase(id);
    Redraw(id);
    return 1;
}

function RowSet(id, i, label, isHeader) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    if (i + 1 > e.nrows) { RowsFit(id, i + 1); }
    var row = e.rows[i];
    if (row == undefined) { return 0; }
    row.label = label;
    row.header = isHeader;
    SetText(row.txt, label);
    e.dirty = 1;
    Redraw(id);
    return 1;
}

function RowSelect(id, i) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.sel = i;
    e.dirty = 1;
    Redraw(id);
    return 1;
}

// Ess.UI.List's secondary chrome: a breadcrumb under the title and a hint line
// along the bottom. Both optional -- an empty string removes the band, so a list
// with no crumb is the same height as one that never had the concept.
function RowsMeta(id, crumb, hint) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.crumb = (crumb == undefined) ? "" : crumb;
    e.hint = (hint == undefined) ? "" : hint;
    e.dirty = 1;
    Redraw(id);
    return 1;
}

// The "nothing here" state, shown in place of rows.
function RowsEmpty(id, text) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.empty = (text == undefined) ? "" : text;
    e.dirty = 1;
    Redraw(id);
    return 1;
}

// Scrollbar. Takes the DATA offsets and lets the movie work out the thumb, rather
// than Lua computing pixel positions from constants baked to the old artwork --
// which is what tied the previous implementation to ui_list.gfx's exact layout.
function RowsScroll(id, off, total, vis) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.scrollOff = off;
    e.scrollTotal = total;
    e.scrollVis = vis;
    e.dirty = 1;
    Redraw(id);
    return 1;
}

// ============================ easing ==================================
// Eases the DISPLAYED height toward the real one, restoring the resize feel the
// Lua heartbeat used to produce -- but driven by the movie's own frames, so the
// heartbeat no longer has to stay awake to animate anything.
//
// The handler removes itself once it arrives, so an idle widget costs nothing.
function StartEase(id) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.h = Num(e.h, 0);
    e.dh = Num(e.dh, e.h);
    var k = ThemeGet("easing");
    // No easing, or the widget has never been drawn at a real size yet -> snap.
    // Easing from 0 would make every list visibly grow out of nothing on first paint.
    if (k <= 0 || e.dh == 0) { e.dh = e.h; Redraw(id); return 0; }
    e.mc.onEnterFrame = function () {
        var w = Get(id);
        if (w == undefined) { return; }
        w.h = Num(w.h, 0);
        w.dh = Num(w.dh, w.h);
        var d = w.h - w.dh;
        if (d < 0.5 && d > -0.5) {
            w.dh = w.h;
            delete w.mc.onEnterFrame;
        } else {
            w.dh = w.dh + d * k;
        }
        Redraw(id);
    };
    return 1;
}

// Runtime event handlers. Verified assignable and readable in the Phase-0
// probe; whether a real click DISPATCHES is still unconfirmed, which is the
// other reason this is opt-in.
function AttachRowMouse(e, row, id, i) {
    row.mouse = 1;
    row.mc.onRollOver = function () {
        e.hover = i;
        e.dirty = 1;
        Redraw(id);
    };
    row.mc.onRollOut = function () {
        if (e.hover == i) { e.hover = -1; }
        e.dirty = 1;
        Redraw(id);
    };
    row.mc.onRelease = function () {
        fscommand("essuiRow", id + ":" + i);
    };
}

// ============================ redraw ==================================
// One draw path for every widget kind, so a theme change only has to invalidate
// and re-run this.
function Redraw(id) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    var mc = e.mc;
    mc.clear();

    var r = ThemeGet("radius");
    var pad = ThemeGet("padding");
    var th = ThemeGet("titleHeight");
    var rh = ThemeGet("rowHeight");
    // Chrome is drawn at the EASED height so a resize glides; rows stay at their
    // real positions, which is what the old _yscale lerp effectively did too.
    //
    // Guarded at the draw site as well as at the source: a NaN or undefined height
    // makes beginFill draw nothing AND poisons the rest of the fill session, so the
    // background, row fills and selection highlight all disappear together with no
    // error anywhere. Cheap insurance against a silent blank widget.
    var H = Num(e.dh, Num(e.h, 0));
    if (H < 1) { H = Num(e.h, 0); }

    if (e.kind == "bar") {
        DrawBox(mc, 0, 0, e.w, H, ThemeGet("panelFill"), ThemeGet("panelAlpha"),
                ThemeGet("panelBorder"), ThemeGet("borderWidth"), r);
        var v = e.value;
        if (v < 0) { v = 0; }
        if (v > 1) { v = 1; }
        var inner = e.w - pad * 2;
        DrawBox(mc, pad, H - 8, inner, 5, ThemeGet("barTrack"), 100, 0, 0, 1);
        if (v > 0) {
            DrawBox(mc, pad, H - 8, inner * v, 5, ThemeGet("barFill"), 100, 0, 0, 1);
        }
        if (e.labelTxt == undefined) {
            e.labelTxt = MkText(mc, "lbl", 1, pad, 3, inner, rh,
                                ThemeGet("sizeBody"), ThemeGet("textPrimary"), 0);
        }
        SetText(e.labelTxt, e.label);
        return 1;
    }

    // panel / rows share the same chrome
    DrawBox(mc, 0, 0, e.w, H, ThemeGet("panelFill"), ThemeGet("panelAlpha"),
            ThemeGet("panelBorder"), ThemeGet("borderWidth"), r);

    // header, only when there is actually a title to put in it
    var hasTitle = (e.title != undefined && e.title != "");
    if (hasTitle) {
        if (ThemeGet("gradientHeader")) {
            DrawGradientBox(mc, 0, 0, e.w, th, ThemeGet("accent"), ThemeGet("panelFill"),
                            100, 100, r);
        } else {
            DrawBox(mc, 0, 0, e.w, th, ThemeGet("accent"), 100, 0, 0, r);
        }
        if (e.titleTxt == undefined) {
            e.titleTxt = MkText(mc, "ttl", 1, pad, 4, e.w - pad * 2, th - 6,
                                ThemeGet("sizeTitle"), ThemeGet("accentText"), 0);
        }
        SetText(e.titleTxt, e.title);
    } else if (e.titleTxt != undefined) {
        SetText(e.titleTxt, "");
    }

    // breadcrumb, just under the title bar
    var rowTop = th;
    if (e.crumb != undefined && e.crumb != "") {
        var ch = ThemeGet("crumbHeight");
        if (e.crumbTxt == undefined) {
            e.crumbTxt = MkText(mc, "crm", 2, pad, th + 1, e.w - pad * 2, ch,
                                ThemeGet("sizeSmall"), ThemeGet("textAccent"), 0);
        }
        SetText(e.crumbTxt, e.crumb);
        rowTop = th + ch;
    } else if (e.crumbTxt != undefined) {
        SetText(e.crumbTxt, "");
    }
    e.rowTop = rowTop;

    if (e.kind == "rows") {
        var sw = ThemeGet("scrollbarWidth");
        var showBar = (e.scrollTotal > e.scrollVis && e.scrollVis > 0);
        for (var i = 0; i < e.nrows; i++) {
            var row = e.rows[i];
            if (row != undefined) {
                var y = rowTop + i * rh;
                var fill = ThemeGet("rowFill");
                if (i % 2 == 1) { fill = ThemeGet("rowFillAlt"); }
                if (e.hover == i) { fill = ThemeGet("rowHover"); }
                if (e.sel == i) { fill = ThemeGet("rowSelected"); }
                var rw = e.w - 2;
                if (showBar) { rw = rw - sw - 2; }
                // Row text colour follows its state, so a light selection bar can carry
                // dark text instead of the label vanishing into it. Only re-styled when the
                // colour actually changes -- rebuilding a TextFormat for every row on every
                // redraw would be wasteful during an ease.
                var tc = ThemeGet("textPrimary");
                if (row.header) { tc = ThemeGet("textHeader"); }
                else if (e.sel == i) { tc = ThemeGet("rowSelectedText"); }
                if (row.curColor != tc) {
                    RestyleText(row.txt, ThemeGet("sizeBody"), tc);
                    row.curColor = tc;
                }
                if (row.header) {
                    DrawBox(mc, 1, y, rw, rh, ThemeGet("panelFill"), 100, 0, 0, 0);
                } else {
                    DrawBox(mc, 1, y, rw, rh, fill, 100, 0, 0, 0);
                }
                row.mc._y = y;
            }
        }
        // Scrollbar. Thumb size and position come from the DATA offsets, so this
        // stays correct whatever the theme does to rowHeight.
        if (showBar) {
            var trackY = rowTop;
            var trackH = e.nrows * rh;
            var barX = e.w - sw - 2;
            DrawBox(mc, barX, trackY, sw, trackH, ThemeGet("barTrack"), 100, 0, 0, 1);
            var frac = e.scrollVis / e.scrollTotal;
            var tH = trackH * frac;
            if (tH < 12) { tH = 12; }
            var span = e.scrollTotal - e.scrollVis;
            var prog = 0;
            if (span > 0) { prog = e.scrollOff / span; }
            var tY = trackY + (trackH - tH) * prog;
            DrawBox(mc, barX, tY, sw, tH, ThemeGet("textDim"), 100, 0, 0, 1);
        }
        // the empty state, in place of rows
        if (e.nrows == 0 && e.empty != undefined && e.empty != "") {
            if (e.emptyTxt == undefined) {
                e.emptyTxt = MkText(mc, "emp", 3, pad, rowTop + 4, e.w - pad * 2, rh,
                                    ThemeGet("sizeBody"), ThemeGet("textDim"), 0);
            }
            SetText(e.emptyTxt, e.empty);
        } else if (e.emptyTxt != undefined) {
            SetText(e.emptyTxt, "");
        }
    }

    // two-option strip (Confirm), sitting above the hint line
    if (e.choiceA != undefined && e.choiceA != "") {
        var bh = rh + 4;
        var bw = (e.w - pad * 3) / 2;
        var by = H - bh - HintSpaceFor(e) - 6;
        var labels = [e.choiceA, e.choiceB];
        for (var ci = 0; ci < 2; ci++) {
            var bx = pad + ci * (bw + pad);
            var on = (e.pick == ci);
            var bf = ThemeGet("rowFill");
            var bt = ThemeGet("textPrimary");
            if (on) { bf = ThemeGet("rowSelected"); bt = ThemeGet("rowSelectedText"); }
            DrawBox(mc, bx, by, bw, bh, bf, 100, ThemeGet("panelBorder"),
                    ThemeGet("borderWidth"), ThemeGet("radius"));
            var cn = "ch" + ci;
            if (e[cn] == undefined) {
                e[cn] = MkText(mc, cn, 30 + ci, 0, 0, bw, bh, ThemeGet("sizeBody"), bt, 0);
            }
            var ct = e[cn];
            ct._x = bx + 8;
            ct._y = by + 3;
            ct._width = bw - 12;
            if (e[cn + "col"] != bt) {
                RestyleText(ct, ThemeGet("sizeBody"), bt);
                e[cn + "col"] = bt;
            }
            SetText(ct, labels[ci]);
        }
    }

    // footer line -- primary colour, so a typed echo reads as content not as a hint
    if (e.foot != undefined && e.foot != "") {
        var fh = ThemeGet("hintHeight") + 2;
        if (e.footTxt == undefined) {
            e.footTxt = MkText(mc, "ft", 5, pad, 0, e.w - pad * 2, fh,
                               ThemeGet("sizeBody"), ThemeGet("textPrimary"), 0);
        }
        e.footTxt._y = H - fh - HintSpaceFor(e) - 2;
        if (e.choiceA != undefined && e.choiceA != "") { e.footTxt._y = e.footTxt._y - ThemeGet("rowHeight") - 10; }
        SetText(e.footTxt, e.foot);
    } else if (e.footTxt != undefined) {
        SetText(e.footTxt, "");
    }

    // hint line along the bottom, inside the eased chrome
    if (e.hint != undefined && e.hint != "") {
        var hh = ThemeGet("hintHeight");
        if (e.hintTxt == undefined) {
            e.hintTxt = MkText(mc, "hnt", 4, pad, 0, e.w - pad * 2, hh,
                               ThemeGet("sizeSmall"), ThemeGet("textDim"), 0);
        }
        e.hintTxt._y = H - hh - 2;
        SetText(e.hintTxt, e.hint);
    } else if (e.hintTxt != undefined) {
        SetText(e.hintTxt, "");
    }

    e.dirty = 0;
    return 1;
}

// ============================ visibility ==============================
function Show(id, on) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    e.mc._visible = on ? true : false;
    return 1;
}

function Destroy(id) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    // Hidden, not removed: reuse is cheaper than churn, and it avoids depending
    // on removeMovieClip clearing the display rather than just the namespace.
    e.mc._visible = false;
    return 1;
}

// ============================ masking =================================
// setMask for list clipping/scrolling. Reported by Diag so we learn whether it
// works before anything depends on it.
function ApplyMask(id, w, h) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    if (e.maskMc == undefined) {
        e.maskMc = _root.createEmptyMovieClip("essuimask_" + id, NextDepth());
    }
    e.maskMc.clear();
    e.maskMc._x = e.x;
    e.maskMc._y = e.y;
    DrawBox(e.maskMc, 0, 0, w, h, 0xFFFFFF, 100, 0, 0, 0);
    e.mc.setMask(e.maskMc);
    e.masked = 1;
    return 1;
}

// ============================ choices / foot ==========================

// A two-option strip along the bottom of a panel, one highlighted -- what
// Ess.UI.Confirm's YES/NO needs. Two options rather than N because that is the
// only shape in the kit, and passing them as separate arguments avoids depending
// on String.split, which is not verified on this player.
function Choices(id, pick, a, b) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    var was = e.choiceA;
    e.choiceA = a;
    e.choiceB = b;
    e.pick = pick;
    e.dirty = 1;
    // Adding the strip for the first time changes how much room the body needs, so
    // re-run the fit rather than drawing over the message text.
    if (was != a && e.kind == "panel") { PanelFit(id, e.nrows); } else { Redraw(id); }
    return 1;
}

// A footer line drawn in the primary text colour, just above the (dimmer) hint.
// Used for the typed echo in Ess.UI.Input and Ess.UI.Chat, which wants to read as
// content rather than as a hint.
function Foot(id, text) {
    var e = Get(id);
    if (e == undefined) { return 0; }
    var had = (e.foot != undefined && e.foot != "");
    e.foot = (text == undefined) ? "" : text;
    var has = (e.foot != "");
    e.dirty = 1;
    if (had != has && e.kind == "panel") { PanelFit(id, e.nrows); } else { Redraw(id); }
    return 1;
}

// ============================ global scale ============================
// Scales the whole UI uniformly by scaling the root clip -- chrome, text, spacing and
// positions all together, which is what "make it 75%" actually means. Scaling only
// the theme's font sizes and row heights would shrink the text inside boxes that
// stayed the same size.
//
// Scaling DOWN also enlarges the usable canvas: at 75% the same widget rect holds
// 853 / 0.75 = 1137 units across. The Lua side widens CANVAS_W to match so
// anchor{right=} still lands on the real edge.
function SetScale(pct) {
    if (pct == undefined || pct <= 0) { pct = 100; }
    _root._xscale = pct;
    _root._yscale = pct;
    return pct;
}

// ============================ readiness / metrics =====================

// Pull-based readiness. The frame-1 push (fscommand on load) is unreliable
// because Lua registers its handler AFTER SetSwfFile returns, so the signal
// fires into the void -- confirmed live: readyAt came back nil while everything
// else worked. Polling this from Lua instead is immune to that ordering, and it
// is what should replace Ess.UI's 8-tick blind warm-up re-paint: poll until it
// answers, then paint once.
function Ready() {
    ThemeInit();
    fscommand("essuiReady", "1");
    return 1;
}

// Reports a widget's ACTUAL laid-out box. Panels auto-fit, so the caller cannot
// know the final height without duplicating the layout arithmetic -- which is
// exactly the mistake that put a bar through the middle of a 12-line panel
// during the first live test.
function Metrics(id) {
    var e = Get(id);
    if (e == undefined) { fscommand("essuiMetrics", id + ":none"); return 0; }
    // dh (the eased/displayed height) is reported alongside h because it is what
    // actually gets drawn. A NaN there silently blanks the whole widget with no
    // error, and reporting only h is why the harness could not see that happening --
    // the logic was all correct and nothing rendered.
    var s = id + ":x=" + Math.round(e.x) + ";y=" + Math.round(e.y)
          + ";w=" + Math.round(e.w) + ";h=" + Math.round(e.h)
          + ";dh=" + Math.round(e.dh) + ";vis=" + (e.mc._visible ? 1 : 0)
          + ";rows=" + e.nrows + ";kind=" + e.kind;
    fscommand("essuiMetrics", s);
    return 1;
}

// Reports the movie's own view of the canvas. Settles where the right and bottom
// edges actually are, which decides whether anchoring something to the right edge
// should use 640 or something wider on a widescreen display.
//
// Stage.width/height is what GFx itself thinks it is drawing into; scaleMode and
// align determine whether a 16:9 display gives extra width or just stretches the
// 4:3 canvas. Guessing at this from a screenshot is unreliable -- the panels are
// dark and blend into the scene.
function ScreenInfo() {
    var s = "sw=" + Stage.width + ";sh=" + Stage.height
          + ";mode=" + Stage.scaleMode + ";align=" + Stage.align
          + ";rw=" + Math.round(_root._width) + ";rh=" + Math.round(_root._height)
          + ";rx=" + Math.round(_root._xscale) + ";ry=" + Math.round(_root._yscale);
    fscommand("essuiScreen", s);
    return s;
}

// ============================ diagnostics =============================
// Answers the questions Phase 0 left open, in one call, and reports through the
// channel already proven to work.
function Diag() {
    ThemeInit();
    var r = "";

    // gradient WITH a matrix -- the four-arg form silently drew flat
    var g = _root.createEmptyMovieClip("diagGrad", 90);
    DrawGradientBox(g, 0, 0, 80, 20, 0x59D0FF, 0x181A1F, 100, 100, 0);
    var gb = g.getBounds(_root);
    r = r + "gradw=" + Math.round(gb.xMax - gb.xMin) + ";";

    // scale: how long does building 50 pooled rows take, and do they all exist?
    var t0 = getTimer();
    Rows("scale", 320, 40, 200, 50);
    for (var i = 0; i < 50; i++) { RowSet("scale", i, "row " + i, 0); }
    var t1 = getTimer();
    var made = 0;
    var se = Get("scale");
    for (var j = 0; j < 50; j++) { if (se.rows[j] != undefined) { made = made + 1; } }
    r = r + "rows=" + made + ";ms=" + (t1 - t0) + ";";

    // does a pooled row's text field actually hold its text?
    r = r + "rtxt=" + (se.rows[7].txt.text == "row 7" ? "1" : "0") + ";";
    r = r + "rtw=" + Math.round(se.rows[7].txt.textWidth) + ";";

    // shrink and regrow -- proves reuse rather than leaking clips
    RowsFit("scale", 5);
    var vis5 = se.rows[9].mc._visible ? "1" : "0";
    RowsFit("scale", 50);
    r = r + "hid=" + vis5 + ";regrow=" + (se.rows[9].mc._visible ? "1" : "0") + ";";

    // masking
    r = r + "mask=" + ApplyMask("scale", 200, 100) + ";";

    // depth allocator
    r = r + "nextd=" + _root.NEXTD + ";";

    fscommand("essui", r);
    return r;
}

// Draws four large gradient swatches at different box-matrix rotations, so the
// correct angle can be identified BY LOOKING rather than guessed. Each is cyan
// at ratio 0 and near-black at 255, big enough that a flat fill is unmistakable.
// Labelled with its angle.
//
// Needed because the only automated signal available is getBounds, which reports
// the same extents whether the gradient ramped or silently drew flat -- the
// failure mode that a four-argument beginGradientFill produced in Phase 0.
function GradTest() {
    ThemeInit();
    var host = _root.createEmptyMovieClip("gradTest", 95);
    host._x = 40;
    host._y = 60;
    host.clear();
    DrawBox(host, 0, 0, 300, 200, 0x101216, 95, 0x2A2E37, 1, 4);
    var angles = [0, 1.5707963, 3.1415927, 0.7853982];
    var names = ["r=0 (horizontal)", "r=PI/2 (vertical)", "r=PI", "r=PI/4"];
    for (var i = 0; i < 4; i++) {
        var y = 10 + i * 46;
        host.lineStyle();
        host.beginGradientFill("linear", [0x59D0FF, 0x101216], [100, 100], [0, 255],
            { matrixType: "box", x: 10, y: y, w: 180, h: 30, r: angles[i] });
        PathRound(host, 10, y, 180, 30, 2);
        host.endFill();
        var t = MkText(host, "gl" + i, 20 + i, 198, y + 6, 96, 20,
                       ThemeGet("sizeSmall"), ThemeGet("textDim"), 0);
        SetText(t, names[i]);
    }
    fscommand("essui", "gradtest=4;");
    return 1;
}

function GradTestClean() {
    _root.gradTest._visible = false;
    return 1;
}

// Tear the diagnostic widgets back down so the screen is clean for a visual pass.
function DiagClean() {
    Show("scale", 0);
    _root.diagGrad._visible = false;
    return 1;
}

// ============================ boot ====================================
ThemeInit();
// Tell Lua the movie is live. SetSwfFile is async and early calls get dropped,
// so this is the signal that replaces blind warm-up re-painting -- if it proves
// reliable, Ess.UI._WARMUP can go away.
fscommand("essuiReady", "1");
`;

// ---------------------------------------------------------------------------
// The movie. Deliberately almost empty: one authored text field to pull in the
// imported font (without it there is no font for runtime fields to resolve),
// and nothing else. Note the stage background is NOT relied on -- it is never
// drawn in-game, since the HUD widget composites transparent, so every panel
// draws its own fill.
// ---------------------------------------------------------------------------
// Stage is 853x480, i.e. 16:9 -- NOT 640x480.
//
// MrxGui's widget space is 480 tall and (480 * aspect) wide: 853 on a 16:9 display, 640 on
// 4:3. A 640-wide stage in a 640-wide widget rect therefore only ever covers the left ~75%
// of a widescreen display, which is exactly what was happening -- markers anchored to
// "right" landed three-quarters across the screen and "centre" was well left of centre.
//
// Building the stage at the widescreen size instead lets the Lua side lay out across the
// full 853 units. The widget RECT is sized to match per aspect (see rtEnsure in
// 42_ui_engine.lua): 853x480 on widescreen for a 1:1 mapping, 640x360 on 4:3 so the 16:9
// stage is letterboxed rather than squeezed.
const m = new GFMovie.Movie(853, 480, {
  name: 'ess_ui',
  fps: 30,
  background: [0, 0, 0],
});

// The font anchor. Off-stage so it never shows, but its presence is what emits
// the ImportAssets2 tag for _normal_Font.
m.text(-500, -500, '.', { size: 11, color: [255, 255, 255], name: 'fontAnchor', width: 20 });

m.script(Compiler.compileSource(AS2));

const out = m.build();
const dest = path.join(__dirname, 'ess_ui.gfx');
fs.writeFileSync(dest, out);

const summary = Verify.verifyGfx(out, {
  functions: ['ThemeSet', 'ThemeApply', 'RestyleText', 'Panel', 'PanelLine', 'PanelFit',
    'Bar', 'BarSet', 'Rows', 'RowsFit', 'RowSet', 'RowSelect', 'RowsMeta', 'RowsEmpty',
    'RowsScroll', 'StartEase', 'RowTopFor', 'Choices', 'Foot', 'ExtraSpaceFor', 'Redraw', 'Show',
    'Ready', 'Metrics', 'ScreenInfo', 'SetScale', 'Diag', 'GradTest'],
});
console.log('wrote ' + dest + '  (' + out.length + ' bytes)');
console.log('functions (' + summary.functions.length + '): ' + summary.functions.join(', '));
console.log('tags: ' + JSON.stringify(summary.tags));
