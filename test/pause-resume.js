var test = require('tape')
var multifeed = require('multifeed')
var indexer = require('..')
var ram = require('random-access-memory')

test('pause while ready', function (t) {
  t.plan(4)

  var count = 0
  var multi = multifeed(ram, { valueEncoding: 'json' })
  var counter = indexer({
    log: multi,
    batch: function (nodes, next) {
      next()
    }
  })

  var entries = [1, 2, 3, 4, 5, 6]
  multi.writer(function (err, w) {
    t.error(err)
    w.append(entries, function (err) {
      t.error(err)
      counter.ready(function () {
        counter.pause(function () {
          w.append(10, function (err) {
            t.error(err)
            counter.resume()
            counter.ready(function () {
              t.equals(count, 31, 'count matches')
            })
          })
        })
      })
    })
  })

  counter.on('indexed', function (msgs) {
    count = msgs.reduce(function (accum, msg) {
      return accum + msg.value
    }, count)
  })
})

test('pause while indexing', function (t) {
  t.plan(4)

  var count = 0
  var multi = multifeed(ram, { valueEncoding: 'json' })
  var counter = indexer({
    log: multi,
    batch: function (nodes, next) {
      next()
    }
  })

  var entries = [1, 2, 3, 4, 5, 6]
  multi.writer(function (err, w) {
    t.error(err)
    w.append(entries, function (err) {
      t.error(err)
      counter.pause(function () {
        w.append(10, function (err) {
          t.error(err)
          counter.resume()
          counter.ready(function () {
            t.equals(count, 31, 'count matches')
          })
        })
      })
    })
  })

  counter.on('indexed', function (msgs) {
    count = msgs.reduce(function (accum, msg) {
      return accum + msg.value
    }, count)
  })
})
