module.exports = {
  serialize: serializeState,
  deserialize: deserializeState
}

function int32buf (n) {
  var buf = Buffer.alloc(4)
  buf.writeUInt32LE(n, 0)
  return buf
}

function serializeState (at) {
  var len = int32buf(at.length)
  var bufs = [len]
  for (var i=0; i < at.length; i++) {
    bufs.push(at[i].key)
    bufs.push(int32buf(at[i].min))
    bufs.push(int32buf(at[i].max))
  }
  return Buffer.concat(bufs)
}

function deserializeState (buf) {
  var at = []
  var len = buf.readUInt32LE(0)
  for (var i=0; i < len; i++) {
    var pos = 4 + i * 40
    var key = buf.slice(pos, pos + 32)
    var min = buf.readUInt32LE(pos + 32)
    var max = buf.readUInt32LE(pos + 36)
    at.push({
      key: key,
      min: min,
      max: max
    })
  }
  return at
}
