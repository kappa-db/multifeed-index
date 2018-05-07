var test = require('tape')
var hypercore = require('hypercore')
var multifeed = require('multifeed')
var ram = require('random-access-memory')
var index = require('..')

test('multiple feeds', function (t) {
  createTwo(function (a, b) {
    var sums = [0, 0]
    var version1 = null
    var version2 = null

    var pending = 5
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

    function sync () {
      if (--pending) return
      replicate(a, b, function () {
        doIndex()
      })
    }

    function doIndex () {
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

      idx1.ready(function () {
        idx2.ready(function () {
          t.equals(sums[0], 44, 'db A sum matches')
          t.equals(sums[1], 44, 'db B sum matches')
          t.end()
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
