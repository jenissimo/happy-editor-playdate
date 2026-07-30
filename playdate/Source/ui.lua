-- Tiny scene loader for editor exports (version 1).
-- Keep this dumb: data in, draw out. No juice dependency yet.

Ui = Ui or {}

local pd <const> = playdate
local gfx <const> = pd.graphics

local W <const> = 400
local H <const> = 240
--- Bundled default; mirrors src/core/scene/defaults.ts DEFAULT_FONT.
local DEFAULT_FONT <const> = "fonts/Roobert-11-Medium"

--- 8-direction outline offsets (unit ring).
local OUTLINE_DIRS <const> = {
    { -1, -1 }, { 0, -1 }, { 1, -1 },
    { -1, 0 },           { 1, 0 },
    { -1, 1 },  { 0, 1 },  { 1, 1 },
}

Ui.scene = nil
Ui.state = "default"
Ui._fonts = {}
Ui._images = {}
Ui._tables = {}
Ui._slices = {}
--- Flat id → node map (includes groups + nested children). Built on load.
Ui._index = {}
--- Active property tweens for Ui.animate / Ui.update.
Ui._tweens = {}
--- Accumulated seconds for imagetable animation (advanced in Ui.update).
Ui._time = 0

local function resolveFontPath(path)
    if path == nil or path == "" then
        return DEFAULT_FONT
    end
    return path
end

local function loadFont(path)
    path = resolveFontPath(path)
    local cached = Ui._fonts[path]
    if cached ~= nil then
        return cached or nil
    end
    local font = gfx.font.new(path)
    if not font and path ~= DEFAULT_FONT then
        print("[Ui] font load failed: " .. tostring(path) .. " — trying " .. DEFAULT_FONT)
        font = gfx.font.new(DEFAULT_FONT)
        if font then
            Ui._fonts[DEFAULT_FONT] = font
            Ui._fonts[path] = font
            return font
        end
    end
    if not font then
        print("[Ui] default font load failed: " .. DEFAULT_FONT)
        Ui._fonts[path] = false
        return nil
    end
    Ui._fonts[path] = font
    return font
end

local function loadImage(path)
    if path == nil or path == "" then return nil end
    local cached = Ui._images[path]
    if cached ~= nil then
        return cached or nil
    end
    local img = gfx.image.new(path)
    Ui._images[path] = img or false
    return img
end

local function loadTable(path)
    if path == nil or path == "" then return nil end
    local cached = Ui._tables[path]
    if cached ~= nil then
        return cached or nil
    end
    local tab = gfx.imagetable.new(path)
    Ui._tables[path] = tab or false
    return tab
end

--- 1-based Playdate imagetable frame for an image node.
local function imageAnimFrame(node, tableLen)
    local start = node.frameStart or 1
    if start < 1 then start = 1 end
    local stop = node.frameEnd or tableLen
    if stop < start then stop = start end
    if stop > tableLen then stop = tableLen end
    local fps = node.fps or 0
    if fps <= 0 then
        local f = node.frame or start
        if f < start then f = start end
        if f > stop then f = stop end
        return f
    end
    local n = stop - start + 1
    local ticks = math.floor((Ui._time or 0) * fps)
    local loop = node.loop
    if loop == nil then loop = true end
    if loop then
        return start + (ticks % n)
    end
    local f = start + ticks
    if f > stop then f = stop end
    return f
end

local function drawableImage(node)
    local tab = loadTable(node.asset)
    if tab then
        local len = tab:getLength()
        if len and len > 0 then
            local i = imageAnimFrame(node, len)
            return tab:getImage(i)
        end
    end
    return loadImage(node.asset)
end

local function loadSlice(path, slice)
    if path == nil or path == "" or slice == nil then return nil end
    local key = path
        .. ":"
        .. slice.left
        .. ","
        .. slice.right
        .. ","
        .. slice.top
        .. ","
        .. slice.bottom
    local cached = Ui._slices[key]
    if cached ~= nil then
        return cached or nil
    end

    local filePath = string.format(
        "%s-slice-%d-%d-%d-%d",
        path,
        slice.left,
        slice.right,
        slice.top,
        slice.bottom
    )

    local img = gfx.image.new(filePath)
    if not img then
        img = gfx.image.new(path)
        filePath = path
    end
    if not img then
        Ui._slices[key] = false
        return nil
    end

    local iw, ih = img:getSize()
    local innerW = math.max(1, iw - slice.left - slice.right)
    local innerH = math.max(1, ih - slice.top - slice.bottom)
    local ns = gfx.nineSlice.new(filePath, slice.left, slice.top, innerW, innerH)
    Ui._slices[key] = ns or false
    return ns
end

local function topLeft(node)
    local ax = node.anchor and node.anchor.x or 0
    local ay = node.anchor and node.anchor.y or 0
    return node.x - ax * node.w, node.y - ay * node.h
end

