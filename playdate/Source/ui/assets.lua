-- HappyEditor UI runtime: Playdate asset loading and caches.

UiAssets = UiAssets or {}
local Assets = UiAssets
Assets.RUNTIME_VERSION = "3"
Assets.__index = Assets

function Assets.new(gfx, default_font, catalog, ledger)
    local self = setmetatable({}, Assets)
    self.gfx = gfx
    self.default_font = default_font
    self.fonts = {}
    self.images = {}
    self.tables = {}
    self.slices = {}
    -- Side tables the resident-set bookkeeping needs but that aren't visible
    -- from the caches above: font_backing maps a fonts[] request key to the
    -- catalog path actually charged for it (see Assets:font -- the
    -- default-font fallback caches the SAME object under two keys but only
    -- ever reserves one catalog entry), and slice_paths maps a slices[]
    -- compound key (path..":"..insets) back to the underlying catalog path,
    -- since allowlist/eviction decisions are made per path, not per compound
    -- key. The *_stamp tables record when each resident entry was last
    -- served from cache -- a monotonically increasing counter, never a wall
    -- clock (see Assets:touch) -- so Assets:reserve can evict the least
    -- recently used entry first when it needs to make room.
    self.font_backing = {}
    self.slice_paths = {}
    self.font_stamp = {}
    self.image_stamp = {}
    self.table_stamp = {}
    self.slice_stamp = {}
    self.clock = 0
    self.catalog = catalog and catalog.entries or {}
    self.ledger = ledger
    self.strict = false
    self.allowed = nil
    self.failures = 0
    self.failed_paths = {}
    return self
end

function Assets:setStrict(strict)
    self.strict = strict and true or false
end

function Assets:setAllowlist(allowlist)
    if allowlist == nil then self.allowed = nil return end
    local allowed = {}
    for i = 1, #allowlist do allowed[allowlist[i]] = true end
    self.allowed = allowed
end

-- Catalog lookup used only by the eviction path in Assets:reserve(): a plain
-- trusted/kind check with none of Assets:entry's strict-allowlist gating.
-- Eviction eligibility is already decided per candidate against self.allowed
-- before this is ever consulted for its bytes/bitmaps cost, so re-applying
-- the allowlist gate here would be the wrong check.
local function trustedEntry(catalog, path, kind)
    local e = catalog[path]
    if e == nil or e.trusted ~= true then return nil end
    if kind and e.kind ~= kind then return nil end
    return e
end

-- Bumps the monotonic use counter and stamps `key` in `stampTable` with it.
-- Called on every cache hit AND on every fresh construction, so a
-- just-loaded entry is not immediately the oldest thing resident.
function Assets:touch(stampTable, key)
    self.clock = self.clock + 1
    stampTable[key] = self.clock
end

