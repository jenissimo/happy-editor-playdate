-- Tiny scene loader for editor exports (version 1).
-- HappyEditor UI runtime facade. Scene data is generated; rendering services
-- live in the sibling ui/ modules so host projects can install one runtime.

Ui = Ui or {}
local RUNTIME_VERSION <const> = "3"
Ui.RUNTIME_VERSION = RUNTIME_VERSION

local pd <const> = playdate
local gfx <const> = pd.graphics

-- Playdate has import instead of Lua's require. Keep the facade installable as
-- one public module; repeated imports are no-ops on device and host Lua takes
-- the require fallback below.
if rawget(_G, "import") then
    import "ui_asset_catalog"
    import "ui_bake_catalog"
    import "ui/memory"
    import "ui/assets"
    import "ui/tree"
    import "ui/cache"
    import "ui/animation"
    import "ui/renderer"
end

local W <const> = 400
local H <const> = 240
--- Bundled default; mirrors src/core/scene/defaults.ts DEFAULT_FONT.
local DEFAULT_FONT <const> = "fonts/Roobert-11-Medium"
local function runtimeModule(global_name, path)
    local module = rawget(_G, global_name) or require(path)
    if module.RUNTIME_VERSION ~= RUNTIME_VERSION then
        error("[Ui] runtime module version mismatch: " .. global_name)
    end
    return module
end

local Assets <const> = runtimeModule("UiAssets", "ui.assets")
local Memory <const> = runtimeModule("UiMemory", "ui.memory")
local memory = Memory.new()
local catalog = rawget(_G, "UiAssetCatalog") or require("ui_asset_catalog")
local assets = Assets.new(gfx, DEFAULT_FONT, catalog, memory)
local Tree <const> = runtimeModule("UiTree", "ui.tree")
local Cache <const> = runtimeModule("UiCache", "ui.cache")
-- Build-time island rasters (editor/scripts/bake-islands.ts + build-playdate.ts's
-- staged-only regeneration); a checked-in empty catalog ships whenever no bake
-- has been folded into this Source tree, so this require always resolves --
-- see source/ui_bake_catalog.lua.
local bakeCatalog = rawget(_G, "UiBakeCatalog") or require("ui_bake_catalog")
local cache = Cache.new(gfx, W, H, memory, bakeCatalog, catalog)
local Animation <const> = runtimeModule("UiAnimation", "ui.animation")
local Renderer <const> = runtimeModule("UiRenderer", "ui.renderer")

-- Ui._dirty is declared below (with Ui.scene/Ui.state); referencing it here
-- through the Ui table works regardless of declaration order since this is a
-- closure over the table, not the field.
local function markDirty()
    Ui._dirty = true
end

local function invalidateAnimatedNode(node)
    cache:invalidateNode(node, "frame")
    markDirty()
end

--- 8-direction outline offsets (unit ring).
local OUTLINE_DIRS <const> = {
    { -1, -1 }, { 0, -1 }, { 1, -1 },
    { -1, 0 },           { 1, 0 },
    { -1, 1 },  { 0, 1 },  { 1, 1 },
}

Ui.scene = nil
Ui.state = "default"

--- Frame-level "does the screen need a fresh composite" flag. Every pure-UI
--- scene's update ends with gfx.clear()+Ui.draw() gated on Ui.needsDraw(): on
--- the (overwhelmingly common) frame where nothing about the scene changed,
--- the caller skips both and the Playdate framebuffer just keeps showing the
--- previous frame -- that's the whole saving, see CLAUDE.md "UI runtime".
--- Starts true so the very first draw after boot always composites.
Ui._dirty = true

--- Flat id-to-node map (includes groups + nested children). Built on load.
Ui._index = {}
--- Active property tweens for Ui.animate / Ui.update.
Ui._tweens = {}
--- Accumulated seconds for imagetable animation (advanced in Ui.update).
Ui._time = 0
--- Drawable nodes are rasterized independently and composited in tree order.
Ui._image_nodes = {}
Ui._anim_frames = {}
Ui._working = nil
Ui._baselines = setmetatable({}, { __mode = "k" })
Ui._proxies = {}

-- skip_key is only meaningful at the top-level call (see Ui.load): the
-- compiled plan lives solely on the caller's original scene table, so
-- excluding it here means neither the baseline nor the working clone ever
-- carries a second, dead copy of it.
local function cloneValue(value, seen, skip_key)
    if type(value) ~= "table" then return value end
    seen = seen or {}
    if seen[value] then return seen[value] end
    local out = {}; seen[value] = out
    for k, v in pairs(value) do
        if k ~= skip_key then out[cloneValue(k, seen)] = cloneValue(v, seen) end
    end
    return out
end

local function readonly(value, seen)
    if type(value) ~= "table" then return value end
    seen = seen or {}
    if seen[value] then return seen[value] end
    local proxy = {}
    seen[value] = proxy
    return setmetatable(proxy, {
        __index = function(_, key) return readonly(value[key], seen) end,
        __newindex = function() error("Ui scene views are read-only", 2) end,
        __pairs = function() return function(_, key)
            local next_key, next_value = next(value, key)
            if next_key ~= nil then return next_key, readonly(next_value, seen) end
        end, proxy, nil end,
        __len = function() return #value end,
        __metatable = false,
    })
end

local function loadFont(path)
    return assets:font(path)
end

local function drawableImage(node)
    local image = assets:drawable(node, Ui._time)
    return image
end

local function loadSlice(path, slice)
    return assets:slice(path, slice)
end

local function topLeft(node)
    return Tree.topLeft(node)
end

local function nodeVisible(node, state)
    local current = node
    while current do
        if not Tree.visible(current, state) then return false end
        current = Ui._parents and Ui._parents[current] or nil
    end
    return true
end

local function sameValue(a, b)
    return a == b
end

