var test = require('tape')
var hypercore = require('hypercore')
var multifeed = require('multifeed')
var ram = require('random-access-memory')
var index = require('..')

test('batch size', function (t) {
  t.plan(6)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })

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

test('multiple feeds', function (t) {
  createTwo(function (a, b) {
    var sums = [0, 0]
    var version1 = null
    var version2 = null

    var pending = 7
    a.writer(function (err, w) {
      t.error(err)
      w.append({value: 17}, function (err) { t.error(err); sync() })
      w.append({value: 12}, function (err) { t.error(err); sync() })
      w.append({value: 1}, function (err) { t.error(err); sync() })
    })
    b.writer(function (err, w) {
      t.error(err)
      w.append({value: 11}, function (err) { t.error(err); sync() })
      w.append({value: 3}, function (err) { t.error(err); sync() })
    })

    function batchFn (sumId, nodes, feed, seqs, next) {
      nodes.forEach(function (node) {
        if (typeof node.value === 'number') sums[sumId] += node.value
      })
      next()
    }

    var idx1 = index({
      cores: a,
      maxBatch: 50,
      batch: batchFn.bind(null, 0),
      fetchState: function (cb) { cb(null, version1) },
      storeState: function (s, cb) { version1 = s; cb(null) }
    })

    var idx2 = index({
      cores: b,
      maxBatch: 50,
      batch: batchFn.bind(null, 1),
      fetchState: function (cb) { cb(null, version2) },
      storeState: function (s, cb) { version2 = s; cb(null) }
    })

    idx1.ready(sync)
    idx2.ready(sync)

    function sync () {
      if (--pending) return

      replicate(a, b, function () {
        idx1.ready(function () {
          idx2.ready(function () {
            t.equals(sums[0], 44, 'db A sum matches')
            t.equals(sums[1], 44, 'db B sum matches')
            t.end()
          })
        })
      })
    }
  })
})

function createTwo (cb) {
  var a = multifeed(hypercore, ram, {valueEncoding: 'json'})
  a.ready(function () {
    var b = multifeed(hypercore, ram, {valueEncoding: 'json'})
    b.ready(function () {
      cb(a, b)
    })
  })
}

function replicate (a, b, cb) {
  var stream = a.replicate()
  stream.pipe(b.replicate()).pipe(stream).on('end', cb)
}
