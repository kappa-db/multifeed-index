var test = require('tape')
var hypercore = require('hypercore')
var multifeed = require('multifeed')
var ram = require('random-access-memory')
var index = require('..')
var tmp = require('os').tmpdir
var rimraf = require('rimraf')
var path = require('path')
var versions = require('../lib/state')

test('empty + ready called', function (t) {
  t.plan(1)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })
  var version = null
  var idx = index({
    log: db,
    batch: function (nodes, next) {
      next()
    },
    fetchState: function (cb) { cb(null, version) },
    storeState: function (s, cb) { version = s; cb(null) }
  })

  idx.ready(function () {
    t.ok(true)
  })
})

test('adder', function (t) {
  t.plan(7)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var sum = 0
  var version = null

  var idx = index({
    log: db,
    batch: function (nodes, next) {
      nodes.forEach(function (node) { sum += node.value.value })
      next()

      if (!--pending) done()
    },
    fetchState: function (cb) { cb(null, version) },
    storeState: function (s, cb) { version = s; cb(null) }
  })

  var pending = 3
  db.writer(function (err, w) {
    t.error(err)
    w.append({value: 17}, function (err) { t.error(err) })
    w.append({value: 12}, function (err) { t.error(err) })
    w.append({value: 1}, function (err) { t.error(err) })
  })

  function done () {
    idx.ready(function () {
      var finalVersion = values(versions.deserialize(version).keys)
      t.equal(finalVersion.length, 1)
      t.equal(finalVersion[0].max, 3)
      t.equal(sum, 30)
    })
  }
})

test('adder: picks up where it left off', function (t) {
  t.plan(6)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var version = null
  var pending = 3

  var idx = index({
    log: db,
    batch: function (nodes, next) {
      next()
      if (!--pending) done()
    },
    fetchState: function (cb) { cb(null, version) },
    storeState: function (s, cb) { version = s; cb(null) }
  })

  var writer
  db.writer(function (err, w) {
    t.error(err, 'created a writer')
    writer = w
    w.append({value: 17}, function (err) { t.error(err, 'appended 17') })
    w.append({value: 12}, function (err) { t.error(err, 'appended 12') })
    w.append({value: 1}, function (err) { t.error(err, 'appended 1') })
  })

  function done () {
    idx.ready(function () {
      var pending = 1
      var sum = 0
      var version2 = version.slice()
      index({
        log: db,
        batch: function (nodes, next) {
          nodes.forEach(function (node) { sum += node.value.value })

          if (!--pending) {
            t.equals(sum, 7, 'processed only last item')
          }
          next()
        },
        fetchState: function (cb) { cb(null, version2) },
        storeState: function (s, cb) { version2 = s; cb(null) }
      })
      writer.append({value: 7}, function (err) { t.error(err, 'appended 7') })
    })
  }
})

test('adder /w slow versions', function (t) {
  t.plan(7)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var sum = 0
  var version = null

  var idx = index({
    log: db,
    batch: function (nodes, next) {
      nodes.forEach(function (node) { sum += node.value.value })
      next()
    },
    fetchState: function (cb) {
      setTimeout(function () { cb(null, version) }, 100)
    },
    storeState: function (s, cb) { version = s; setTimeout(cb, 100) }
  })

  var pending = 3
  db.writer(function (err, w) {
    t.error(err)
    w.append({value: 17}, done)
    w.append({value: 12}, done)
    w.append({value: 1}, done)
  })

  function done (err) {
    t.error(err)
    if (!--pending) {
      idx.ready(function () {
        var finalVersion = values(versions.deserialize(version).keys)
        t.equal(finalVersion.length, 1)
        t.equal(finalVersion[0].max, 3)
        t.equal(sum, 30)
      })
    }
  }
})

