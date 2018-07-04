var test = require('tape')
var hypercore = require('hypercore')
var multifeed = require('multifeed')
var ram = require('random-access-memory')
var memdb = require('memdb')
var umkv = require('unordered-materialized-kv')
var indexer = require('../')

test('kv merge fork', function (t) {
  t.plan(19)
  var a = multifeed(hypercore, ram, { valueEncoding: 'json' })
  var b = multifeed(hypercore, ram, { valueEncoding: 'json' })
  var akv = umkv(memdb())
  var bkv = umkv(memdb())
  var ai = indexer({
    log: a,
    batch: batchFn(akv)
  })
  var bi = indexer({
    log: b,
    batch: batchFn(bkv)
  })
  function batchFn (kv) {
    return function (nodes, next) {
      kv.batch(nodes.map(function (node) {
        return {
          id: node.value.id,
          key: 'X',
          links: node.value.links
        }
      }), next)
    }
  }

  var pending = 2
  a.ready(onready)
  b.ready(onready)
  function onready () {
    if (--pending === 0) populateFirst()
  }
  function populateFirst () {
    a.writer(function (err, w) {
      t.error(err)
      w.append({ id: 1, value: 100, links: [] }, function (err) {
        t.error(err)
        sync(a,b,populateSecond)
      })
    })
  }
  function populateSecond (err) {
    var pending = 2
    t.error(err)
    a.writer(function (err, w) {
      t.error(err)
      w.append({ id: 2, value: 200, links: [1] }, function (err) {
        t.error(err)
        if (--pending === 0) sync(a,b,readyCheckForked)
      })
    })
    b.writer(function (err, w) {
      t.error(err)
      w.append({ id: 3, value: 300, links: [1] }, function (err) {
        t.error(err)
        if (--pending === 0) sync(a,b,readyCheckForked)
      })
    })
  }
  function readyCheckForked (err) {
    t.error(err)
    var pending = 2
    ai.ready(onready)
    bi.ready(onready)
    function onready () { if (--pending === 0) checkForked() }
  }
  function checkForked () {
    var pending = 2
    akv.get('X', function (err, heads) {
      t.error(err)
      t.deepEqual(heads.sort(), ['2','3'])
      if (--pending === 0) populateThird()
    })
    bkv.get('X', function (err, heads) {
      t.error(err)
      t.deepEqual(heads.sort(), ['2','3'])
      if (--pending === 0) populateThird()
    })
  }
  function populateThird () {
    a.writer(function (err, w) {
      t.error(err)
      w.append({ id: 4, value: 400, links: [2,3] }, function (err) {
        t.error(err)
        sync(a,b,readyCheckFinal)
      })
    })
  }
  function readyCheckFinal (err) {
    t.error(err)
    var pending = 2
    ai.ready(onready)
    bi.ready(onready)
    function onready () { if (--pending === 0) checkFinal() }
  }
  function checkFinal () {
    akv.get('X', function (err, heads) {
      t.error(err)
      t.deepEqual(heads, ['4'])
    })
    bkv.get('X', function (err, heads) {
      t.error(err)
      t.deepEqual(heads, ['4'])
    })
  }
})

function sync (a, b, cb) {
  var pending = 2
  var sa = a.replicate()
  var sb = b.replicate()
  sa.pipe(sb).pipe(sa)
  sa.on('error', cb)
  sb.on('error', cb)
  sa.on('end', onend)
  sb.on('end', onend)
  function onend () { if (--pending === 0) cb() }
}
