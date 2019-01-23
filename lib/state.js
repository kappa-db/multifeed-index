module.exports = {
  serialize: serializeState,
  deserialize: deserializeState
}

/*
 * KeyState: { key: Buffer<32>, min: Number, max: Number }
 * ViewState: { keys: {HexString<32>}, version: Number }
 */

// Number -> Buffer<4>
function int32buf (n) {
  var buf = Buffer.alloc(4)
  buf.writeUInt32LE(n, 0)
  return buf
}

// KeyState, Number -> Buffer
function serializeState (at, version) {
  at = values(at)
  var len = int32buf(at.length)
  var bufs = [len]
  for (var i = 0; i < at.length; i++) {
    bufs.push(at[i].key)
    bufs.push(int32buf(at[i].min))
    bufs.push(int32buf(at[i].max))
  }

  if (version && typeof version === 'number') bufs.push(int32buf(version))

  return Buffer.concat(bufs)
}

// Buffer -> ViewState
function deserializeState (buf) {
  var state = { keys: {} }
  var len = buf.readUInt32LE(0)
  for (var i = 0; i < len; i++) {
    var pos = 4 + i * 40
    var key = buf.slice(pos, pos + 32)
    var min = buf.readUInt32LE(pos + 32)
    var max = buf.readUInt32LE(pos + 36)
    state.keys[key.toString('hex')] = {
      key: key,
      min: min,
      max: max
    }
  }

  // Read 'version', if there are any unread bytes left.
  if (4 + len * 40 + 4 <= buf.length) {
    var version = buf.readUInt32LE(4 + len * 40)
    state.version = version
  } else {
    state.version = 1
  }

  return state
}

// {String:A} -> [A]
function values (dict) {
  return Object.keys(dict).map(k => dict[k])
}