local function recordMutation(node, property, old_value, new_value)
    Cache.recordMutation(cache, node, property)
    if node.type == "group" and (property == "visible" or property == "states") then
        cache:invalidateUnpromotedGates()
    end
    -- Every call site above already guards on the value actually changing
    -- (setNodeProperty's sameValue check, applyGroupXYCascade's shifted_x/y
    -- comparison, Ui.setVisible's current==wanted check), so this alone
    -- covers Ui.setText/Ui.set/Ui.animate ticks/group-cascade moves/Ui.setVisible.
    markDirty()
end

local function setNodeProperty(node, property, value)
    local old_value = node[property]
    if sameValue(old_value, value) then return false end
    recordMutation(node, property, old_value, value)
    node[property] = value
    return true
end

local function setInk(color)
    if color == "white" then
        gfx.setColor(gfx.kColorWhite)
    else
        gfx.setColor(gfx.kColorBlack)
    end
end

local function clearPattern()
    gfx.setColor(gfx.kColorBlack)
end

local BAYER2 <const> = {
    { 0 / 4, 2 / 4 },
    { 3 / 4, 1 / 4 },
}

local BAYER4 <const> = {
    { 0 / 16, 8 / 16, 2 / 16, 10 / 16 },
    { 12 / 16, 4 / 16, 14 / 16, 6 / 16 },
    { 3 / 16, 11 / 16, 1 / 16, 9 / 16 },
    { 15 / 16, 7 / 16, 13 / 16, 5 / 16 },
}

local BAYER8 <const> = {
    { 0, 32, 8, 40, 2, 34, 10, 42 },
    { 48, 16, 56, 24, 50, 18, 58, 26 },
    { 12, 44, 4, 36, 14, 46, 6, 38 },
    { 60, 28, 52, 20, 62, 30, 54, 22 },
    { 3, 35, 11, 43, 1, 33, 9, 41 },
    { 51, 19, 59, 27, 49, 17, 57, 25 },
    { 15, 47, 7, 39, 13, 45, 5, 37 },
    { 63, 31, 55, 23, 61, 29, 53, 21 },
}

-- Cached nodes raster in local coordinates, while ordered patterns are
-- intentionally anchored to the screen to match the editor preview.
local dither_origin_x = 0
local dither_origin_y = 0

--- Ordered-dither / hatch test in screen space (matches editor procedural.ts).
local function ditherHit(pattern, density, sx, sy)
    sx = sx + dither_origin_x
    sy = sy + dither_origin_y
    local d = density or 0.5
    if d <= 0 then return false end
    if d >= 1 then return true end
    if pattern == "bayer2" then
        local t = BAYER2[(sy & 1) + 1][(sx & 1) + 1]
        return d > t
    elseif pattern == "bayer4" then
        local t = BAYER4[(sy & 3) + 1][(sx & 3) + 1]
        return d > t
    elseif pattern == "bayer8" then
        local t = BAYER8[(sy & 7) + 1][(sx & 7) + 1] / 64
        return d > t
    elseif pattern == "horizontal" then
        return (sy & 1) == 0 and d >= 0.25
    elseif pattern == "vertical" then
        return (sx & 1) == 0 and d >= 0.25
    elseif pattern == "diagonal" then
        -- Playdate-ish kDitherTypeDiagonalLine
        return ((sx + sy) & 1) == 0 and d >= 0.25
    elseif pattern == "screen" then
        -- Wire-screen mesh (SDK kDitherTypeScreen stand-in)
        return ((sx & 3) == 0 or (sy & 3) == 0) and d >= 0.25
    elseif pattern == "checker" then
        return ((sx ~ sy) & 1) == 0 and d >= 0.25
    elseif pattern == "dots" then
        return (sx & 3) == 0 and (sy & 3) == 0 and d >= 0.2
    end
    return d > 0.5
end

local function inRoundRect(px, py, w, h, radius)
    if px < 0 or py < 0 or px >= w or py >= h then
        return false
    end
    local r = radius or 0
    if r > w / 2 then r = w // 2 end
    if r > h / 2 then r = h // 2 end
    if r <= 0 then
        return true
    end
    if px >= r and px < w - r then
        return true
    end
    if py >= r and py < h - r then
        return true
    end
    local dx, dy
    if px < r then
        dx = r - px - 1
    else
        dx = px - (w - r)
    end
    if py < r then
        dy = r - py - 1
    else
        dy = py - (h - r)
    end
    return dx * dx + dy * dy <= r * r
end

-- Debug-only instrumentation: counts every per-pixel round-rect membership
-- test the rasterizers below actually perform (one markVisit() per visited
-- candidate pixel, win or lose). Cheap -- one integer add -- and nothing in
-- the shipped game ever reads it; test/ui_test.lua uses it to prove the
-- "skip the provably-interior region" optimization is real, not just a
-- refactor with the same asymptotic cost.
local pixel_visits = 0
local function markVisit()
    pixel_visits = pixel_visits + 1
end
function Ui._debugPixelVisits()
    return pixel_visits
end
function Ui._debugResetPixelVisits()
    pixel_visits = 0
end

-- inRoundRect clamps radius to at most half of w and half of h internally;
-- every routine below needs that SAME clamped value up front to size its
-- interior/edge/corner regions, so it's factored out once here rather than
-- re-derived (and risking drift) at each call site. Callers still pass the
-- original, unclamped radius into inRoundRect/ringPixel themselves -- those
-- re-clamp identically, so behavior is unchanged either way.
local function clampRadius(w, h, r)
    if r > w / 2 then r = w // 2 end
    if r > h / 2 then r = h // 2 end
    if r < 0 then r = 0 end
    return r
end

--- t concentric 1px rect outlines. For radius <= 0, inRoundRect(px,py,w,h,r)
--- is true for every in-bounds pixel, so a hollow ring of thickness t is
--- exactly "within t of any edge" -- and that set IS the union of the t
--- concentric outlines at insets 0..t-1 (the classic picture-frame
--- identity). Also correct whenever a nonzero radius CLAMPS to <= 0 (e.g. a
--- 1px-tall box): inRoundRect degrades to the same "always true" case, so
--- the ring is identical either way. Mirrors drawFrame's existing ring loop.
local function drawConcentricRectRing(x, y, w, h, t)
    for i = 0, t - 1 do
        local rw = w - 2 * i
        local rh = h - 2 * i
        if rw > 0 and rh > 0 then
            gfx.drawRect(x + i, y + i, rw, rh)
        end
    end
end

local function fillRoundOrRect(x, y, w, h, radius)
    if w <= 0 or h <= 0 then return end
    local r = radius or 0
    local cr = clampRadius(w, h, r)
    if cr <= 0 then
        gfx.fillRect(x, y, w, h)
        return
    end
    -- inRoundRect is true for a pixel whenever ITS px is in the horizontal
    -- middle band [cr, w-cr) OR its py is in the vertical middle band
    -- [cr, h-cr) -- so the union of those two bands (a "cross" covering the
    -- whole box except the four cr x cr corners) is provably interior and
    -- can be filled in up to three gfx.fillRect calls; only the corners
    -- need the actual per-pixel test.
    local midH = h - 2 * cr
    if midH > 0 then
        gfx.fillRect(x, y + cr, w, midH)
    end
    local midW = w - 2 * cr
    if midW > 0 then
        gfx.fillRect(x + cr, y, midW, cr)
        gfx.fillRect(x + cr, y + h - cr, midW, cr)
    end
    for py = 0, cr - 1 do
        for px = 0, cr - 1 do
            markVisit()
            if inRoundRect(px, py, w, h, r) then gfx.drawPixel(x + px, y + py) end
        end
        for px = w - cr, w - 1 do
            markVisit()
            if inRoundRect(px, py, w, h, r) then gfx.drawPixel(x + px, y + py) end
        end
    end
    for py = h - cr, h - 1 do
        for px = 0, cr - 1 do
            markVisit()
            if inRoundRect(px, py, w, h, r) then gfx.drawPixel(x + px, y + py) end
        end
        for px = w - cr, w - 1 do
            markVisit()
            if inRoundRect(px, py, w, h, r) then gfx.drawPixel(x + px, y + py) end
        end
    end
end

-- Fills every pixel of a w x h round-rect where hit(px, py, sx, sy) is true.
-- Unlike a solid fill, every pixel must still be VISITED -- hit varies per
-- pixel for a dither/gradient -- but the same "cross" interior argument as
-- fillRoundOrRect still applies to the round-rect MEMBERSHIP test: it's
-- provably true off the four corners, so only the corners pay for
-- inRoundRect and the rest go straight to hit().
local function fillRoundOrRectMasked(x, y, w, h, radius, hit)
    if w <= 0 or h <= 0 then return end
    local cr = clampRadius(w, h, radius or 0)
    if cr <= 0 then
        for py = 0, h - 1 do
            for px = 0, w - 1 do
                markVisit()
                if hit(px, py, x + px, y + py) then gfx.drawPixel(x + px, y + py) end
            end
        end
        return
    end
    for py = cr, h - cr - 1 do
        for px = 0, w - 1 do
            markVisit()
            if hit(px, py, x + px, y + py) then gfx.drawPixel(x + px, y + py) end
        end
    end
    for py = 0, cr - 1 do
        for px = cr, w - cr - 1 do
            markVisit()
            if hit(px, py, x + px, y + py) then gfx.drawPixel(x + px, y + py) end
        end
    end
    for py = h - cr, h - 1 do
        for px = cr, w - cr - 1 do
            markVisit()
            if hit(px, py, x + px, y + py) then gfx.drawPixel(x + px, y + py) end
        end
    end
    for py = 0, cr - 1 do
        for px = 0, cr - 1 do
            markVisit()
            if inRoundRect(px, py, w, h, radius) and hit(px, py, x + px, y + py) then gfx.drawPixel(x + px, y + py) end
        end
        for px = w - cr, w - 1 do
            markVisit()
            if inRoundRect(px, py, w, h, radius) and hit(px, py, x + px, y + py) then gfx.drawPixel(x + px, y + py) end
        end
    end
    for py = h - cr, h - 1 do
        for px = 0, cr - 1 do
            markVisit()
            if inRoundRect(px, py, w, h, radius) and hit(px, py, x + px, y + py) then gfx.drawPixel(x + px, y + py) end
        end
        for px = w - cr, w - 1 do
            markVisit()
            if inRoundRect(px, py, w, h, radius) and hit(px, py, x + px, y + py) then gfx.drawPixel(x + px, y + py) end
        end
    end
end

local function fillRoundOrRectDithered(x, y, w, h, radius, pattern, density)
    -- A coalesced island member's local offset from its island origin can be
    -- fractional too; floor before ditherHit's bitwise ops for the same
    -- 32-bit reason as the dither_origin floor in rasterNodeContent.
    x = math.floor(x)
    y = math.floor(y)
    fillRoundOrRectMasked(x, y, w, h, radius, function(px, py, sx, sy)
        return ditherHit(pattern, density, sx, sy)
    end)
end

local function drawShapeFill(fill, x, y, w, h, radius)
    if fill == nil or fill.kind == "none" then return end
    setInk(fill.color or "black")
    if fill.kind == "solid" then
        fillRoundOrRect(x, y, w, h, radius)
        clearPattern()
        return
    end
    if fill.kind == "dither" then
        fillRoundOrRectDithered(x, y, w, h, radius, fill.pattern or "checker", 0.5)
        clearPattern()
        return
    end
    if fill.kind == "gradient" then
        -- See fillRoundOrRectDithered: floor before the ditherHit bitwise ops.
        x = math.floor(x)
        y = math.floor(y)
        local from = fill.from or 0
        local to = fill.to or 1
        local axis = fill.axis or "h"
        fillRoundOrRectMasked(x, y, w, h, radius, function(px, py, sx, sy)
            local dens
            if axis == "h" then
                dens = (w <= 1) and to or (from + (to - from) * (px / (w - 1)))
            else
                dens = (h <= 1) and to or (from + (to - from) * (py / (h - 1)))
            end
            return ditherHit("bayer8", dens, sx, sy)
        end)
        clearPattern()
    end
end

-- True when (px, py) is part of a t-thick round-rect ring: inside the outer
-- w x h/radius shape but outside the (radius - t)-inset inner shape. Shared
-- by the solid/dashed/ticks round strokes so their "is this ring pixel lit"
-- rule can never drift from each other.
local function ringPixel(px, py, w, h, radius, t)
    if not inRoundRect(px, py, w, h, radius) then return false end
    local iw = w - t * 2
    local ih = h - t * 2
    if iw > 0 and ih > 0 then
        local ir = radius - t
        if ir < 0 then ir = 0 end
        if inRoundRect(px - t, py - t, iw, ih, ir) then return false end
    end
    return true
end

-- Visits every pixel that COULD be part of a t-thick ring stroke inset from
-- a w x h box with already-clamped corner radius cr: the t-thick border band
-- (top/bottom rows, left/right columns) plus the four cr x cr corner boxes.
-- Any pixel outside that set is at least t pixels from every edge AND
-- outside every corner box -- which, for any radius/thickness combination,
-- puts it in the INNER shape's own middle band (same cross argument as
-- fillRoundOrRect, applied to the t-inset shape), so ringPixel is always
-- false there and a stroke never needs to test it. See CLAUDE.md "UI
-- runtime" for the full argument and the measured before/after counts.
local function forEachRingCandidate(w, h, cr, t, fn)
    if w <= 0 or h <= 0 then return end
    local top_end = t; if top_end > h then top_end = h end
    if top_end < 0 then top_end = 0 end
    local bottom_start = h - t; if bottom_start < top_end then bottom_start = top_end end
    for py = 0, top_end - 1 do
        for px = 0, w - 1 do markVisit(); fn(px, py) end
    end
    for py = bottom_start, h - 1 do
        for px = 0, w - 1 do markVisit(); fn(px, py) end
    end
    local left_end = t; if left_end > w then left_end = w end
    if left_end < 0 then left_end = 0 end
    local right_start = w - t; if right_start < left_end then right_start = left_end end
    for py = top_end, bottom_start - 1 do
        for px = 0, left_end - 1 do markVisit(); fn(px, py) end
        for px = right_start, w - 1 do markVisit(); fn(px, py) end
    end
    if cr > 0 then
        for py = 0, cr - 1 do
            for px = 0, cr - 1 do markVisit(); fn(px, py) end
            for px = w - cr, w - 1 do markVisit(); fn(px, py) end
        end
        for py = h - cr, h - 1 do
            for px = 0, cr - 1 do markVisit(); fn(px, py) end
            for px = w - cr, w - 1 do markVisit(); fn(px, py) end
        end
    end
