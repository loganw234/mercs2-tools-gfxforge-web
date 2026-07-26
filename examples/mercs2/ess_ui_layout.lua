-- Every Ess.UI widget on screen at once, laid out not to overlap, so positions and sizes
-- can be judged by eye and adjusted.
--
-- Canvas is 853x480 (see 42_ui_engine.lua). Layout below is a three-column grid with a
-- full-width row along the bottom:
--
--   x=8            x=294           x=580
--   +--------------+---------------+---------------+   y=8
--   | Panel        | List          | Chat          |
--   +--------------+---------------+---------------+   y=~200
--   | Bar          | Confirm       | Input         |
--   +--------------+---------------+---------------+   y=~300
--   | Board (list + detail + bar)          | Toasts|   y=~330
--   +--------------------------------------+-------+
--
--   LAY.all()     draw everything
--   LAY.hide()    clear it
--   LAY.where()   print every widget's ACTUAL box, as the movie laid it out
--
-- Nothing here takes focus -- Confirm and Input are shown purely as shapes so their
-- proportions can be judged without them grabbing the keyboard.

_G.LAY = _G.LAY or {}
local LAY = _G.LAY

-- Laid out for the canvas at the DEFAULT 65% scale: 1312 x 738 units.
-- Three columns of 416 with 20-unit gutters -> 12 .. 1300, i.e. 12 units of margin each
-- side. Toasts get the right-hand column below the fold.
--
-- Deliberately written as constants derived from the canvas rather than magic numbers, so
-- changing Ess.UI.setScale() and re-running LAY.all() still fills the screen.
local CW, CH = Ess.UI.CANVAS_W, Ess.UI.CANVAS_H
local MARGIN, GUT = 12, 20
local COLW = math.floor((CW - MARGIN * 2 - GUT * 2) / 3)
local COL1 = MARGIN
local COL2 = COL1 + COLW + GUT
local COL3 = COL2 + COLW + GUT
local ROW1, ROW2, ROW3 = 12, 200, 304

function LAY.all()
    LAY.hide()

    -- ---- row 1 -----------------------------------------------------------
    LAY.panel = Ess.UI.Panel{ x = COL1, y = ROW1, w = COLW, title = "PANEL" }
    LAY.panel:line(0, "Health: 100")
    LAY.panel:line(1, "Ammo: 240")
    LAY.panel:line(2, "Fuel: 62%")
    LAY.panel:line(3, "Zone: Maracaibo")
    LAY.panel:line(4, "Contracts: 3 open")

    LAY.list = Ess.UI.List{
        x = COL2, y = ROW1, w = COLW, rows = 6,
        title = "LIST", crumb = "root > list",
        hint = "UP/DOWN  ENTER  LEFT",
        items = {
            { header = "SECTION" },
            { label = "Alpha" }, { label = "Bravo" }, { label = "Charlie" },
            { header = "MORE" },
            { label = "Delta" }, { label = "Echo" }, { label = "Foxtrot" },
        },
    }
    LAY.list:select(3)

    LAY.chat = Ess.UI.Chat{ x = COL3, y = ROW1, w = COLW, title = "CHAT", lines = 5 }
    LAY.chat:push("Misha: on my way")
    LAY.chat:push("Ewan: found a spot upstairs")
    LAY.chat:push("Misha: copy that")

    -- ---- row 2 -----------------------------------------------------------
    LAY.bar = Ess.UI.Bar{ x = COL1, y = ROW2, w = COLW, h = 40, label = "FUEL  62%", value = 0.62 }

    -- Confirm and Input are singletons that normally grab focus. Shown here for shape
    -- only; focus is handed straight back so the demo cannot trap the keyboard.
    local prevFocus = Ess.UI.Focused()
    Ess.UI.Confirm{
        x = COL2, y = ROW2, title = "CONFIRM",
        text = "Delete the save file?",
        yes = "YES", no = "NO",
        onResult = function() end,
    }
    Ess.UI.Input{
        x = COL3, y = ROW2,
        prompt = "INPUT",
        text = "typed text",
        onSubmit = function() end,
    }
    Ess.UI._S.focus = prevFocus

    -- ---- row 3: board, full width of the left two-and-a-bit columns -------
    LAY.board = Ess.UI.Board{
        x = COL1, y = ROW3, w = COLW * 2 + GUT, h = 240, rows = 6,
        title = "BOARD", hint = "list + detail + bar",
        items = {
            { header = "AVAILABLE" },
            { label = "Oil Raid" }, { label = "Ambush" }, { label = "Escort" },
        },
    }
    LAY.board:select(2)
    LAY.board:detail{
        category = "DESTRUCTION",
        rewards = { "$8,000", "Fuel +300" },
        objectives = { "Destroy 4 tanks", "Reach the LZ" },
        progress = 0.4, progressText = "2/5",
    }

    -- ---- toasts: right of the board, below chat --------------------------
    Ess.UI.TOAST_X = CW - Ess.UI.TOAST_W - MARGIN
    Ess.UI.TOAST_Y = ROW3
    Ess.UI.Toast("First toast", { ttl = 600 })
    Ess.UI.Toast("Second toast", { ttl = 600 })
    Ess.UI.Toast("Third toast", { ttl = 600 })

    return "drawn: panel, list, chat, bar, confirm, input, board, 3 toasts"
end

-- Asks the MOVIE for each widget's real box rather than repeating the numbers above --
-- the panel and list auto-fit, so their heights are only knowable after layout.
function LAY.where()
    LAY.boxes = {}
    local function ask(name, w)
        if not w then return end
        local id = w._rtid
        if not id then return end
        Ess.UI._rtMetrics(id, function(ww, hh, t)
            LAY.boxes[#LAY.boxes + 1] = name .. " x=" .. tostring(t.x) .. " y=" .. tostring(t.y)
                .. " w=" .. tostring(ww) .. " h=" .. tostring(hh)
        end)
    end
    ask("panel", LAY.panel)
    ask("list", LAY.list)
    ask("chat", LAY.chat)
    ask("bar", LAY.bar)
    ask("board", LAY.board)
    return "asked -- read back with LAY.boxesOut()"
end

function LAY.boxesOut()
    return table.concat(LAY.boxes or {}, " | ")
end

function LAY.hide()
    for _, k in ipairs({ "panel", "list", "chat", "bar", "board" }) do
        if LAY[k] then pcall(function() LAY[k]:hide() end) end
    end
    local S = Ess.UI._S
    if S.confirm then S.confirm:hide() end
    if S.input then S.input:hide() end
    if S.toasts then
        for i = 1, 8 do if S.toasts[i] then S.toasts[i]:dismiss() end end
    end
    S.focus = nil
    return "cleared"
end

return "LAY loaded"
