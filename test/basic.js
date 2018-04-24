var test = require('tape')
var hypercore = require('hypercore')
var multicore = require('multi-hypercore')
var indexer = require('..')
var umkv = require('unordered-materialized-kv')
var ram = require('random-access-memory')
var memdb = require('memdb')

// TODO: test creating the index AFTER the data has been created

test('kv: create index then data', function (t) {
  t.plan(7)

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