end

--- Hollow round-rect stroke matching the editor's procedural rasterizer.
local function drawRoundRectStroke(x, y, w, h, radius, thickness)
    if w <= 0 or h <= 0 then return end
    local t = thickness or 1
    local r = radius or 0
    local cr = clampRadius(w, h, r)
    if cr <= 0 then
        -- radius <= 0, or clamps to <= 0 on a tiny box: identical to the
        -- plain-rect case, see drawConcentricRectRing.
        drawConcentricRectRing(x, y, w, h, t)
        return
    end
    forEachRingCandidate(w, h, cr, t, function(px, py)
        if ringPixel(px, py, w, h, r, t) then
            gfx.drawPixel(x + px, y + py)
        end
    end)
end

local function drawRoundOrRect(x, y, w, h, radius)
    local r = radius or 0
    if r > 0 then
        gfx.drawRoundRect(x, y, w, h, r)
    else
        gfx.drawRect(x, y, w, h)
    end
end

local function drawDashedRect(x, y, w, h, thickness, dash, gap)
    gfx.setLineWidth(thickness or 1)
    local period = math.max(1, (dash or 4) + (gap or 3))
    local dlen = dash or 4
    -- top
    for i = 0, w - 1, period do
        local x2 = math.min(i + dlen, w)
        if x2 > i then
            gfx.drawLine(x + i, y, x + x2 - 1, y)
        end
    end
    -- bottom
    for i = 0, w - 1, period do
        local x2 = math.min(i + dlen, w)
        if x2 > i then
            gfx.drawLine(x + i, y + h - 1, x + x2 - 1, y + h - 1)
        end
    end
    -- left
    for i = 0, h - 1, period do
        local y2 = math.min(i + dlen, h)
        if y2 > i then
            gfx.drawLine(x, y + i, x, y + y2 - 1)
        end
    end
    -- right
    for i = 0, h - 1, period do
        local y2 = math.min(i + dlen, h)
        if y2 > i then
            gfx.drawLine(x + w - 1, y + i, x + w - 1, y + y2 - 1)
        end
    end
    gfx.setLineWidth(1)
