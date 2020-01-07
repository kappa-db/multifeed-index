var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var State = require('./lib/state')

module.exports = Indexer

var Status = {
  Indexing: 1,
  Ready: 2,
  Paused: 3
}

function Indexer (opts) {
  if (!(this instanceof Indexer)) return new Indexer(opts)

  if (!opts) throw new Error('missing opts param')
  if (!opts.log) throw new Error('missing opts param "log"')
  if (!opts.batch) throw new Error('missing opts param "batch"')
  if (!allOrNone(!!opts.storeState, !!opts.fetchState)) {
    throw new Error('either none or all of (opts.storeState, opts.fetchState) must be provided')
  }
  if (!unset(opts.version) && typeof opts.version !== 'number') throw new Error('opts.version must be a number')
  // TODO: support forward & backward indexing from newest

  this._version = unset(opts.version) ? 1 : opts.version
  this._log = opts.log
  this._batch = opts.batch
  this._maxBatch = unset(opts.maxBatch) ? 50 : opts.maxBatch
  this._state = Status.Indexing

  this._at = null
  // bind methods to this so we can pass them directly to event listeners
  this._run = this._run.bind(this)
  this._onNewFeed = this._onNewFeed.bind(this)

  if (!opts.storeState && !opts.fetchState && !opts.clearIndex) {
    // In-memory storage implementation
    var state
    this._storeState = function (buf, cb) {
      state = buf
      process.nextTick(cb)
    }
    this._fetchState = function (cb) {
      process.nextTick(cb, null, state)
    }
    this._clearIndex = function (cb) {
      state = null
      process.nextTick(cb)
    }
  } else {
    this._storeState = opts.storeState
    this._fetchState = opts.fetchState
    this._clearIndex = opts.clearIndex || null
  }

  var self = this

  this._log.ready(function () {
    self._fetchState(function (err, state) {
      if (err && !err.notFound) {
        self.emit('error', err)
        return
      }
      if (!state) {
        start()
        return
      }

      try {
        state = State.deserialize(state)
      } catch (e) {
        self.emit('error', e)
        return
      }

      // Wipe existing index if versions don't match (and there's a 'clearIndex' implementation)
      var storedVersion = state.version
      if (storedVersion !== self._version && self._clearIndex) {
        self._clearIndex(function (err) {
          if (err) {
            self.emit('error', err)
          } else {
            start()
          }
        })
      } else {
        start()
      }
    })
  })

  function start () {
    self._state = Status.Ready
    self._run()
  }

  this._log.on('feed', this._onNewFeed)

  this.setMaxListeners(1024)
}

inherits(Indexer, EventEmitter)

Indexer.prototype._onNewFeed = function (feed, idx) {
  var self = this
  feed.setMaxListeners(128)
  feed.ready(function () {
    // It's possible these listeners are already attached. Ensure they are
    // removed before attaching them to avoid attaching them twice
    feed.removeListener('append', self._run)
    feed.removeListener('download', self._run)
    feed.on('append', self._run)
    feed.on('download', self._run)
    if (self._state === Status.Ready) self._run()
  })
}

Indexer.prototype.pause = function (cb) {
  cb = cb || function () {}
  var self = this

  if (this._state === Status.Paused || this._wantPause) {
    process.nextTick(cb)
  } else if (this._state === Status.Ready) {
    this._state = Status.Paused
    process.nextTick(cb)
  } else {
    this._wantPause = true
    this.once('pause', function () {
      self._wantPause = false
      self._state = Status.Paused
      cb()
    })
  }
}

Indexer.prototype.resume = function () {
  if (this._state !== Status.Paused) return

  this._state = Status.Ready
  this._run()
}

Indexer.prototype.ready = function (fn) {
  if (this._state === Status.Ready) process.nextTick(fn)
  else this.once('ready', fn)
}

Indexer.prototype._run = function () {
  if (this._wantPause) {
    this._wantPause = false
    this._pending = true
    this.emit('pause')
    return
  }
  if (this._state !== Status.Ready) {
    this._pending = true
    return
  }
  var self = this

  this._state = Status.Indexing

  var didWork = false

  var pending = 1

  // load state from storage
  if (!this._at) {
    this._fetchState(function (err, state) {
      if (err && !err.notFound) throw err // TODO: how to bubble up errors? eventemitter?
      if (!state) {
        self._at = {}
        self._log.feeds().forEach(function (feed) {
          self._at[feed.key.toString('hex')] = {
            key: feed.key,
            min: 0,
            max: 0
          }
        })
      } else {
        self._at = State.deserialize(state).keys
      }

      self._log.feeds().forEach(function (feed) {
        feed.setMaxListeners(128)
        // The ready() method also adds these events listeners. Try to remove
        // them first so that they aren't added twice.
        feed.removeListener('append', self._run)
        feed.removeListener('download', self._run)
        feed.on('append', self._run)
        feed.on('download', self._run)
      })

      work()
    })
  } else {
    work()
  }

  function work () {
    var feeds = self._log.feeds()
    var nodes = []

    ;(function collect (i) {
      if (i >= feeds.length) return done()

      feeds[i].ready(function () {
        var key = feeds[i].key.toString('hex')

        if (self._at[key] === undefined) {
          self._at[key] = { key: feeds[i].key, min: 0, max: 0 }
        }

        // prefer to process forward
        var at = self._at[key].max
        var to = Math.min(feeds[i].length, at + self._maxBatch)

        if (!feeds[i].has(at, to)) {
          return collect(i + 1)
        } else if (at < to) {
          // TODO: This waits for all of the blocks to be available, and
          // actually blocks ALL indexing until it's ready. The intention is to
          // get min(maxBatch, feed.length-at) CONTIGUOUS entries
          feeds[i].getBatch(at, to, {wait: false}, function (err, res) {
            if (err || !res.length) {
              return collect(i + 1)
            }
            for (var j = 0; j < res.length; j++) {
              var node = res[j]
              nodes.push({
                key: feeds[i].key.toString('hex'),
                seq: j + at,
                value: node
              })
            }

            didWork = true
            self._batch(nodes, function () {
              self._at[key].max += nodes.length
              self._storeState(State.serialize(self._at, self._version), function () {
                self.emit('indexed', nodes)
                done()
              })
            })
          })
        } else {
          collect(i + 1)
        }
      })
    })(0)

    function done () {
      if (!--pending) {
        self._state = Status.Ready
        if (didWork || self._pending) {
          self._pending = false
          self._run()
        } else {
          if (self._wantPause) {
            self._wantPause = false
            self._pending = true
            self.emit('pause')
            return
          }
          self.emit('ready')
        }
      }
    }
  }
}

function allOrNone (a, b) {
  return (!!a && !!b) || (!a && !b)
}

function unset (x) {
  return x === null || x === undefined
}
