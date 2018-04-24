var hypercore = require('hypercore')
var multicore = require('multi-hypercore')
var indexer = require('.')
var umkv = require('unordered-materialized-kv')
var ram = require('random-access-memory')
var memdb = require('memdb')

var multi = multicore(hypercore, ram, { valueEncoding: 'json' })

var kv = umkv(memdb())

var hyperkv = indexer({
  cores: multi,
  map: function (node, feed, seq, next) {
    var entry = {
      id: feed.key.toString('hex') + '@' + seq,
      key: node.key,
      links: node.links
    }
    kv.batch([entry], next)
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
      hyperkv.ready(function () {
        kv.get('foo', function (_, res) {
          console.log(res)
        })
      })
    })
  })
})