end

local function drawTicksRect(x, y, w, h, step)
    local st = step or 6
    for i = 0, w - 1, st * 2 do
        local x2 = math.min(i + st, w - 1)
        gfx.drawLine(x + i, y, x + x2, y)
        gfx.drawLine(x + i, y + h - 1, x + x2, y + h - 1)
    end
    for i = 0, h - 1, st * 2 do
        local y2 = math.min(i + st, h - 1)
        gfx.drawLine(x, y + i, x, y + y2)
        gfx.drawLine(x + w - 1, y + i, x + w - 1, y + y2)
    end
end

local function drawShapeStroke(stroke, x, y, w, h, radius)
    if stroke == nil or stroke.kind == "none" then return end
    setInk(stroke.color or "black")
    if stroke.kind == "solid" then
        local t = stroke.thickness or 1
        -- Always use the pixel ring (incl. r=0) so sharp rects match the editor.
        drawRoundRectStroke(x, y, w, h, radius or 0, t)
    elseif stroke.kind == "double" then
        local t = stroke.thickness or 1
        local gap = stroke.gap or 2
        local r = radius or 0
        drawRoundRectStroke(x, y, w, h, r, t)
        local inset = t + gap
        local iw = w - inset * 2
        local ih = h - inset * 2
        if iw > 0 and ih > 0 then
            local ir = math.max(0, r - inset)
            drawRoundRectStroke(x + inset, y + inset, iw, ih, ir, t)
        end
    elseif stroke.kind == "dashed" then
        local r = radius or 0
        local cr = clampRadius(w, h, r)
        if r > 0 then
            -- Round dashed: same hollow round ring as solid, gated by dash phase
            local t = stroke.thickness or 1
            local period = math.max(1, (stroke.dash or 4) + (stroke.gap or 3))
            local dlen = stroke.dash or 4
            forEachRingCandidate(w, h, cr, t, function(px, py)
                if ringPixel(px, py, w, h, r, t) then
                    local on
                    if py < t or py >= h - t then
                        on = (px % period) < dlen
                    else
                        on = (py % period) < dlen
                    end
                    if on then
                        gfx.drawPixel(x + px, y + py)
                    end
                end
            end)
        else
            drawDashedRect(x, y, w, h, stroke.thickness or 1, stroke.dash or 4, stroke.gap or 3)
        end
    elseif stroke.kind == "ticks" then
        local r = radius or 0
        local cr = clampRadius(w, h, r)
        if r > 0 then
            local t = stroke.thickness or 1
            local st = stroke.step or 6
            forEachRingCandidate(w, h, cr, t, function(px, py)
                if ringPixel(px, py, w, h, r, t) then
                    local on
                    if py < t or py >= h - t then
                        on = (px // st) % 2 == 0
                    else
                        on = (py // st) % 2 == 0
                    end
                    if on then
                        gfx.drawPixel(x + px, y + py)
                    end
                end
            end)
        else
            gfx.setLineWidth(stroke.thickness or 1)
            drawTicksRect(x, y, w, h, stroke.step or 6)
            gfx.setLineWidth(1)
        end
    end
    clearPattern()
end

local function drawShape(node, x, y)
    local radius = node.cornerRadius or 0
    drawShapeFill(node.fill, x, y, node.w, node.h, radius)
    drawShapeStroke(node.stroke, x, y, node.w, node.h, radius)
end

local function drawFrame(node, x, y)
    local t = node.thickness or 1
    gfx.setColor(gfx.kColorBlack)
    if node.style == "double" then
        gfx.setLineWidth(1)
        gfx.drawRect(x, y, node.w, node.h)
        local inset = t + 1
        gfx.drawRect(x + inset, y + inset, node.w - 2 * inset, node.h - 2 * inset)
    elseif node.style == "ticks" then
        drawTicksRect(x, y, node.w, node.h, 6)
    else
        -- Concentric 1px rings so thickness is visible (setLineWidth+drawRect is flaky)
        gfx.setLineWidth(1)
        for i = 0, t - 1 do
            local rw = node.w - 2 * i
            local rh = node.h - 2 * i
            if rw > 0 and rh > 0 then
                gfx.drawRect(x + i, y + i, rw, rh)
            end
        end
    end
end

local function drawNodeContent(node, x, y)
    local t = node.type
    if t == "panel" then
        local ns = loadSlice(node.asset, node.slice)
        if ns then
            ns:drawInRect(x, y, node.w, node.h)
        else
            gfx.drawRect(x, y, node.w, node.h)
        end
    elseif t == "frame" then
        drawFrame(node, x, y)
    elseif t == "shape" then
        drawShape(node, x, y)
    elseif t == "image" then
        local img = drawableImage(node)
        if img then
            local tint = node.tint
            if tint == "white" then
                gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            elseif tint == "black" then
                gfx.setImageDrawMode(gfx.kDrawModeFillBlack)
            end
            img:draw(x, y)
            if tint == "white" or tint == "black" then
                gfx.setImageDrawMode(gfx.kDrawModeCopy)
            end
        else
            gfx.drawRect(x, y, node.w, node.h)
        end
    elseif t == "text" then
        local font = loadFont(node.font)
        if not font then
            return
        end
        gfx.setFont(font)
        -- drawTextInRect expects kTextAlignment.*, not gfx.kAlign*
        local align = kTextAlignment.left
        if node.align == "center" then
            align = kTextAlignment.center
        elseif node.align == "right" then
            align = kTextAlignment.right
        end
        local text = node.text or ""

        -- Integer nearest-neighbor scale (1-8). Layout in font pixels, then upscale.
        local scale = math.floor(node.scale or 1)
        if scale < 1 then scale = 1 end
        if scale > 8 then scale = 8 end

        local function drawTextAt(boxX, boxY, boxW, boxH)
            -- Inset so outline/shadow rings aren't clipped on left/top-aligned edges.
            local pad = 0
            local outline = node.outline
            if outline then
                local ow = outline.width or 1
                if ow < 1 then ow = 1 end
                pad = ow
                local outer = outline.outer
                if outer then
                    local oow = outer.width or 1
                    if oow < 1 then oow = 1 end
                    pad = pad + oow
                end
            end
            local shadow = node.shadow
            if shadow then
                local sx = math.abs(shadow.x or 1)
                local sy = math.abs(shadow.y or 1)
                if sx > pad then pad = sx end
                if sy > pad then pad = sy end
            end

            local tx, ty, tw, th = boxX, boxY, boxW, boxH
            if pad > 0 and tw > pad * 2 and th > pad * 2 then
                tx = boxX + pad
                ty = boxY + pad
                tw = boxW - pad * 2
                th = boxH - pad * 2
            end

            local _, textH = gfx.getTextSizeForMaxWidth(text, tw)
            local oy = 0
            local valign = node.valign or "top"
            if valign == "middle" then
                oy = math.floor((th - textH) / 2 + 0.5)
            elseif valign == "bottom" then
                oy = th - textH
            end

            local function drawTextInk(ox, oyOff, ink)
                if ink == "white" then
                    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
                else
                    gfx.setImageDrawMode(gfx.kDrawModeFillBlack)
                end
                gfx.drawTextInRect(
                    text,
                    tx + ox,
                    ty + oy + oyOff,
                    tw,
                    math.max(th, textH),
                    nil,
                    nil,
                    align
                )
                gfx.setImageDrawMode(gfx.kDrawModeCopy)
            end

            -- Clip so middle/bottom / outline / shadow stay inside the box.
            gfx.setClipRect(boxX, boxY, boxW, boxH)

            -- Draw order: shadow -> outer outline -> inner outline -> fill.
            if shadow then
                drawTextInk(shadow.x or 1, shadow.y or 1, shadow.color or "black")
            end

            if outline then
                local ow = outline.width or 1
                if ow < 1 then ow = 1 end
                local function drawOutlineRing(fromR, toR, ink)
                    for r = fromR, toR do
                        for di = 1, #OUTLINE_DIRS do
                            local d = OUTLINE_DIRS[di]
                            drawTextInk(d[1] * r, d[2] * r, ink)
                        end
                    end
                end
                -- Outer first, then inner (white-inside / black-outside stack).
                local outer = outline.outer
                if outer then
                    local oow = outer.width or 1
                    if oow < 1 then oow = 1 end
                    drawOutlineRing(ow + 1, ow + oow, outer.color or "black")
                end
                drawOutlineRing(1, ow, outline.color or "black")
            end

            drawTextInk(0, 0, node.color or "black")
            gfx.clearClipRect()
        end

        if scale == 1 then
            drawTextAt(x, y, node.w, node.h)
        else
            local lw = math.max(1, math.floor(node.w / scale))
            local lh = math.max(1, math.floor(node.h / scale))
            local img = cache:scratch(node)
            if not img then drawTextAt(x, y, node.w, node.h); return end
            gfx.pushContext(img)
            gfx.clear(gfx.kColorClear)
            drawTextAt(0, 0, lw, lh)
            gfx.popContext()
            gfx.setClipRect(x, y, node.w, node.h)
            img:drawScaled(x, y, scale, scale)
            gfx.clearClipRect()
        end
    end
end

local function drawNodeRotated(node, x, y, rot)
    -- Legacy rotation has no safe fixed scratch capacity. Draw directly rather
    -- than allocating an unledgered temporary; compiled nodes rotate their
    -- preallocated singleton buffer in drawCompiledScene.
    drawNodeContent(node, x, y)
end

local function indexNodes(nodes)
    Tree.index(nodes, Ui._index, Ui._image_nodes, Ui._parents)
end

local function applyGroupXYCascade(node, new_x, new_y)
    Tree.applyGroupXYCascade(node, new_x, new_y, function(child, old_x, old_y, shifted_x, shifted_y)
        if old_x ~= shifted_x then recordMutation(child, "x", old_x, shifted_x) end
        if old_y ~= shifted_y then recordMutation(child, "y", old_y, shifted_y) end
    end)
end

-- The two failure paths below (plan mismatch, preallocation exhaustion) both
-- need this. A shared function means they can never again drift and forget a
-- field. Order matters: every working ref -- including _parents, which pins
-- the previous scene's nodes -- must be dropped BEFORE assets:reset(), since
-- that is the controlled collection point (it runs collectgarbage right
-- after). Reset first, collect second, or the old scene never gets freed.
local function installEmptyScene()
    Ui._working = { nodes = {}, defaultState = "default" }
    Ui.scene = readonly(Ui._working)
    Ui.state = "default"
    Ui._index, Ui._proxies, Ui._image_nodes, Ui._anim_frames, Ui._tweens, Ui._parents =
        {}, {}, {}, {}, {}, {}
    Ui._compiled = false
    Cache.reset(cache)
    assets:reset()
    markDirty()
end

function Ui.load(scene)
    -- A compiled scene and catalog are a generation pair. Never install a
    -- half-published plan: legacy tables intentionally remain supported.
    if type(scene) ~= "table" then return false end
    local compiled = scene._compiled
    if compiled then
        local reason
        if compiled.schemaRevision ~= "1" then reason = "schemaRevision"
        elseif compiled.compilerRevision ~= "ui-islands-4" then reason = "compilerRevision"
        elseif compiled.catalogRevision ~= catalog.revision then reason = "catalogRevision"
        elseif compiled.memoryFormulaRevision ~= catalog.memoryFormulaRevision then reason = "memoryFormulaRevision"
        elseif compiled.generationId ~= catalog.generationId then reason = "generationId"
        elseif type(compiled.maxUiBytes) ~= "number" or type(compiled.maxUiBitmaps) ~= "number" then
            reason = "maxUiBytes/maxUiBitmaps type"
        end
        if reason then
            print("[Ui] compiled plan rejected: " .. reason .. " mismatch")
            installEmptyScene()
            return false
        end
        -- The declared budget is a promise, not an enforcement: without this
        -- check a too-big plan fails partway through Cache.preallocateIslands
        -- below and silently renders a blank screen on device.
        local _, _, limit_bytes, limit_bitmaps = memory:stats()
        if compiled.maxUiBytes > limit_bytes or compiled.maxUiBitmaps > limit_bitmaps then
            print("[Ui] compiled plan exceeds ledger budget: declared " .. compiled.maxUiBytes
                .. " bytes/" .. compiled.maxUiBitmaps .. " bitmaps, allowed " .. limit_bytes
                .. " bytes/" .. limit_bitmaps .. " bitmaps")
            installEmptyScene()
            return false
        end
    end
    assets:setStrict(compiled ~= nil)
    assets:setAllowlist(compiled and compiled.allowlist or nil)
    local baseline = Ui._baselines[scene]
    if baseline == nil or baseline.revision ~= (compiled and compiled.sceneRevision or "legacy") then
        -- Working code only ever reads the compiled plan off the original
        -- scene (scene._compiled above), never off a clone, so excluding it
        -- here halves the deep-copy cost of every load for compiled scenes.
        baseline = { revision = compiled and compiled.sceneRevision or "legacy", value = cloneValue(scene, nil, "_compiled") }
        Ui._baselines[scene] = baseline
    end
    Ui._working = cloneValue(baseline.value)
    Ui.scene = readonly(Ui._working)
    Ui.state = Ui._working.defaultState or "default"
    Cache.reset(cache)
    assets:reset()
    Ui._tweens = {}
    Ui._time = 0
    Ui._index = {}
    Ui._proxies = {}
    Ui._image_nodes = {}
    Ui._parents = {}
    Ui._anim_frames = {}
    indexNodes(Ui._working.nodes or {})
    Ui._compiled = compiled and true or false
    if compiled then
        -- The resident set keeps every earlier scene's assets until something
        -- needs the room, but the islands are reserved BEFORE this scene's
        -- assets are preloaded (and so before Assets:reserveEvicting gets a
        -- chance to make room) -- a scene whose islands do not fit beside that
        -- residue used to install the empty scene. Drop the least recently used
        -- asset the incoming scene does not list and try again; a failed
        -- attempt has already handed its credit back (Cache:preallocateIslands).
        local placed = Cache.preallocateIslands(cache, compiled, Ui._index)
        while not placed do
            local victim = assets:pickEvictionVictim()
            if victim == nil then break end
            assets:evict(victim)
            Cache.reset(cache)
            placed = Cache.preallocateIslands(cache, compiled, Ui._index)
        end
        if not placed then
            print("[Ui] compiled plan preallocation failed (ledger exhausted mid-plan)")
            installEmptyScene()
            return false
        end
    else
        Cache.preallocate(cache, Ui._index)
    end
    if compiled then assets:preload(compiled.allowlist or {}) end
    -- Proxies are built lazily by Ui.find. Each one costs a table, a
    -- metatable and four closures, and the shipped game never calls Ui.find,
    -- so wrapping every node here would be pure load-time waste.
    -- A freshly loaded scene has never been composited: force the caller's
    -- next gated gfx.clear()+Ui.draw() rather than leaving stale Ui._dirty
    -- state (e.g. false, left over from the previous scene's last draw).
    markDirty()
    return true
end

function Ui.memoryStats()
    local bytes, bitmaps, limit_bytes, limit_bitmaps = memory:stats()
    return bytes, bitmaps, limit_bytes, limit_bitmaps, assets:failureCount()
end

function Ui.islandStats()
    return cache:islandStats()
end

--- Debug-only: the actual allocated raster buffer size backing a compiled
--- node -- the shared island bitmap for a singleton, or the member's own
--- promotion-pool slot for a coalesced island member (see Cache:effectiveSize
--- in ui/cache.lua). nil for an uncompiled scene or an unknown id.
--- test/ui_layouts_test.lua uses this as a tripwire: no image node's raster
--- may ever be smaller than what its catalog asset actually draws.
function Ui._debugRasterSize(id)
    local node = Ui._index[id]
    if node == nil then return nil end
    local island = cache.island_by_node[node]
    if island == nil then return nil end
    if #island.members == 1 then return island.width, island.height end
    local slot = island.pool[node]
    if slot == nil then return nil end
    return slot.width, slot.height
end

function Ui.setState(state)
    if Ui.state == state then return end
    Ui.state = state
    cache:invalidateUnpromotedGates()
    markDirty()
end

--- Recursive find by id (groups + nested). Prefer Ui._index after load.
--- Proxies are built lazily and memoized in Ui._proxies: readonly() costs a
--- table + metatable + 4 closures per node, and the shipped game never calls
--- this, so paying that cost eagerly for every node at load would be waste.
function Ui.find(id)
    if id == nil then return nil end
    local proxy = Ui._proxies[id]
    if proxy ~= nil then return proxy end
    local node = Ui._index[id]
    if node == nil then return nil end
    proxy = readonly(node)
    Ui._proxies[id] = proxy
    return proxy
end

--- Set text on a text node. No-op if missing or not type "text".
function Ui.setText(id, text)
    local node = Ui._index[id]
    if node == nil or node.type ~= "text" then return end
    setNodeProperty(node, "text", text or "")
end

--- Get text from a text node, or nil.
function Ui.getText(id)
    local node = Ui._index[id]
    if node == nil or node.type ~= "text" then return nil end
    return node.text
end

--- Set node.visible. On a group, hides the whole branch (draw early-out).
function Ui.setVisible(id, visible)
    local node = Ui._index[id]
    if node == nil then return end
    local wanted = visible and true or false
    local current = node.visible ~= false
    if current == wanted then return end
    recordMutation(node, "visible", current, wanted)
    node.visible = wanted
end

--- Ui.set patch keys and their required value type. File-scope so the ~30
--- Ui.set calls/frame the leaderboard makes don't each allocate a fresh
--- whitelist table.
local SETTABLE <const> = {
    x = "number", y = "number", w = "number", h = "number", rotation = "number",
    scale = "number", cornerRadius = "number", thickness = "number", fps = "number",
    frame = "number", frameStart = "number", frameEnd = "number",
    text = "string", font = "string", color = "string", align = "string",
    valign = "string", tint = "string", asset = "string", style = "string", name = "string",
    visible = "boolean", loop = "boolean", locked = "boolean",
    states = "table", outline = "table", shadow = "table", fill = "table",
    stroke = "table", slice = "table", anchor = "table",
}

--- Shallow-merge fields onto the node. Group x/y cascades to descendants.
function Ui.set(id, patch)
    local node = Ui._index[id]
    if node == nil or type(patch) ~= "table" then return false end
    -- Validate the entire patch before mutating so invalid caller data cannot
    -- leave a half-applied scene. Runtime topology is immutable after load.
    -- A wrong-typed value (e.g. a string where geometry math expects a
    -- number) is rejected here too, atomically, rather than blowing up later
    -- in drawShape/topLeft arithmetic.
    for k, v in pairs(patch) do
        if k == "id" or k == "type" or k == "children" or k == "_compiled" then return false end
        local expected_type = SETTABLE[k]
        if expected_type == nil or type(v) ~= expected_type then return false end
    end
    if Ui._compiled and not cache:canFit(node, patch.w, patch.h, patch.scale) then return false end
    local new_x = patch.x ~= nil and patch.x ~= node.x and patch.x or nil
    local new_y = patch.y ~= nil and patch.y ~= node.y and patch.y or nil
    applyGroupXYCascade(node, new_x, new_y)
    for k, v in pairs(patch) do
        setNodeProperty(node, k, cloneValue(v))
    end
    return true
end

local function easeLinear(t)
    return t
end

local function easeInOut(t)
    -- Smoothstep
    return t * t * (3 - 2 * t)
end

local function easeFn(name)
    if name == "inOut" then return easeInOut end
    return easeLinear
end

local function removeTweensForId(id)
    local kept = {}
    for i = 1, #Ui._tweens do
        local tw = Ui._tweens[i]
        if tw.id ~= id then
            kept[#kept + 1] = tw
        end
    end
    Ui._tweens = kept
end

--- Tween x/y/w/h/rotation toward props. Replaces any existing tween for id.
--- opts: duration (default 0.25), ease "linear"|"inOut", onComplete function?
function Ui.animate(id, props, opts)
    local node = Ui._index[id]
    if node == nil or type(props) ~= "table" then return false end
    opts = opts or {}
    if type(opts) ~= "table" then return false end

    local from = {}
    local to = {}
    for k, v in pairs(props) do
        if (k ~= "x" and k ~= "y" and k ~= "w" and k ~= "h" and k ~= "rotation") or type(v) ~= "number" then return false end
        from[k] = node[k] or 0
        to[k] = v
    end
    if next(to) == nil then return false end
    if Ui._compiled and not cache:canFit(node, to.w, to.h) then return false end
    for k, v in pairs(opts) do
        if k == "duration" then
            if type(v) ~= "number" or v < 0 then return false end
        elseif k == "ease" then
            if v ~= "linear" and v ~= "inOut" then return false end
        elseif k == "onComplete" then
            if type(v) ~= "function" then return false end
        else return false end
    end
    -- Validation above is intentionally complete: a rejected call preserves
    -- the active tween rather than cancelling it as a side effect.
    removeTweensForId(id)

    Ui._tweens[#Ui._tweens + 1] = {
        id = id,
        node = node,
        from = from,
        to = to,
        elapsed = 0,
        duration = opts.duration or 0.25,
        ease = easeFn(opts.ease),
        onComplete = opts.onComplete,
        lastX = node.x,
        lastY = node.y,
    }
    return true
end

--- Cancel tweens for id, or all tweens if id is nil.
function Ui.cancelAnimate(id)
    if id == nil then
        Ui._tweens = {}
        return
    end
    removeTweensForId(id)
end

--- Tick active tweens. Call from playdate.update before Ui.draw.
--- dt = delta seconds (e.g. getElapsedTime after resetElapsedTime each frame).
function Ui.update(dt)
    if dt == nil or dt ~= dt or dt < 0 then dt = 0 end
    Ui._time = (Ui._time or 0) + dt
    Animation.updateImageFrames(
        Ui._image_nodes, Ui._time, assets, Ui._anim_frames, invalidateAnimatedNode)
    local i = 1
    while i <= #Ui._tweens do
        local tw = Ui._tweens[i]
        local node = tw.node
        tw.elapsed = tw.elapsed + dt
        local dur = tw.duration
        if dur <= 0 then dur = 0.0001 end
        local t = tw.elapsed / dur
        if t > 1 then t = 1 end
        local e = tw.ease(t)

        local newX, newY = nil, nil
        for k, target in pairs(tw.to) do
            local start = tw.from[k]
            local value = start + (target - start) * e
            if k == "x" then
                newX = value
            elseif k == "y" then
                newY = value
            else
                setNodeProperty(node, k, value)
            end
        end

        if newX ~= nil or newY ~= nil then
            local changed_x = newX ~= nil and newX ~= node.x and newX or nil
            local changed_y = newY ~= nil and newY ~= node.y and newY or nil
            applyGroupXYCascade(node, changed_x, changed_y)
            if newX ~= nil then setNodeProperty(node, "x", newX) end
            if newY ~= nil then setNodeProperty(node, "y", newY) end
            tw.lastX = node.x
            tw.lastY = node.y
        end

        if t >= 1 then
            -- Snap to exact targets (incl. group cascade for final x/y).
            local final_x = tw.to.x ~= nil and tw.to.x ~= node.x and tw.to.x or nil
            local final_y = tw.to.y ~= nil and tw.to.y ~= node.y and tw.to.y or nil
            applyGroupXYCascade(node, final_x, final_y)
            for k, target in pairs(tw.to) do
                setNodeProperty(node, k, target)
            end
            local cb = tw.onComplete
            table.remove(Ui._tweens, i)
            if cb then cb() end
        else
            i = i + 1
        end
    end
end

local function rasterNodeContent(node, x, y, origin_x, origin_y)
    -- Ui.animate/Ui.set both permit fractional x/y (a tween mid-flight, or an
    -- anchor of 0.5 on an odd width), and origin can carry that fraction
    -- through to ditherHit's `sx & n`. A bitwise op on a non-integer float
    -- throws on Playdate's 32-bit Lua (see CLAUDE.md), so floor here rather
    -- than pay a per-pixel floor inside the hot dither loop.
    dither_origin_x = math.floor(origin_x)
    dither_origin_y = math.floor(origin_y)
    drawNodeContent(node, x, y)
    dither_origin_x = 0
    dither_origin_y = 0
end

local function drawCachedNode(node, x, y)
    local image = cache:drawNode(node, rasterNodeContent, x, y)
    if image then
        image:draw(x, y)
    else
        drawNodeContent(node, x, y)
    end
end

-- Every cached path rotates around the authored anchor. Keeping this helper
-- shared avoids singleton islands and promoted members drifting from legacy.
local function drawImageRotatedAtAnchor(image, node, rot)
    local w, h = node.w, node.h
    local ax = node.anchor and node.anchor.x or 0
    local ay = node.anchor and node.anchor.y or 0
    local pivotLocalX = ax * w
    local pivotLocalY = ay * h
    local prx = pivotLocalX - w / 2
    local pry = pivotLocalY - h / 2
    local rad = math.rad(rot)
    local cos = math.cos(rad)
    local sin = math.sin(rad)
    local rx = prx * cos + pry * sin
    local ry = -prx * sin + pry * cos
    image:drawRotated(node.x - rx, node.y - ry, rot)
end

local function drawCachedNodeRotated(node, x, y, rot)
    -- Rotated procedural nodes raster in local coordinates before the bitmap
    -- transform, matching the editor canvas convention.
    local image = cache:drawNode(node, rasterNodeContent, 0, 0)
    if not image then
        drawNodeRotated(node, x, y, rot)
        return
    end

    drawImageRotatedAtAnchor(image, node, rot)
end

local function drawSceneNodes()
    local scene = Ui._working
    Renderer.draw(
        scene and scene.nodes,
        Ui.state or "default",
        drawCachedNode,
        drawCachedNodeRotated,
        nodeVisible,
        topLeft
    )
end

local function drawCompiledIslandMember(node, island_x, island_y)
    if not nodeVisible(node, Ui.state or "default") then return end
    local x, y = topLeft(node)
    rasterNodeContent(node, x - island_x, y - island_y, island_x, island_y)
end

local function rasterCompiledSingleton(node)
    local x, y = topLeft(node)
    rasterNodeContent(node, 0, 0, x, y)
end

local function rasterPromotedMember(node)
    local x, y = topLeft(node)
    rasterNodeContent(node, 0, 0, x, y)
end

local function drawCompiledScene()
    cache:applyPromotions()
    local islands = cache.islands or {}
    for i = 1, #islands do
        local island = islands[i]
        if island.promoted then
            for j = 1, #island.members do
                local node = island.members[j]
                if nodeVisible(node, Ui.state or "default") then
                    local image = cache:drawPromoted(island, node, rasterPromotedMember)
                    local x, y = topLeft(node)
                    if (node.rotation or 0) ~= 0 then drawImageRotatedAtAnchor(image, node, node.rotation) else image:draw(x, y) end
                end
            end
        else
            local node = island.members[1]
            -- A singleton island keeps its warm raster while hidden/state-gated,
            -- but must never composite it until it becomes visible again.
            if #island.members ~= 1 or nodeVisible(node, Ui.state or "default") then
                local image = cache:drawIsland(island, #island.members == 1 and rasterCompiledSingleton or drawCompiledIslandMember)
                if image then
                    if #island.members == 1 then
                        if (node.rotation or 0) ~= 0 then drawImageRotatedAtAnchor(image, node, node.rotation)
                        else local x, y = topLeft(node); image:draw(x, y) end
                    else image:draw(island.x, island.y) end
                end
            end
        end
    end
end

function Ui.draw()
    local scene = Ui.scene
    if not scene then return end
    local previous_mode = gfx.getImageDrawMode and gfx.getImageDrawMode() or nil
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    if Ui._compiled and cache.islands then drawCompiledScene() else drawSceneNodes() end
    if previous_mode ~= nil then gfx.setImageDrawMode(previous_mode) end
    -- This IS the frame the caller's Ui.needsDraw()-gated redraw paid for:
    -- clear the flag so the next unmutated frame skips it again. Left unset
    -- on the `if not scene` early-out above, since nothing was composited.
    Ui._dirty = false
end

--- True when something has changed since the last Ui.draw() and the scene
--- needs a fresh gfx.clear()+Ui.draw() to stay correct. Pure-UI scenes gate
--- their per-frame repaint on this (see CLAUDE.md "UI runtime"); the
--- Playdate framebuffer persists between frames, so skipping both when this
--- is false leaves the previous, still-correct frame on screen for free.
function Ui.needsDraw()
    return Ui._dirty
end

--- Force the next Ui.needsDraw() to be true, e.g. after something painted
--- over the UI outside of Ui.draw itself -- a transition's wipe compositing
--- over the whole screen, or the system pause menu / keyboard closing.
function Ui.invalidate()
    Ui._dirty = true
end

function Ui.screenSize()
    return W, H
end

return Ui
