var test = require('tape')
var multifeed = require('multifeed')
var raf = require('random-access-file')
var rimraf = require('rimraf')
var tmp = require('tmp')
var index = require('..')

// 1. build index
// 2. bump version
// 3. ensure index is wiped
// 4. rebuild index
// 5. check correctness
test('version: reopening index @ same version -> no re-index', function (t) {
  var tmpdir = tmp.dirSync().name

  var files = []
  var storage = function (name) {
    var file = raf(tmpdir + '/' + name)
    files.push(file)
    return file
  }

  var version = null
  var sum = 0

  indexV1(function () {
    indexV2(function () {
      t.end()
    })
  })

  function wipeFiles (cb) {
    rimraf(tmpdir, cb)
  }

  function closeFiles (cb) {
    var pending = 1
    files.forEach(function (file) {
      file.close(function () {
        if (!--pending) cb()
      })
    })
    if (!--pending) cb()
  }

  function cleanup (cb) {
    closeFiles(function () {
      wipeFiles(cb)
    })
  }

  function writeData (db, cb) {
    var pending = 3
    db.writer(function (err, w) {
      t.error(err)
      w.append({value: 17}, function (err) { t.error(err); done() })
      w.append({value: 12}, function (err) { t.error(err); done() })
      w.append({value: 1}, function (err) { t.error(err); done() })
    })

    function done () {
      if (--pending) return
      cb()
    }
  }

  function indexV1 (cb) {
    var db = multifeed(storage, { valueEncoding: 'json' })

    writeData(db, function () {
      var idx = index({
        log: db,
        maxBatch: 10,
        batch: function (nodes, next) {
          t.equals(nodes.length, 3, 'correct batch size')
          nodes.forEach(function (node) { sum += node.value.value })
          next()
        },
        fetchState: function (cb) { cb(null, version) },
        storeState: function (s, cb) { version = s; cb(null) },
        clearIndex: function (cb) { version = null; sum = 0; cb(null) }
      })

      idx.ready(function () {
        t.equal(sum, 30)
        closeFiles(cb)
      })
    })
  }

  function indexV2 (cb) {
    var db = multifeed(storage, { valueEncoding: 'json' })

    var idx = index({
      log: db,
      maxBatch: 10,
      batch: function (nodes, next) {
        t.fail('batch should not be called')
        next()
      },
      fetchState: function (cb) { cb(null, version) },
      storeState: function (s, cb) { version = s; cb(null) },
      clearIndex: function (cb) { t.fail('clearIndex should not be called') }
    })

    idx.ready(function () {
      t.equal(sum, 30)
      cleanup(cb)
    })
  }
})

test('version: reopening index @ new version -> re-index -> reopen -> no re-index', function (t) {
  t.plan(11)

  var tmpdir = tmp.dirSync().name

  var files = []
  var storage = function (name) {
    var file = raf(tmpdir + '/' + name)
    files.push(file)
    return file
  }

  var version = null
  var sum = 0

  indexV1(function () {
    indexV2(function () {
      indexV3(function () {
        t.end()
      })
    })
  })

  function wipeFiles (cb) {
    rimraf(tmpdir, cb)
  }

  function closeFiles (cb) {
    var pending = 1
    files.forEach(function (file) {
      file.close(function () {
        if (!--pending) cb()
      })
    })
    if (!--pending) cb()
  }

  function cleanup (cb) {
    closeFiles(function () {
      wipeFiles(cb)
    })
  }

  function writeData (db, cb) {
    var pending = 3
    db.writer(function (err, w) {
      t.error(err)
      w.append({value: 17}, function (err) { t.error(err); done() })
      w.append({value: 12}, function (err) { t.error(err); done() })
      w.append({value: 1}, function (err) { t.error(err); done() })
    })

    function done () {
      if (--pending) return
      cb()
    }
  }

  function indexV1 (cb) {
    var db = multifeed(storage, { valueEncoding: 'json' })

    writeData(db, function () {
      var idx = index({
        log: db,
        maxBatch: 10,
        batch: function (nodes, next) {
          t.equals(nodes.length, 3, 'correct batch size')
          nodes.forEach(function (node) { sum += node.value.value })
          next()
        },
        fetchState: function (cb) { cb(null, version) },
        storeState: function (s, cb) { version = s; cb(null) },
        clearIndex: function (cb) { version = null; sum = 0; cb(null) }
      })

      idx.ready(function () {
        t.equal(sum, 30)
        closeFiles(cb)
      })
    })
  }

  function indexV2 (cb) {
    var db = multifeed(storage, { valueEncoding: 'json' })

    var batchCalls = 0
    var idx = index({
      log: db,
      version: 2,
      maxBatch: 10,
      batch: function (nodes, next) {
        batchCalls++
        t.equals(nodes.length, 3, 'correct batch size')
        nodes.forEach(function (node) { sum += node.value.value })
        next()
      },
      fetchState: function (cb) { cb(null, version) },
      storeState: function (s, cb) { version = s; cb(null) },
      clearIndex: function (cb) { version = null; sum = 0; cb(null) }
    })

    idx.ready(function () {
      t.equal(batchCalls, 1)
      t.equal(sum, 30)
      cb()
    })
  }

  function indexV3 (cb) {
    var db = multifeed(storage, { valueEncoding: 'json' })

    var idx = index({
      log: db,
      version: 2,
      maxBatch: 10,
      batch: function (nodes, next) {
        t.fail('batch should not be called')
        next()
      },
      fetchState: function (cb) { cb(null, version) },
      storeState: function (s, cb) { version = s; cb(null) },
      clearIndex: function (cb) { t.fail('clearIndex should not be called') }
    })

    idx.ready(function () {
      t.equal(sum, 30)
      cleanup(function () {
        t.ok('cleanup')
      })
    })
  }
})
