var test = require('tape')
var hypercore = require('hypercore')
var multicore = require('multi-hypercore')
var indexer = require('..')
var umkv = require('unordered-materialized-kv')
var ram = require('random-access-memory')
var memdb = require('memdb')

test('kv index', function (t) {
  t.plan(7)

  var multi = multicore(hypercore, ram, { valueEncoding: 'json' })

  var kv = umkv(memdb())

  var hyperkv = indexer({
    cores: multi,
    batch: function (nodes, next) {
      kv.batch(nodes, next)
    }
  })

  function append (w, data, cb) {
    w.append(data, function (err) {
      t.error(err)
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
      t.error(err)
      append(w, {
        key: 'foo',
        value: 'bax',
        links: [id1]
      }, function (err, id2) {
        t.error(err)
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
