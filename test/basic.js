var test = require('tape')
var multifeed = require('multifeed')
var indexer = require('..')
var umkv = require('unordered-materialized-kv')
var ram = require('random-access-memory')
var memdb = require('level-mem')

test('kv: create index then data', function (t) {
  t.plan(10)

  var multi = multifeed(ram, { valueEncoding: 'json' })

  var kv = umkv(memdb())

  var hyperkv = indexer({
    log: multi,
    batch: function (nodes, next) {
      var batch = nodes.map(function (node) {
        return {
          id: node.key.toString('hex') + '@' + node.seq,
          key: node.value.key,
          links: node.value.links
        }
      })
      kv.batch(batch, next)
    }
  })

  function append (w, data, cb) {
    w.append(data, function (err) {
      t.error(err)
      var id = w.key.toString('hex') + '@' + (w.length - 1)
      cb(null, id)
    })
  }

  hyperkv.ready(function () {
    kv.get('foo', function (err, res) {
      t.ok(err, 'foo not inserted yet')
      t.equals(err.notFound, true, 'not found error from level')
    })
  })

  multi.writer(function (err, w) {
    t.error(err)
    append(w, {
      key: 'foo',
      value: 'bax',
      links: []
    }, function (err, id1) {
      t.error(err, 'no append error 1')
      append(w, {
        key: 'foo',
        value: 'bax',
        links: [id1]
      }, function (err, id2) {
        t.error(err, 'no append error 1')
        hyperkv.ready(function () {
          kv.get('foo', function (err, res) {
            t.error(err)
            t.equals(res.length, 1)
            t.equals(res[0], w.key.toString('hex') + '@1')
          })
        })
      })
    })
  })
})

test('indexed event', function (t) {
  t.plan(4)

  var multi = multifeed(ram, { valueEncoding: 'json' })

  var entries = [1, 2, 3, 4, 5, 6]
  multi.writer(function (err, w) {
    t.error(err)
    w.append(entries, function (err) {
      t.error(err)
      w.append(10, function (err) {
        t.error(err)
        counter.ready(function () {
          t.equals(count, 7, 'count matches')
        })
      })
    })
  })

  var count = 0

  var counter = indexer({
    log: multi,
    batch: function (nodes, next) {
      next()
    }
  })

  counter.on('indexed', function (msgs) {
    count += msgs.length
  })
})