-- Scans every resident cache for entries the CURRENT allowlist (self.allowed)
-- does not list -- the only things Assets:reserve is ever allowed to evict --
-- and returns them as a flat list of { kind, bytes, bitmaps, stamp, ... }
-- candidates ready for Assets:evict.
--
-- Fonts are grouped by BACKING, not by request key: Assets:font's
-- default-font fallback caches one shared object under two keys but charges
-- only its backing entry once (see Assets:font), so evicting has to drop
-- both keys together and must not touch a shared backing that any one of
-- its keys is still allowlisted under -- dropping the object would silently
-- break the still-needed key too.
function Assets:evictionCandidates()
    local list = {}
    local allowed = self.allowed or {}

    local backings = {}
    for path, value in pairs(self.fonts) do
        if value then
            local backing = self.font_backing[path] or path
            local group = backings[backing]
            if not group then
                group = { keys = {}, protected = false, stamp = -1 }
                backings[backing] = group
            end
            group.keys[#group.keys + 1] = path
            if allowed[path] then group.protected = true end
            local stamp = self.font_stamp[path] or -1
            if stamp > group.stamp then group.stamp = stamp end
        end
    end
    for backing, group in pairs(backings) do
        if not group.protected then
            local catEntry = trustedEntry(self.catalog, backing, "font")
            if catEntry then
                list[#list + 1] = { kind = "font", keys = group.keys, stamp = group.stamp,
                    bytes = catEntry.bytes, bitmaps = catEntry.bitmaps }
            end
        end
    end

    for path, value in pairs(self.images) do
        if value and not allowed[path] then
            local catEntry = trustedEntry(self.catalog, path, "image")
            if catEntry then
                list[#list + 1] = { kind = "image", path = path, stamp = self.image_stamp[path] or -1,
                    bytes = catEntry.bytes, bitmaps = catEntry.bitmaps }
            end
        end
    end

    for path, value in pairs(self.tables) do
        if value and not allowed[path] then
            local catEntry = trustedEntry(self.catalog, path, "table")
            if catEntry then
                list[#list + 1] = { kind = "table", path = path, stamp = self.table_stamp[path] or -1,
                    bytes = catEntry.bytes, bitmaps = catEntry.bitmaps }
            end
        end
    end

    for key, value in pairs(self.slices) do
        local path = self.slice_paths[key]
        if value and path and not allowed[path] then
            local catEntry = trustedEntry(self.catalog, path, "slice")
            if catEntry then
                list[#list + 1] = { kind = "slice", key = key, stamp = self.slice_stamp[key] or -1,
                    bytes = catEntry.bytes, bitmaps = catEntry.bitmaps }
            end
        end
    end

    return list
end

-- Least-recently-used pick among Assets:evictionCandidates -- nil once
-- nothing evictable remains (everything resident is either protected by the
-- current allowlist or already gone).
function Assets:pickEvictionVictim()
    local list = self:evictionCandidates()
    local best = nil
    for i = 1, #list do
        local candidate = list[i]
        if best == nil or candidate.stamp < best.stamp then best = candidate end
    end
    return best
end

-- Drops a victim from Assets:pickEvictionVictim out of its cache table(s)
-- and releases its ledger credit. A font victim carries every request key
-- sharing its backing object -- all of them go together, since they are the
-- very same live SDK object under one reservation.
function Assets:evict(victim)
    if victim.kind == "font" then
        for i = 1, #victim.keys do
            local key = victim.keys[i]
            self.fonts[key] = nil
            self.font_backing[key] = nil
            self.font_stamp[key] = nil
        end
    elseif victim.kind == "image" then
        self.images[victim.path] = nil
        self.image_stamp[victim.path] = nil
    elseif victim.kind == "table" then
        self.tables[victim.path] = nil
        self.table_stamp[victim.path] = nil
    elseif victim.kind == "slice" then
        self.slices[victim.key] = nil
        self.slice_paths[victim.key] = nil
        self.slice_stamp[victim.key] = nil
    end
    if self.ledger then self.ledger:release(victim.bytes, victim.bitmaps) end
    if victim.bytes and victim.bytes > 0 then collectgarbage("step", math.ceil(victim.bytes / 1024)) end
end

function Assets:reset()
    local ledger = self.ledger
    local allowed = self.allowed

    if allowed == nil then
        -- Legacy (non-compiled) path: no allowlist means no way to know what
        -- the incoming scene needs, so keep the original behaviour of
        -- dropping everything.
        self.fonts, self.font_backing, self.font_stamp = {}, {}, {}
        self.images, self.image_stamp = {}, {}
        self.tables, self.table_stamp = {}, {}
        self.slices, self.slice_paths, self.slice_stamp = {}, {}, {}
        self.failures = 0
        self.failed_paths = {}
        local freed_bytes = ledger and ledger:stats() or 0
        if ledger then ledger:reset() end
        if freed_bytes > 0 then collectgarbage("step", math.ceil(freed_bytes / 1024)) end
        return
    end

    -- Compiled path: the asset cache is a bounded RESIDENT SET now, not a
    -- per-scene one -- retain EVERY successfully-loaded entry, not just the
    -- ones the incoming scene lists. The two PixelOperatorSC fonts every
    -- layout asks for, or a hero image shared by menu/gameover, now survive
    -- an arbitrary number of scene hops, not just one. The only thing ever
    -- dropped here is a `false` failure marker -- which never held credit to
    -- begin with, since a failed reservation is rolled back before it's
    -- recorded (see Assets:font/:image/:imagetable/:slice) -- so a fresh
    -- scene gets a fresh attempt at a path the outgoing scene failed to
    -- load, not someone else's stale failure.
    --
    -- This still zeroes and rebuilds the ledger, even though nothing of
    -- Assets' own is being dropped: Cache shares this same ledger (see
    -- ui.lua) and Cache.reset(), called by Ui.load right before this, clears
    -- its own bookkeeping without ever releasing the credit it reserved --
    -- it has always relied on THIS reset zeroing the whole ledger to recover
    -- that credit. Re-reserving only the resident set below (never the
    -- outgoing scene's now-orphaned cache credit) is what actually frees it.
    -- The rebuild re-reserves the exact set that already held this credit a
    -- moment ago against these same limits, so it is never expected to fail
    -- -- see Assets:reserve's comment on why this loop must not evict.
    --
    -- Whatever the incoming scene newly needs beyond what's resident here is
    -- made to fit by Assets:reserveEvicting, which evicts least-recently-used
    -- entries the CURRENT allowlist (self.allowed, already set by Ui.load's
    -- setAllowlist call before this) does not list -- see Assets:preload,
    -- called right after Cache.preallocateIslands by Ui.load.
    for path, value in pairs(self.fonts) do
        if value == false then
            self.fonts[path] = nil
            self.font_backing[path] = nil
            self.font_stamp[path] = nil
        end
    end
    for path, value in pairs(self.images) do
        if value == false then
            self.images[path] = nil
            self.image_stamp[path] = nil
        end
    end
    for path, value in pairs(self.tables) do
        if value == false then
            self.tables[path] = nil
            self.table_stamp[path] = nil
        end
    end
    for key, value in pairs(self.slices) do
        if value == false then
            self.slices[key] = nil
            self.slice_paths[key] = nil
            self.slice_stamp[key] = nil
        end
    end

    local bytes_before = ledger and ledger:stats() or 0
    self.failures = 0
    self.failed_paths = {}
    if ledger then ledger:reset() end

    -- Re-reserve the resident set against the freshly-zeroed ledger. A font
    -- can be cached under two keys pointing at the SAME object (the
    -- default-font fallback in Assets:font caches both the failed explicit
    -- path and self.default_font against one constructed font) -- charge its
    -- backing catalog entry once per distinct backing, not once per key.
    local charged_font_backings = {}
    for path in pairs(self.fonts) do
        local backing = self.font_backing[path]
        if not charged_font_backings[backing] then
            local catEntry = trustedEntry(self.catalog, backing, "font")
            if catEntry and self:reserve(catEntry) then
                charged_font_backings[backing] = true
            else
                -- Should not happen (see the comment above) -- if it somehow
                -- does, drop this key rather than keep an uncharged live
                -- object around.
                self.fonts[path] = nil
                self.font_backing[path] = nil
                self.font_stamp[path] = nil
            end
        end
    end
    for path in pairs(self.images) do
        local catEntry = trustedEntry(self.catalog, path, "image")
        if not (catEntry and self:reserve(catEntry)) then
            self.images[path] = nil
            self.image_stamp[path] = nil
        end
    end
    for path in pairs(self.tables) do
        local catEntry = trustedEntry(self.catalog, path, "table")
        if not (catEntry and self:reserve(catEntry)) then
            self.tables[path] = nil
            self.table_stamp[path] = nil
        end
    end
    for key, path in pairs(self.slice_paths) do
        if self.slices[key] then
            local catEntry = trustedEntry(self.catalog, path, "slice")
            if not (catEntry and self:reserve(catEntry)) then
                self.slices[key] = nil
                self.slice_paths[key] = nil
                self.slice_stamp[key] = nil
            end
        end
    end

    -- freed_bytes here is overwhelmingly the outgoing scene's orphaned cache
    -- credit (see above), not dropped assets -- the resident set survives
    -- this rebuild essentially intact.
    local bytes_after = ledger and ledger:stats() or 0
    local freed_bytes = bytes_before - bytes_after
    if freed_bytes > 0 then collectgarbage("step", math.ceil(freed_bytes / 1024)) end
end

function Assets:failureCount()
    return self.failures
end

function Assets:failed(path)
    if path and self.failed_paths[path] then return end
    if path then self.failed_paths[path] = true end
    self.failures = self.failures + 1
end

function Assets:entry(path, kind)
    if self.strict and (self.allowed == nil or not self.allowed[path]) then return nil end
    local entry = self.catalog[path]
    if entry == nil or entry.trusted ~= true then return nil end
    if kind and entry.kind ~= kind then return nil end
    return entry
end

-- Load every trusted entry once before the first steady-state draw. Failure is
-- sticky in the per-path cache and never causes a later hot-path retry.
function Assets:preload(allowlist)
    for i = 1, #allowlist do
        local path = allowlist[i]
        local entry = self.catalog[path]
        if entry and entry.trusted then
            if entry.kind == "font" then self:font(path)
            elseif entry.kind == "table" then self:imagetable(path)
            elseif entry.kind == "slice" then self:slice(path, entry.slice)
            else self:image(path) end
        end
    end
end

-- Plain ledger reservation, no eviction. Used by Assets:reset's rebuild loop
-- (see below), which only ever re-reserves a set that already held its
-- credit a moment ago against these same limits -- it should never need to
-- evict, and routing it through Assets:reserveEvicting anyway would mean an
-- eviction there could try to drop an entry this very loop has not yet
-- copied into the rebuilt cache tables, corrupting the rebuild mid-flight.
function Assets:reserve(entry)
    return entry ~= nil and (not self.ledger or self.ledger:reserve(entry.bytes, entry.bitmaps))
end

-- Assets:reserve, but on failure evicts least-recently-used resident entries
-- the current allowlist does not list (one at a time) until the reservation
-- fits or nothing evictable is left. Never touches anything the current
-- allowlist lists -- that is the working set the caller is loading FOR. If
-- eviction cannot free enough, this fails exactly as a plain reserve would:
-- no partial eviction is left uncompensated, since every eviction above
-- releases its own credit immediately. This is what Assets:font/:image/
-- :imagetable/:slice call for a fresh load -- never Assets:reset's rebuild.
function Assets:reserveEvicting(entry)
    if self:reserve(entry) then return true end
    if entry == nil or not self.ledger then return false end
    while true do
        local victim = self:pickEvictionVictim()
        if not victim then return false end
        self:evict(victim)
        if self.ledger:reserve(entry.bytes, entry.bitmaps) then return true end
    end
end
function Assets:rollback(entry)
    if entry and self.ledger then self.ledger:release(entry.bytes, entry.bitmaps) end
end

function Assets:font(path)
    path = (path == nil or path == "") and self.default_font or path
    local cached = self.fonts[path]
    if cached ~= nil then
        if cached then self:touch(self.font_stamp, path) end
        return cached or nil
    end

    local entry = self:entry(path, "font")
    if not self:reserveEvicting(entry) then self:failed(path); self.fonts[path] = false return nil end
    local font = self.gfx.font.new(path)
    if not font and path ~= self.default_font then
        print("[Ui] font load failed: " .. tostring(path)
            .. " — trying " .. self.default_font)
        local fallback = self:entry(self.default_font, "font")
        if fallback ~= entry and not self:reserveEvicting(fallback) then self:rollback(entry); self:failed(path); self.fonts[path] = false return nil end
        font = self.gfx.font.new(self.default_font)
        if font then
            if fallback ~= entry then self:rollback(entry) end
            self.fonts[self.default_font] = font
            self.fonts[path] = font
            -- Both keys share this one object and this one reservation
            -- (the failed explicit entry was rolled back above) -- record
            -- the default font as the backing path for both so eviction (or
            -- a later reset) charges/drops it exactly once, not twice.
            self.font_backing[self.default_font] = self.default_font
            self.font_backing[path] = self.default_font
            self:touch(self.font_stamp, self.default_font)
            self:touch(self.font_stamp, path)
            return font
        end
    end
    if not font then
        -- If an explicit font failed and the fallback constructor also failed,
        -- neither SDK object is live. Release both independent reservations.
        if path ~= self.default_font then
            local fallback = self:entry(self.default_font, "font")
            if fallback ~= entry then self:rollback(fallback) end
        end
        self:rollback(entry)
        print("[Ui] default font load failed: " .. self.default_font)
        self:failed(path)
        self.fonts[path] = false
        return nil
    end
    self.fonts[path] = font
    self.font_backing[path] = path
    self:touch(self.font_stamp, path)
    return font
end

function Assets:image(path)
    if path == nil or path == "" then return nil end
    local cached = self.images[path]
    if cached ~= nil then
        if cached then self:touch(self.image_stamp, path) end
        return cached or nil
    end
    local entry = self:entry(path, "image")
    if not self:reserveEvicting(entry) then self:failed(path); self.images[path] = false return nil end
    local image = self.gfx.image.new(path)
    if not image then self:rollback(entry); self:failed(path) end
    self.images[path] = image or false
    if image then self:touch(self.image_stamp, path) end
    return image
end

function Assets:imagetable(path)
    if path == nil or path == "" then return nil end
    local cached = self.tables[path]
    if cached ~= nil then
        if cached then self:touch(self.table_stamp, path) end
        return cached or nil
    end
    local entry = self:entry(path, "table")
    if not self:reserveEvicting(entry) then self:failed(path); self.tables[path] = false return nil end
    local table_image = self.gfx.imagetable.new(path)
    if not table_image then self:rollback(entry); self:failed(path) end
    self.tables[path] = table_image or false
    if table_image then self:touch(self.table_stamp, path) end
    return table_image
end

function Assets:frame(node, time)
    local table_image = self:imagetable(node.asset)
    if not table_image then return nil end
    local length = table_image:getLength()
    if not length or length <= 0 then return nil end

    local start = node.frameStart or 1
    if start < 1 then start = 1 end
    local stop = node.frameEnd or length
    if stop < start then stop = start end
    if stop > length then stop = length end
    local fps = node.fps or 0
    local frame
    if fps <= 0 then
        frame = node.frame or start
        if frame < start then frame = start end
        if frame > stop then frame = stop end
    else
        local count = stop - start + 1
        local ticks = math.floor((time or 0) * fps)
        if node.loop == false then
            frame = start + ticks
            if frame > stop then frame = stop end
        else
            frame = start + (ticks % count)
        end
    end
    return table_image:getImage(frame), frame
end

function Assets:drawable(node, time)
    local entry = self:entry(node.asset)
    if entry and entry.kind == "table" then
        local image, frame = self:frame(node, time)
        if image then return image, frame end
    end
    return self:image(node.asset), nil
end

function Assets:slice(path, slice)
    if path == nil or path == "" or slice == nil then return nil end
    local key = path .. ":" .. slice.left .. "," .. slice.right
        .. "," .. slice.top .. "," .. slice.bottom
    self.slice_paths[key] = path
    local cached = self.slices[key]
    if cached ~= nil then
        if cached then self:touch(self.slice_stamp, key) end
        return cached or nil
    end

    local entry = self:entry(path, "slice")
    if not self:reserveEvicting(entry) then self:failed(path); self.slices[key] = false return nil end
    local inner_width = math.max(1, entry.width - slice.left - slice.right)
    local inner_height = math.max(1, entry.height - slice.top - slice.bottom)
    local nine_slice = self.gfx.nineSlice.new(
        path, slice.left, slice.top, inner_width, inner_height
    )
    if not nine_slice then self:rollback(entry); self:failed(path) end
    self.slices[key] = nine_slice or false
    if nine_slice then self:touch(self.slice_stamp, key) end
    return nine_slice
end

return Assets
