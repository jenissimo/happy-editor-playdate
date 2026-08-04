-- HappyEditor UI runtime: per-node raster cache.

UiCache = UiCache or {}
local Cache = UiCache
Cache.RUNTIME_VERSION = "3"
Cache.__index = Cache

-- These properties only affect where/if an already-rasterized node is
-- composited. Keeping them out of raster invalidation is the critical fast
-- path for editor-authored motion and state changes.
local COMPOSITE_ONLY <const> = {
    x = true,
    y = true,
    rotation = true,
    visible = true,
    states = true,
    locked = true,
    name = true,
}

function Cache.new(gfx, width, height, ledger, bake_catalog, asset_catalog)
    local self = setmetatable({}, Cache)
    self.gfx = gfx
    self.width = width
    self.height = height
    self.entries = {}
    self.versions = {}
    self.ledger = ledger
    self.bake_catalog = bake_catalog
    self.asset_catalog = asset_catalog
    self.sealed = false
    self.islands = nil
    self.island_by_node = {}
    self.active_islands = 0
    self.rebuilds = 0
    self.scratch_by_node = {}
    -- Count of members currently pending promotion, across all islands.
    -- Lets applyPromotions early-out on the (overwhelmingly common) frame
    -- where nothing changed, instead of rescanning every island/member.
    self.pending_count = 0
    return self
end

function Cache.reset(self)
    self.entries = {}
    self.versions = {}
    self.sealed = false
    self.islands = nil
    self.island_by_node = {}
    self.active_islands = 0
    self.rebuilds = 0
    self.scratch_by_node = {}
    self.pending_count = 0
end

local function rasterSize(value)
    value = tonumber(value) or 1
    if value < 1 then return 1 end
    return math.ceil(value)
end

-- An `image` node draws its asset through img:draw(x, y), which blits at the
-- asset's INTRINSIC size and ignores the node's declared w/h -- an asset
-- larger than its box has always painted past it (harmless when a node drew
-- straight to the screen; the editor preview shows the same overflow). Every
-- raster this cache owns for that node -- the singleton island bitmap, a
-- promoted member's own pool slot, and the legacy per-node entry -- must be
-- sized to cover that overflow too, or the cache clips what an uncached node
-- would have shown. A frame `image` node backed by a sequential imagetable
-- draws one CELL, not the sheet, so that's the size that matters for it;
-- anything else (a still image) draws at its full width/height.
local function assetIntrinsicSize(catalog, node)
    if node.type ~= "image" or node.asset == nil or node.asset == "" then return nil end
    local entries = catalog and catalog.entries
    local entry = entries and entries[node.asset]
    if entry == nil then return nil end
    if entry.kind == "table" then
        local cell = entry.cell
        if cell then return cell.w, cell.h end
        return nil
    end
    if entry.kind == "image" then return entry.width, entry.height end
    return nil
end

-- max(declared, asset intrinsic) in each dimension, rounded up the same way
-- as every other raster dimension in this file. Declared position (topLeft,
-- anchor math) is computed from node.w/node.h elsewhere and never touched
-- here -- growth only ever extends the buffer rightward/downward from the
-- node's own local origin, matching where img:draw always starts, so it
-- never needs to shift the artwork.
function Cache:effectiveSize(node)
    local w, h = rasterSize(node.w), rasterSize(node.h)
    local aw, ah = assetIntrinsicSize(self.asset_catalog, node)
    if aw then aw = rasterSize(aw); if aw > w then w = aw end end
    if ah then ah = rasterSize(ah); if ah > h then h = ah end end
    return w, h
end

function Cache:preallocateScratch(node)
    if node.type ~= "text" then return true end
    local scale = math.floor(node.scale or 1)
    if scale <= 1 then return true end
    local width = math.max(1, math.floor((node.w or 1) / scale))
    local height = math.max(1, math.floor((node.h or 1) / scale))
    local bytes = math.ceil(width / 32) * 4 * height * 2 + 64
    if self.ledger and not self.ledger:reserve(bytes, 1) then return false end
    local image = self.gfx.image.new(width, height, self.gfx.kColorClear)
    if not image then if self.ledger then self.ledger:release(bytes, 1) end return false end
    self.scratch_by_node[node] = { image = image, width = width, height = height }
    return true
end

function Cache:scratch(node)
    local scratch = self.scratch_by_node[node]
    return scratch and scratch.image or nil
end