local function nodeVisible(node, state)
    if node.visible == false then return false end
    local states = node.states
    if states == nil or #states == 0 then return true end
    for i = 1, #states do
        if states[i] == state then return true end
    end
    return false
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

--- Ordered-dither / hatch test in screen space (matches editor procedural.ts).
local function ditherHit(pattern, density, sx, sy)
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

local function fillRoundOrRect(x, y, w, h, radius)
    local r = radius or 0
    if r > 0 then
        for py = 0, h - 1 do
            for px = 0, w - 1 do
                if inRoundRect(px, py, w, h, r) then
                    gfx.drawPixel(x + px, y + py)
                end
            end
        end
    else
        gfx.fillRect(x, y, w, h)
    end
end

local function fillRoundOrRectDithered(x, y, w, h, radius, pattern, density)
    local r = radius or 0
    for py = 0, h - 1 do
        for px = 0, w - 1 do
            if (r <= 0 or inRoundRect(px, py, w, h, r))
                and ditherHit(pattern, density, x + px, y + py)
            then
                gfx.drawPixel(x + px, y + py)
            end
        end
    end
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
        local from = fill.from or 0
        local to = fill.to or 1
        local axis = fill.axis or "h"
        local r = radius or 0
        for py = 0, h - 1 do
            for px = 0, w - 1 do
                if r <= 0 or inRoundRect(px, py, w, h, r) then
                    local dens
                    if axis == "h" then
                        dens = (w <= 1) and to or (from + (to - from) * (px / (w - 1)))
                    else
                        dens = (h <= 1) and to or (from + (to - from) * (py / (h - 1)))
                    end
                    if ditherHit("bayer8", dens, x + px, y + py) then
                        gfx.drawPixel(x + px, y + py)
                    end
                end
            end
        end
        clearPattern()
    end
end

