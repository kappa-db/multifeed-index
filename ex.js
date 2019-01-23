var hypercore = require('hypercore')
var multifeed = require('multifeed')
var indexer = require('.')
var umkv = require('unordered-materialized-kv')
var ram = require('random-access-memory')
var memdb = require('memdb')

var multi = multifeed(hypercore, ram, { valueEncoding: 'json' })

var kv = umkv(memdb())

var kvView = indexer({
  version: 1, // setting a different number will cause the index to be purged and rebuilt
  log: multi,
  maxBatch: 5,
  batch: function (nodes, next) {
    var ops = nodes.map(function (node) {
      return {
        id: node.key.toString('hex') + '@' + node.seq,
        key: node.value.key,
        links: node.value.links
      }
    })
    kv.batch(ops, next)
  }
})

function append (w, data, cb) {
  w.append(data, function (err) {
    if (err) return cb(err)
    var id = w.key.toString('hex') + '@' + (w.length - 1)
    cb(null, id)
  })
}

multi.writer(function (_, w) {
  append(w, {
    key: 'foo',
    value: 'bax',
    links: []
  }, function (_, id1) {
    console.log('id-1', id1)
    append(w, {
      key: 'foo',
      value: 'bax',
      links: [id1]
    }, function (_, id2) {
      console.log('id-2', id2)
      kvView.ready(function () {
        kv.get('foo', function (_, res) {
          console.log(res)
        })
      })
    })
  })
})