-- A build-time bake (editor/scripts/bake-islands.ts) may have rasterized this
-- exact island through the real SDK renderer already; the catalog is keyed
-- by the compiled plan's sceneRevision, a hash over the scene, the plan AND
-- every allowlisted asset's fingerprint (see compiler.ts), so any content
-- change -- including an edit that doesn't touch this particular island --
-- naturally mints a new key and the old bake simply stops matching. No
-- separate staleness check is needed: a miss here IS the staleness check.
function Cache:bakedImagePath(scene_revision, island_id)
    local catalog = self.bake_catalog
    if not catalog or type(catalog.scenes) ~= "table" or scene_revision == nil then return nil end
    local scene = catalog.scenes[scene_revision]
    if type(scene) ~= "table" then return nil end
    local path = scene[island_id]
    if type(path) ~= "string" or path == "" then return nil end
    return path
end

-- Compiled islands are preallocated at Ui.load. Each record owns fixed
-- capacity and ordered members; no draw/update code is allowed to grow it.
function Cache:preallocateIslands(plan, index)
    local islands, by_node = {}, {}
    for i = 1, #(plan.islands or {}) do
        local spec = plan.islands[i]
        if type(spec) ~= "table" or type(spec.members) ~= "table" or spec.w == nil or spec.h == nil then return false end
        local width, height = rasterSize(spec.w), rasterSize(spec.h)
        -- A singleton island's own bitmap IS what its one member rasterizes
        -- into (see rasterCompiledSingleton in ui.lua) -- grow it here,
        -- independently of the compiled plan's declared spec.w/h, so an
        -- image node whose asset is larger than its declared box is never
        -- clipped by this buffer even if the plan were stale or wrong.
        if #spec.members == 1 then
            local only = index[spec.members[1]]
            if only then
                local ew, eh = self:effectiveSize(only)
                if ew > width then width = ew end
                if eh > height then height = eh end
            end
        end
        local bytes = math.ceil(width / 32) * 4 * height * 2 + 64
        if self.ledger and not self.ledger:reserve(bytes, 1) then return false end
        -- Reservation math is identical whether this island loads a baked
        -- raster or an empty one: the compiler's declared maxUiBytes/
        -- maxUiBitmaps assumes a raw bitmap of this size either way, so
        -- charging anything else would desync the ledger from the plan's
        -- declared budget. Only the constructor call and the initial dirty
        -- flag differ.
        local baked_path = self:bakedImagePath(plan.sceneRevision, spec.id)
        local image = baked_path and self.gfx.image.new(baked_path) or nil
        local baked_clean = image ~= nil
        if not image then image = self.gfx.image.new(width, height, self.gfx.kColorClear) end
        if not image then if self.ledger then self.ledger:release(bytes, 1) end return false end
        -- A singleton island (#spec.members == 1) can never promote --
        -- applyPromotions only promotes when #island.members > 1 -- so its
        -- member would never draw into pool[node]; it always rasterizes
        -- straight into the shared island.image (see drawIsland's
        -- rasterCompiledSingleton path in ui.lua). Skip reserving/allocating
        -- that dead promotion-pool bitmap: rules-ui alone has 65 singleton
        -- islands out of 69, each previously charging a wasted gfx.image.new.
        local members, pool, pending = {}, {}, {}
        for j = 1, #spec.members do
            local node = index[spec.members[j]]
            if not node then return false end
            if not self:preallocateScratch(node) then return false end
            members[#members + 1] = node; pending[node] = false
            if #spec.members > 1 then
                local nw, nh = self:effectiveSize(node)
                local nbytes = math.ceil(nw / 32) * 4 * nh * 2 + 64
                if self.ledger and not self.ledger:reserve(nbytes, 1) then return false end
                local nimage = self.gfx.image.new(nw, nh, self.gfx.kColorClear)
                if not nimage then if self.ledger then self.ledger:release(nbytes, 1) end return false end
                pool[node] = { image = nimage, width = nw, height = nh, dirty = true }
            end
        end
        -- A baked island starts clean (not dirty): its pixels are already the
        -- real composited raster, so the first drawIsland composites them
        -- as-is instead of rasterizing. invalidateNode's existing dirty/
        -- pending logic then treats a later member mutation -- even one that
        -- lands before this scene's first Ui.draw() -- exactly like a
        -- mutation on an already-rasterized island, which is correct here:
        -- unlike a fresh empty raster, the baked pixels already reflect the
        -- pre-mutation content, so that mutation must promote rather than be
        -- absorbed by a raster that hasn't happened yet.
        local record = { id = spec.id, x = spec.x or 0, y = spec.y or 0, width = width, height = height,
            image = image, members = members, pool = pool, pending = pending, promoted = false, version = -1, dirty = not baked_clean }
        for j = 1, #members do by_node[members[j]] = record end
        islands[#islands + 1] = record
    end
    self.entries = {}
    self.islands, self.island_by_node, self.active_islands = islands, by_node, #islands
    self.sealed = true
    return true
end

function Cache:canFit(node, w, h, scale)
    local island = self.island_by_node[node]
    if island then
        if #island.members > 1 then
            local slot = island.pool[node]
            if not (slot and rasterSize(w or node.w) <= slot.width and rasterSize(h or node.h) <= slot.height) then return false end
        else
            -- No promotion slot exists for a singleton: its own island.image
            -- IS the raster it draws into, sized to max(node.w/h, its
            -- asset's intrinsic size) by preallocateIslands's effectiveSize
            -- call -- so that (possibly grown) capacity is what a runtime
            -- resize must fit within.
            if not (rasterSize(w or node.w) <= island.width and rasterSize(h or node.h) <= island.height) then return false end
        end
    end
    if node.type ~= "text" then return true end
    local wanted_scale = math.floor(tonumber(scale or node.scale) or 1)
    if wanted_scale <= 1 then return true end
    local scratch = self.scratch_by_node[node]
    local wanted_width = math.max(1, math.floor((w or node.w or 1) / wanted_scale))
    local wanted_height = math.max(1, math.floor((h or node.h or 1) / wanted_scale))
    return scratch ~= nil and wanted_width <= scratch.width and wanted_height <= scratch.height
end

function Cache:applyPromotions()
    -- rules-ui has 69 islands, leaderboard 82 members; rescanning all of them
    -- every frame when nothing is pending is pure waste. pending_count is
    -- exact (see invalidateNode), so zero means skip straight through.
    if self.pending_count == 0 then return end
    for i = 1, #(self.islands or {}) do
        local island = self.islands[i]
        if not island.promoted and #island.members > 1 then
            local queued = false
            for j = 1, #island.members do if island.pending[island.members[j]] then queued = true break end end
            if queued then
                island.promoted = true
                for j = 1, #island.members do
                    local member = island.members[j]
                    if island.pending[member] then self.pending_count = self.pending_count - 1 end
                    island.pool[member].dirty = true
                    island.pending[member] = false
                end
                self.rebuilds = self.rebuilds + 1
            end
        end
    end
end

-- Reserve fixed raster storage while loading. Once sealed, drawNode must never
-- allocate; an unforeseen node/resize uses the vector renderer instead.
function Cache:preallocate(index)
    for _, node in pairs(index) do
        if node.type ~= "group" then
            if not self:preallocateScratch(node) then goto continue end
            local width, height = self:effectiveSize(node)
            local bytes = math.ceil(width / 32) * 4 * height * 2 + 64
            if not self.ledger or self.ledger:reserve(bytes, 1) then
                local image = self.gfx.image.new(width, height, self.gfx.kColorClear)
                if image then
                    self.entries[node] = { image = image, width = width, height = height, version = -1 }
                elseif self.ledger then self.ledger:release(bytes, 1) end
            end
        end
        ::continue::
    end
    self.sealed = true
end

function Cache:version(node)
    return self.versions[node] or 0
end

function Cache:invalidateNode(node, property)
    if node == nil or node.type == "group" then return end
    if COMPOSITE_ONLY[property] then
        -- Ordered dithers are screen-space patterns. Moving one changes its
        -- raster phase; ordinary nodes can still take the composition-only
        -- fast path.
        local fill = node.fill
        local position_sensitive = (property == "x" or property == "y")
            and node.type == "shape"
            and (node.rotation or 0) == 0
            and fill ~= nil
            and (fill.kind == "dither" or fill.kind == "gradient")
        local compiled_island = self.island_by_node[node]
        if not position_sensitive and not (compiled_island and not compiled_island.promoted and #compiled_island.members > 1) then return end
    end
    local island = self.island_by_node[node]
    if island then
        if not island.promoted and #island.members > 1 then
            -- A dirty island hasn't been rasterized since it was (re)built --
            -- which includes its initial pre-load state before the very
            -- first draw. That upcoming rasterization will already capture
            -- this mutation, so marking the member pending here would only
            -- promote the island for a change it was never going to miss.
            -- Promotion is for a mutation that arrives strictly AFTER the
            -- island has gone through drawIsland and is clean -- exactly
            -- what leaves this member's edit stranded otherwise.
            if not island.dirty and not island.pending[node] then
                island.pending[node] = true
                self.pending_count = self.pending_count + 1
            end
        elseif island.promoted then
            -- island.promoted is only ever set by applyPromotions, gated on
            -- #island.members > 1, so a promoted island always has a pool
            -- entry for every member -- singletons never reach this branch.
            local slot = island.pool[node]
            if not COMPOSITE_ONLY[property] then slot.dirty = true
            elseif property == "x" or property == "y" then
                local fill = node.fill
                if node.type == "shape" and fill and (fill.kind == "dither" or fill.kind == "gradient") then slot.dirty = true end
            end
        else island.dirty = true end
    else self.versions[node] = (self.versions[node] or 0) + 1 end
end

-- Group/state gates affect flattened compiled descendants without changing
-- their raster geometry. Rebuild coalesced islands in place; never promote.
function Cache:invalidateUnpromotedGates()
    for i = 1, #(self.islands or {}) do
        local island = self.islands[i]
        if not island.promoted and #island.members > 1 then island.dirty = true end
    end
end

function Cache:drawPromoted(island, node, draw_member)
    local slot = island.pool[node]
    if slot.dirty then
        self.gfx.pushContext(slot.image)
        if self.gfx.setDrawOffset then self.gfx.setDrawOffset(0, 0) end
        if self.gfx.clearClipRect then self.gfx.clearClipRect() end
        if self.gfx.clearStencilImage then self.gfx.clearStencilImage() end
        if self.gfx.setImageDrawMode and self.gfx.kDrawModeCopy then self.gfx.setImageDrawMode(self.gfx.kDrawModeCopy) end
        self.gfx.clear(self.gfx.kColorClear)
        draw_member(node)
        self.gfx.popContext()
        slot.dirty = false; self.rebuilds = self.rebuilds + 1
    end
    return slot.image
end

function Cache:drawIsland(island, draw_member)
    if island.dirty then
        self.gfx.pushContext(island.image)
        if self.gfx.setDrawOffset then self.gfx.setDrawOffset(0, 0) end
        if self.gfx.clearClipRect then self.gfx.clearClipRect() end
        if self.gfx.clearStencilImage then self.gfx.clearStencilImage() end
        if self.gfx.setImageDrawMode and self.gfx.kDrawModeCopy then self.gfx.setImageDrawMode(self.gfx.kDrawModeCopy) end
        self.gfx.clear(self.gfx.kColorClear)
        for i = 1, #island.members do draw_member(island.members[i], island.x, island.y) end
        self.gfx.popContext()
        island.dirty = false; self.rebuilds = self.rebuilds + 1
    end
    return island.image
end

function Cache:islandStats()
    local promoted = 0
    for i = 1, #(self.islands or {}) do if self.islands[i].promoted then promoted = promoted + 1 end end
    return self.active_islands, self.rebuilds, promoted
end

function Cache.recordMutation(self, node, property)
    self:invalidateNode(node, property)
end

function Cache:drawNode(node, draw_node, origin_x, origin_y)
    if node == nil then return nil end
    local width, height = self:effectiveSize(node)
    local version = self:version(node)
    local entry = self.entries[node]
    if entry == nil then
        entry = {}
        self.entries[node] = entry
    end

    local resized = entry.image == nil or entry.width ~= width or entry.height ~= height
    if resized then
        if self.sealed then return nil end
        local bytes = math.ceil(width / 32) * 4 * height * 2 + 64
        if self.ledger and not self.ledger:reserve(bytes, 1) then return nil end
        entry.image = self.gfx.image.new(width, height, self.gfx.kColorClear)
        if entry.image == nil then
            if self.ledger then self.ledger:release(bytes, 1) end
            return nil
        end
        entry.width = width
        entry.height = height
    end

    if resized or entry.version ~= version then
        -- Raster content in node-local coordinates. pushContext restores the
        -- caller's camera, clip, stencil and draw mode for composition.
        self.gfx.pushContext(entry.image)
        if self.gfx.setDrawOffset then self.gfx.setDrawOffset(0, 0) end
        if self.gfx.clearClipRect then self.gfx.clearClipRect() end
        if self.gfx.clearStencilImage then self.gfx.clearStencilImage() end
        if self.gfx.setImageDrawMode and self.gfx.kDrawModeCopy then
            self.gfx.setImageDrawMode(self.gfx.kDrawModeCopy)
        end
        self.gfx.clear(self.gfx.kColorClear)
        draw_node(node, 0, 0, origin_x or 0, origin_y or 0)
        self.gfx.popContext()
        entry.version = version
    end

    return entry.image
end

return Cache