--- Hollow round-rect stroke matching the editor's procedural rasterizer.
local function drawRoundRectStroke(x, y, w, h, radius, thickness)
    local t = thickness or 1
    local r = radius or 0
    for py = 0, h - 1 do
        for px = 0, w - 1 do
            if inRoundRect(px, py, w, h, r) then
                local iw = w - t * 2
                local ih = h - t * 2
                local inside = false
                if iw > 0 and ih > 0 then
                    local ir = r - t
                    if ir < 0 then ir = 0 end
                    inside = inRoundRect(px - t, py - t, iw, ih, ir)
                end
                if not inside then
                    gfx.drawPixel(x + px, y + py)
                end
            end
        end
    end
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
        if (radius or 0) > 0 then
            -- Round dashed: same hollow round ring as solid, gated by dash phase
            local t = stroke.thickness or 1
            local period = math.max(1, (stroke.dash or 4) + (stroke.gap or 3))
            local dlen = stroke.dash or 4
            for py = 0, h - 1 do
                for px = 0, w - 1 do
                    if inRoundRect(px, py, w, h, radius) then
                        local iw = w - t * 2
                        local ih = h - t * 2
                        local inside = false
                        if iw > 0 and ih > 0 then
                            local ir = math.max(0, radius - t)
                            inside = inRoundRect(px - t, py - t, iw, ih, ir)
                        end
                        if not inside then
                            local on = false
                            if py < t or py >= h - t then
                                on = (px % period) < dlen
                            else
                                on = (py % period) < dlen
                            end
                            if on then
                                gfx.drawPixel(x + px, y + py)
                            end
                        end
                    end
                end
            end
        else
            drawDashedRect(x, y, w, h, stroke.thickness or 1, stroke.dash or 4, stroke.gap or 3)
        end
    elseif stroke.kind == "ticks" then
        if (radius or 0) > 0 then
            local t = stroke.thickness or 1
            local st = stroke.step or 6
            for py = 0, h - 1 do
                for px = 0, w - 1 do
                    if inRoundRect(px, py, w, h, radius) then
                        local iw = w - t * 2
                        local ih = h - t * 2
                        local inside = false
                        if iw > 0 and ih > 0 then
                            local ir = math.max(0, radius - t)
                            inside = inRoundRect(px - t, py - t, iw, ih, ir)
                        end
                        if not inside then
                            local on = false
                            if py < t or py >= h - t then
                                on = (px // st) % 2 == 0
                            else
                                on = (py // st) % 2 == 0
                            end
                            if on then
                                gfx.drawPixel(x + px, y + py)
                            end
                        end
                    end
                end
            end
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
            img:draw(x, y)
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

        local boxX, boxY, boxW, boxH = x, y, node.w, node.h
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

        -- Draw order: shadow → outer outline → inner outline → fill.
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

        drawTextInk(0, 0, "black")
        gfx.clearClipRect()
    end
end

local function drawNodeRotated(node, x, y, rot)
    local w, h = node.w, node.h
    local img = gfx.image.new(w, h, gfx.kColorClear)
    if not img then
        drawNodeContent(node, x, y)
        return
    end
    gfx.pushContext(img)
    gfx.clear(gfx.kColorClear)
    drawNodeContent(node, 0, 0)
    gfx.popContext()

    local ax = node.anchor and node.anchor.x or 0
    local ay = node.anchor and node.anchor.y or 0
    local pivotLocalX = ax * w
    local pivotLocalY = ay * h
    local prx = pivotLocalX - w / 2
    local pry = pivotLocalY - h / 2
    local rad = math.rad(rot)
    local cos = math.cos(rad)
    local sin = math.sin(rad)
    -- clockwise rotation of pivot-relative-to-center
    local rx = prx * cos + pry * sin
    local ry = -prx * sin + pry * cos
    img:drawRotated(node.x - rx, node.y - ry, rot)
end

local function drawNode(node, state)
    if not nodeVisible(node, state) then return end
    if node.type == "group" then
        local kids = node.children or {}
        for i = 1, #kids do
            drawNode(kids[i], state)
        end
        return
    end
    local x, y = topLeft(node)
    local rot = node.rotation or 0
    if rot == 0 then
        drawNodeContent(node, x, y)
    else
        drawNodeRotated(node, x, y, rot)
    end
end

local function indexNodes(nodes)
    if nodes == nil then return end
    for i = 1, #nodes do
        local node = nodes[i]
        if node and node.id then
            Ui._index[node.id] = node
        end
        if node and node.type == "group" then
            indexNodes(node.children)
        end
    end
end

--- Recursively shift all descendants by dx/dy (absolute coords in scene).
local function shiftDescendants(node, dx, dy)
    if node.type ~= "group" then return end
    local kids = node.children or {}
    for i = 1, #kids do
        local child = kids[i]
        child.x = (child.x or 0) + dx
        child.y = (child.y or 0) + dy
        shiftDescendants(child, dx, dy)
    end
end

--- If node is a group and newX/newY differ from current, cascade delta to kids.
--- Does not write group.x/y itself — caller merges those.
local function applyGroupXYCascade(node, newX, newY)
    if node.type ~= "group" then return end
    local dx = 0
    local dy = 0
    if newX ~= nil then dx = newX - (node.x or 0) end
    if newY ~= nil then dy = newY - (node.y or 0) end
    if dx == 0 and dy == 0 then return end
    shiftDescendants(node, dx, dy)
end

function Ui.load(scene)
    Ui.scene = scene
    Ui.state = scene.defaultState or "default"
    Ui._fonts = {}
    Ui._images = {}
    Ui._tables = {}
    Ui._slices = {}
    Ui._tweens = {}
    Ui._time = 0
    Ui._index = {}
    indexNodes(scene.nodes or {})
end

function Ui.setState(state)
    Ui.state = state
end

--- Recursive find by id (groups + nested). Prefer Ui._index after load.
function Ui.find(id)
    if id == nil then return nil end
    return Ui._index[id]
end

--- Set text on a text node. No-op if missing or not type "text".
function Ui.setText(id, text)
    local node = Ui.find(id)
    if node == nil or node.type ~= "text" then return end
    node.text = text or ""
end

--- Get text from a text node, or nil.
function Ui.getText(id)
    local node = Ui.find(id)
    if node == nil or node.type ~= "text" then return nil end
    return node.text
end

--- Set node.visible. On a group, hides the whole branch (draw early-out).
function Ui.setVisible(id, visible)
    local node = Ui.find(id)
    if node == nil then return end
    node.visible = visible and true or false
end

--- Shallow-merge fields onto the node. Group x/y cascades to descendants.
function Ui.set(id, patch)
    local node = Ui.find(id)
    if node == nil or type(patch) ~= "table" then return end
    applyGroupXYCascade(node, patch.x, patch.y)
    for k, v in pairs(patch) do
        node[k] = v
    end
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
    local node = Ui.find(id)
    if node == nil or type(props) ~= "table" then return end
    opts = opts or {}
    removeTweensForId(id)

    local from = {}
    local to = {}
    for k, v in pairs(props) do
        if k == "x" or k == "y" or k == "w" or k == "h" or k == "rotation" then
            from[k] = node[k] or 0
            to[k] = v
        end
    end

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
                node[k] = value
            end
        end

        if newX ~= nil or newY ~= nil then
            applyGroupXYCascade(node, newX, newY)
            if newX ~= nil then node.x = newX end
            if newY ~= nil then node.y = newY end
            tw.lastX = node.x
            tw.lastY = node.y
        end

        if t >= 1 then
            -- Snap to exact targets (incl. group cascade for final x/y).
            applyGroupXYCascade(node, tw.to.x, tw.to.y)
            for k, target in pairs(tw.to) do
                node[k] = target
            end
            local cb = tw.onComplete
            table.remove(Ui._tweens, i)
            if cb then cb() end
        else
            i = i + 1
        end
    end
end

function Ui.draw()
    local scene = Ui.scene
    if not scene then return end
    local nodes = scene.nodes or {}
    for i = 1, #nodes do
        drawNode(nodes[i], Ui.state or "default")
    end
end

function Ui.screenSize()
    return W, H
end

return Ui