test('adder /w many concurrent PUTs', function (t) {
  t.plan(204)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var sum = 0
  var version = null

  var idx = index({
    log: db,
    batch: function (nodes, next) {
      nodes.forEach(function (node) { sum += node.value.value })
      next()

      if (!--pending) done()
    },
    fetchState: function (cb) { cb(null, version) },
    storeState: function (s, cb) { version = s; cb(null) }
  })

  var pending = 200
  var expectedSum = 0

  db.writer(function (err, w) {
    t.error(err)
    for (var i = 0; i < pending; i++) {
      var n = Math.floor(Math.random() * 10)
      expectedSum += n
      w.append({value: n}, function (err) { t.error(err) })
    }
  })

  function done () {
    idx.ready(function () {
      var finalVersion = values(versions.deserialize(version).keys)
      t.equal(finalVersion.length, 1)
      t.equal(finalVersion[0].max, 200)
      t.equal(sum, expectedSum)
    })
  }
})

test('adder /w index made AFTER db population', function (t) {
  t.plan(204)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var sum = 0
  var version = null

  var pending = 200
  var expectedSum = 0

  db.writer(function (err, w) {
    t.error(err)
    for (var i = 0; i < pending; i++) {
      var n = Math.floor(Math.random() * 10)
      expectedSum += n
      w.append({value: n}, function (err) {
        t.error(err)
        if (!--pending) done()
      })
    }
  })

  function done () {
    var idx = index({
      log: db,
      batch: function (nodes, next) {
        nodes.forEach(function (node) { sum += node.value.value })
        next()
      },
      fetchState: function (cb) { cb(null, version) },
      storeState: function (s, cb) { version = s; cb(null) }
    })
    idx.ready(function () {
      var finalVersion = values(versions.deserialize(version).keys)
      t.equal(finalVersion.length, 1)
      t.equal(finalVersion[0].max, 200)
      t.equal(sum, expectedSum)
    })
  }
})

test('adder /w async storage', function (t) {
  t.plan(7)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var sum = 0
  var version = null

  function getSum (cb) {
    setTimeout(function () { cb(sum) }, Math.floor(Math.random() * 200))
  }
  function setSum (newSum, cb) {
    setTimeout(function () {
      sum = newSum
      cb()
    }, Math.floor(Math.random() * 200))
  }

  var idx = index({
    log: db,
    batch: function (nodes, next) {
      nodes.forEach(function (node) {
        if (typeof node.value.value === 'number') {
          getSum(function (theSum) {
            theSum += node.value.value
            setSum(theSum, function () {
              next()
              if (!--pending) done()
            })
          })
        }
      })
    },
    fetchState: function (cb) { cb(null, version) },
    storeState: function (s, cb) { version = s; cb(null) }
  })

  var pending = 3
  db.writer(function (err, w) {
    t.error(err)
    w.append({value: 17}, function (err) { t.error(err) })
    w.append({value: 12}, function (err) { t.error(err) })
    w.append({value: 1}, function (err) { t.error(err) })
  })

  function done () {
    idx.ready(function () {
      var finalVersion = values(versions.deserialize(version).keys)
      t.equal(finalVersion.length, 1)
      t.equal(finalVersion[0].max, 3)
      t.equal(sum, 30)
    })
  }
})

test('adder /w async storage: ready', function (t) {
  t.plan(7)

  var db = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var sum = 0
  var version = null

  function getSum (cb) {
    setTimeout(function () { cb(sum) }, Math.floor(Math.random() * 100))
  }
  function setSum (newSum, cb) {
    setTimeout(function () {
      sum = newSum
      cb()
    }, Math.floor(Math.random() * 100))
  }

  var idx = index({
    log: db,
    batch: function (nodes, next) {
      nodes.forEach(function (node) {
        if (typeof node.value.value === 'number') {
          getSum(function (theSum) {
            theSum += node.value.value
            setSum(theSum, function () {
              next()
            })
          })
        }
      })
    },
    fetchState: function (cb) { cb(null, version) },
    storeState: function (s, cb) { version = s; cb(null) }
  })

  db.writer(function (err, w) {
    t.error(err)
    w.append({value: 17}, function (err) {
      t.error(err)
      w.append({value: 12}, function (err) {
        t.error(err)
        w.append({value: 1}, function (err) {
          t.error(err)
          idx.ready(function () {
            getSum(function (theSum) {
              var finalVersion = values(versions.deserialize(version).keys)
              t.equal(finalVersion.length, 1)
              t.equal(finalVersion[0].max, 3)
              t.equals(theSum, 30)
            })
          })
        })
      })
    })
  })
})

