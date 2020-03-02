var test = require('tape')
var multifeed = require('multifeed')
var indexer = require('..')
var ram = require('random-access-memory')

test('state is idle on creation', function (t) {
  t.plan(1)

  var multi = multifeed(ram, { valueEncoding: 'json' })

  var idx = indexer({
    log: multi,
    batch: function (nodes, next) {
      next()
    }
  })

  idx.ready(function () {
    t.equals(idx.getState().state, 'idle')
  })
})

test('create a writer', function (t) {
  t.plan(2)

  var multi = multifeed(ram, { valueEncoding: 'json' })

  var idx = indexer({
    log: multi,
    batch: function (nodes, next) {
      next()
    }
  })

  idx.once('state-update', function (state) {
    t.equals(state.state, 'idle')
  })

  multi.writer(function (err, w) {
    t.error(err)
  })
})

test('create a writer and write blocks', function (t) {
  t.plan(8)

  var multi = multifeed(ram, { valueEncoding: 'json' })

  var idx = indexer({
    log: multi,
    batch: function (nodes, next) {
      next()
    }
  })

  idx.ready(function () {
    idx.once('state-update', function (state) {
      t.equals(state.state, 'indexing')
      t.equals(idx.getState().context.totalBlocks, 1)
      t.equals(idx.getState().context.indexedBlocks, 0)

      idx.once('state-update', function (state) {
        t.equals(state.state, 'idle')
        t.equals(idx.getState().context.totalBlocks, 1)
        t.equals(idx.getState().context.indexedBlocks, 1)
      })
    })

    multi.writer(function (err, w) {
      t.error(err)
      w.append({
        key: 'foo',
        value: 'bax'
      }, function (err, id1) {
        t.error(err, 'append is ok')
      })
    })
  })
})

test('pausing when nothing is indexing', function (t) {
  t.plan(3)

  var multi = multifeed(ram, { valueEncoding: 'json' })

  var idx = indexer({
    log: multi,
    batch: function (nodes, next) {
      next()
    }
  })

  idx.ready(function () {
    t.equals(idx.getState().state, 'idle')
    idx.pause(function () {
      t.equals(idx.getState().state, 'paused')
      idx.resume()
      t.equals(idx.getState().state, 'idle')
    })
  })
})

test('pausing while indexing', function (t) {
  t.plan(16)

  var multi = multifeed(ram, { valueEncoding: 'json' })

  var idx = indexer({
    log: multi,
    batch: function (nodes, next) {
      next()
    }
  })

  idx.ready(function () {
    t.equals(idx.getState().state, 'idle')

    multi.writer(function (err, w) {
      t.error(err)

      w.append({
        key: 'foo',
        value: 'bax'
      }, function (err, id1) {
        t.error(err, 'append is ok')

        t.equals(idx.getState().state, 'indexing')
        t.equals(idx.getState().context.totalBlocks, 1)
        t.equals(idx.getState().context.indexedBlocks, 0)

        idx.pause(function () {
          t.equals(idx.getState().state, 'paused')
          t.equals(idx.getState().context.totalBlocks, 1)
          t.equals(idx.getState().context.indexedBlocks, 1)

          w.append({
            key: 'quux',
            value: 'simmel'
          })

          idx.resume()
          t.equals(idx.getState().state, 'idle')

          idx.once('state-update', function (state) {
            t.equals(idx.getState().state, 'indexing')
            t.equals(idx.getState().context.totalBlocks, 2)
            t.equals(idx.getState().context.indexedBlocks, 1)

            idx.once('state-update', function (state) {
              t.equals(idx.getState().state, 'idle')
              t.equals(idx.getState().context.totalBlocks, 2)
              t.equals(idx.getState().context.indexedBlocks, 2)
            })
          })
        })
      })
    })
  })
})

test('error state', function (t) {
  t.plan(2)

  var multi = multifeed(ram, { valueEncoding: 'json' })
  const error = new Error('boom!')

  var idx = indexer({
    log: multi,
    fetchState: function (cb) { process.nextTick(cb, error) },
    storeState: function (state, cb) { process.nextTick(cb, error) },
    batch: function (nodes, next) {
      next()
    }
  })
  idx.on('error', function () {})

  idx.once('state-update', function (state) {
    t.equals(state.state, 'error')
    t.deepEquals(state.context.error, error)
  })
})
