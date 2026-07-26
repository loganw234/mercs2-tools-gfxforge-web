local KEYVAL = "f4"
-- Ess.UI theme showcase -- cycles through every built-in preset on a timer so the
-- customisation can be filmed rather than described.
--
-- Deploy: copy to scripts/OnKey/ and add to lua_loader.ini's [OnKey]:
--     ThemeShowcase.lua=f4
-- Press the key to start cycling, press it again to stop and restore the stock look.
--
-- THE POINT OF THE DEMO: open Ferdilanz's All-in-One Spawner (shift+f2) FIRST, leave it
-- open, then start this. His script is completely unmodified -- it has no idea themes
-- exist -- and it restyles along with everything else, because the look lives in
-- Ess.UI.Theme rather than in any individual script or movie.
--
-- Everything on screen while this runs is redrawn from theme values every switch:
-- his menu, a Panel, a Bar, and a List, all at once.

local Ess = _G.Ess
if not (Ess and Ess.UI and Ess.UI.Theme) then
    if Loader and Loader.Printf then
        Loader.Printf("[ThemeShowcase] needs the Essentials framework with Ess.UI.Theme")
    end
    return
end

-- Persist across the OnKey re-run, so the key really toggles.
_G.EssThemeShow = _G.EssThemeShow or { on = false, i = 0 }
local S = _G.EssThemeShow

local SECONDS = 2.5
local ORDER = { "classic", "cyan", "amber", "dusk", "slate", "neon", "mono" }

-- A one-line description per preset, shown in the demo panel so a viewer knows what
-- they are looking at without narration.
local BLURB = {
    classic = "the stock look -- unchanged from before theming existed",
    cyan    = "accent + selection recoloured, rounder corners, taller rows",
    amber   = "accent-coloured section headers and selection",
    dusk    = "soft low-contrast palette, radius 10",
    slate   = "muted, near-square corners, heavier panel",
    neon    = "loud: 2px accent border, square corners, bigger body text",
    mono    = "high contrast black/white -- a legibility option, not just a look",
}

local function buildShowcase()
    if S.panel then return end
    S.panel = Ess.UI.Panel{ x = 20, y = 40, w = 300, title = "ESS.UI THEMING" }
    S.bar = Ess.UI.Bar{ x = 20, y = 300, w = 300, h = 36, label = "A PROGRESS BAR", value = 0.62 }
    S.list = Ess.UI.List{
        x = 340, y = 40, w = 280, rows = 7, title = "A LIST",
        crumb = "themes > live",
        hint = "every widget restyles at once",
        items = {
            { header = "SECTION HEADER" },
            { label = "Selected row shows rowSelectedText" },
            { label = "Alternating row fills" },
            { label = "Scrollbar tracks the data" },
            { header = "ANOTHER SECTION" },
            { label = "Nothing here was re-exported" },
            { label = "It is all Ess.UI.Theme values" },
        },
    }
    -- Not focused: the showcase must not steal keys from the spawner menu, which is the
    -- whole point of having it open alongside.
end

local function describe(name)
    local p = S.panel
    if not p then return end
    p:title("THEME: " .. string.upper(name))
    p:line(0, BLURB[name] or "")
    p:line(1, "")
    p:line(2, "Ess.UI.Theme.preset(\"" .. name .. "\")")
    p:line(3, "")
    p:line(4, "or set keys directly:")
    p:line(5, "  Ess.UI.Theme.accent = 0x59D0FF")
    p:line(6, "  Ess.UI.Theme.rowHeight = 22")
    p:line(7, "  Ess.UI.Theme.apply()")
    p:line(8, "")
    p:line(9, "Ferdilanz's spawner (shift+f2) is")
    p:line(10, "unmodified and restyles too.")
end

local function step()
    S.i = (S.i % #ORDER) + 1
    local name = ORDER[S.i]
    -- preset() clears every override and applies the named set, then redraws every live
    -- widget -- including any menu another script has open.
    Ess.UI.Theme.preset(name)
    describe(name)
    return S.on
end

if S.on then
    S.on = false
    Ess.Loop.stop("Ess.UI.themeShowcase")
    Ess.UI.Theme.preset("classic")
    if S.panel then S.panel:hide() end
    if S.bar then S.bar:hide() end
    if S.list then S.list:hide() end
    Ess.UI.Toast("Theme showcase stopped -- back to classic")
else
    S.on = true
    buildShowcase()
    if S.panel then S.panel:show() end
    if S.bar then S.bar:show() end
    if S.list then S.list:show() end
    S.i = 0
    step()
    Ess.Loop.start("Ess.UI.themeShowcase", SECONDS, step)
    Ess.UI.Toast("Theme showcase: " .. #ORDER .. " presets every " .. SECONDS .. "s")
end