test('fs: adder', function (t) {
  t.plan(55)

  var id = String(Math.random()).substring(2)
  var dir = path.join(tmp(), 'hyperdb-index-test-' + id)
  var db = multifeed(hypercore, dir, { valueEncoding: 'json' })

  var sum = 0
  var version = null

  var idx = index({
    log: db,
    batch: function (nodes, next) {
      nodes.forEach(function (node) {
        if (typeof node.value.value === 'number') sum += node.value.value
      })
      next()
    },
    fetchState: function (cb) {
      setTimeout(function () { cb(null, version) }, 50)
    },
    storeState: function (s, cb) {
      setTimeout(function () { version = s; cb(null) }, 50)
    }
  })

  var pending = 50
  var expectedSum = 0
  db.writer(function (err, w) {
    t.error(err)
    for (var i = 0; i < pending; i++) {
      var value = i * 2 + 1
      expectedSum += value
      w.append({value: value}, function (err) {
        t.error(err)
        if (!--pending) done()
      })
    }
  })

  function done (err) {
    t.error(err)
    idx.ready(function () {
      var finalVersion = values(versions.deserialize(version).keys)
      t.equal(finalVersion.length, 1)
      t.equal(sum, expectedSum, 'sum of all nodes is as expected')
      t.equal(finalVersion[0].max, 50)
      rimraf.sync(dir)
    })
  }
})

test('adder + sync', function (t) {
  t.plan(14)

  createTwo(function (db1, db2) {
    var sum1 = 0
    var sum2 = 0
    var version1 = null
    var version2 = null

    var pending = 4
    var idx1 = index({
      log: db1,
      batch: function (nodes, next) {
        nodes.forEach(function (node) {
          if (typeof node.value.value === 'number') sum1 += node.value.value
        })
        next()

        if (!--pending) done()
      },
      fetchState: function (cb) { cb(null, version1) },
      storeState: function (s, cb) { version1 = s; cb(null) }
    })

    var idx2 = index({
      log: db2,
      batch: function (nodes, next) {
        nodes.forEach(function (node) {
          if (typeof node.value.value === 'number') sum2 += node.value.value
        })
        next()

        if (!--pending) done()
      },
      fetchState: function (cb) { cb(null, version2) },
      storeState: function (s, cb) { version2 = s; cb(null) }
    })

    db1.writer(function (err, w) {
      t.error(err)
      w.append({value: 17}, function (err) { t.error(err) })
      w.append({value: 12}, function (err) { t.error(err) })
      w.append({value: 1}, function (err) { t.error(err) })
    })
    db2.writer(function (err, w) {
      t.error(err)
      w.append({value: 9}, function (err) { t.error(err) })
    })

    function done () {
      replicate(db1, db2, function () {
        idx1.ready(function () {
          idx2.ready(function () {
            var finalVersion = values(versions.deserialize(version1).keys)
            t.equal(finalVersion.length, 2)
            t.equal(finalVersion[0].max, 3)
            t.equal(finalVersion[1].max, 1)
            t.equal(sum1, 39)

            finalVersion = values(versions.deserialize(version2).keys)
            t.equal(finalVersion.length, 2)
            t.equal(finalVersion[0].max, 1)
            t.equal(finalVersion[1].max, 3)
            t.equal(sum2, 39)

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

function values (dict) {
  return Object.keys(dict).map(k => dict[k])
}
