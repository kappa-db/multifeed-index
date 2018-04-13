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
  batch: function (nodes, next) {  // each 'nodes' entry has an 'id' field that is "hypercorekey@seq"
    console.log('indexing', nodes)
    kv.batch(nodes, next)
  }
})

function append (w, data, cb) {
  w.append(data, function (err) {
    if (err) return cb(err)
    var id = w.key.toString('hex') + '@' + (w.length - 1)
    cb(null, id)
  })
}

multi.writer(function (err, w) {
  append(w, {
    key: 'foo',
    value: 'bax',
    links: []
  }, function (err, id1) {
    console.log('id-1', id1)
    append(w, {
      key: 'foo',
      value: 'bax',
      links: [id1]
    }, function (err, id2) {
      console.log('id-2', id2)
      hyperkv.ready(function () {
        kv.get('foo', function (err, res) {
          if (err) throw err
          console.log(res)
        })
      })
    })
  })
})

