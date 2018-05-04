var test = require('tape')
var hypercore = require('hypercore')
var multicore = require('multi-hypercore')
var ram = require('random-access-memory')
var index = require('..')

test('batch size', function (t) {
  t.plan(6)

  var db = multicore(hypercore, ram, { valueEncoding: 'json' })

  var pending = 3
  db.writer(function (err, w) {
    t.error(err)
    w.append({value: 17}, function (err) { t.error(err); write() })
    w.append({value: 12}, function (err) { t.error(err); write() })
    w.append({value: 1}, function (err) { t.error(err); write() })
  })

  function write () {
    if (--pending) return
    var version = null
    var sum = 0
    var idx = index({
      cores: db,
      maxBatch: 10,
      batch: function (nodes, feed, seqs, next) {
        t.equals(nodes.length, 3, 'correct batch size')
        nodes.forEach(function (node) { sum += node.value })
        next()
      },
      fetchState: function (cb) { cb(null, version) },
      storeState: function (s, cb) { version = s; cb(null) }
    })

    idx.ready(function () {
      t.equal(sum, 30)
    })
  }
})
