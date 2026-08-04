-- UI-owned allocation ledger.  It deliberately does not account for gameplay
-- graphics; its budget leaves headroom for the board and transitions.
UiMemory = UiMemory or {}
local Memory = UiMemory
Memory.RUNTIME_VERSION = "3"
Memory.DEFAULT_BYTES = 700 * 1024
Memory.DEFAULT_BITMAPS = 512
Memory.__index = Memory

function Memory.new(bytes, bitmaps)
    return setmetatable({ limit_bytes = bytes or Memory.DEFAULT_BYTES,
        limit_bitmaps = bitmaps or Memory.DEFAULT_BITMAPS, bytes = 0, bitmaps = 0 }, Memory)
end
function Memory:reserve(bytes, bitmaps)
    bytes, bitmaps = bytes or 0, bitmaps or 0
    if self.bytes + bytes > self.limit_bytes or self.bitmaps + bitmaps > self.limit_bitmaps then return false end
    self.bytes, self.bitmaps = self.bytes + bytes, self.bitmaps + bitmaps
    return true
end
function Memory:release(bytes, bitmaps)
    self.bytes = math.max(0, self.bytes - (bytes or 0)); self.bitmaps = math.max(0, self.bitmaps - (bitmaps or 0))
end
function Memory:reset()
    self.bytes, self.bitmaps = 0, 0
end
function Memory:stats()
    return self.bytes, self.bitmaps, self.limit_bytes, self.limit_bitmaps
end
return Memory
