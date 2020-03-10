var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var IndexState = require('./lib/state')
var clone = require('clone')

module.exports = Indexer

var State = {
  PreIndexing: 'preindexing',
  Indexing: 'indexing',
  Idle: 'idle',
  Paused: 'paused',
  Error: 'error'
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

  // Is there another pending indexing run?
  this._pending = false

  this._state = {
    state: State.Indexing,
    context: {
      totalBlocks: 0,
      indexedBlocks: 0,
      prevIndexedBlocks: 0,
      indexStartTime: Date.now(),
      error: null
    }
  }

  this._at = null
  // bind methods to this so we can pass them directly to event listeners
  this._freshRun = this._run.bind(this, false)
  this._onNewFeed = this._onNewFeed.bind(this)

  if (!opts.storeState && !opts.fetchState && !opts.clearIndex) {
    // In-memory storage implementation
    var state
    this._storeIndexState = function (buf, cb) {
      state = buf
      process.nextTick(cb)
    }
    this._fetchIndexState = function (cb) {
      process.nextTick(cb, null, state)
    }
    this._clearIndex = function (cb) {
      state = null
      process.nextTick(cb)
    }
  } else {
    this._storeIndexState = opts.storeState
    this._fetchIndexState = opts.fetchState
    this._clearIndex = opts.clearIndex || null
  }

  var self = this

  function onError (err) {
    self._setState(State.Error, { error: err })
    self.emit('error', err)
  }

  this._log.ready(function () {
    self._fetchIndexState(function (err, state) {
      if (err && !err.notFound) {
        onError(err)
        return
      }
      if (!state) {
        start()
        return
      }

      try {
        state = IndexState.deserialize(state)
      } catch (e) {
        onError(e)
        return
      }

      // Wipe existing index if versions don't match (and there's a 'clearIndex' implementation)
      var storedVersion = state.version
      if (storedVersion !== self._version && self._clearIndex) {
        self._clearIndex(function (err) {
          if (err) {
            onError(err)
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
    self._setState(State.Idle)
    self._freshRun()
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
    feed.removeListener('append', self._freshRun)
    feed.removeListener('download', self._freshRun)
    feed.on('append', self._freshRun)
    feed.on('download', self._freshRun)
    if (self._state.state === State.Idle) self._freshRun()
  })
}

Indexer.prototype.pause = function (cb) {
  cb = cb || function () {}
  var self = this

  if (this._state.state === State.Paused || this._wantPause) {
    process.nextTick(cb)
  } else if (this._state.state === State.Idle) {
    self._setState(State.Paused)
    process.nextTick(cb)
  } else {
    this._wantPause = true
    this.once('pause', function () {
      self._wantPause = false
      self._setState(State.Paused)
      cb()
    })
  }
}

Indexer.prototype.resume = function () {
  if (this._state.state !== State.Paused) return

  this._setState(State.Idle)
  this._freshRun()
}

Indexer.prototype.ready = function (fn) {
  if (this._state.state === State.Idle) process.nextTick(fn)
  else this.once('ready', fn)
}

Indexer.prototype._run = function (continuedRun) {
  if (this._wantPause) {
    this._wantPause = false
    this._pending = true
    this.emit('pause')
    return
  }
  if (!continuedRun && this._state.state !== State.Idle) {
    this._pending = true
    return
  }
  var self = this

  this._state.state = State.PreIndexing

  var didWork = false

  // load state from storage
  if (!this._at) {
    this._fetchIndexState(function (err, state) {
      // TODO: single error handling path (to emit + put in error state)
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
        self._at = IndexState.deserialize(state).keys
      }

      self._log.feeds().forEach(function (feed) {
        feed.setMaxListeners(128)
        // The ready() method also adds these events listeners. Try to remove
        // them first so that they aren't added twice.
        feed.removeListener('append', self._freshRun)
        feed.removeListener('download', self._freshRun)
        feed.on('append', self._freshRun)
        feed.on('download', self._freshRun)
      })

      work()
    })
  } else {
    work()
  }

  function work () {
    var feeds = self._log.feeds()
    var nodes = []

    // Check if there is anything new.
    var indexedBlocks = Object.values(self._at).reduce((accum, entry) => accum + entry.max, 0)
    var totalBlocks = self._log.feeds().reduce((accum, feed) => accum + feed.length, 0)

    // Bail if no work needs to happen.
    if (indexedBlocks === totalBlocks) {
      return done()
    }

    if (!continuedRun) {
      const context = {
        indexStartTime: Date.now(),
        prevIndexedBlocks: self._state.context.indexedBlocks,
        indexedBlocks: indexedBlocks,
        totalBlocks: totalBlocks
      }
      self._setState(State.Indexing, context)
    }

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
              self._storeIndexState(IndexState.serialize(self._at, self._version), function () {
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
      if (didWork || self._pending) {
        self._state.context.totalBlocks = self._log.feeds().reduce(
          (accum, feed) => accum + feed.length, 0)
        self._state.context.indexedBlocks = Object.values(self._at).reduce(
          (accum, entry) => accum + entry.max, 0)

        self._pending = false
        self._run(true)
      } else {
        if (self._wantPause) {
          self._wantPause = false
          self._pending = true
          self.emit('pause')
        } else {
          // Don't do a proper state change if this is the first run and
          // nothing had to be indexed, since it would look like Idle -> Idle
          // to API consumers.
          if (continuedRun) self._setState(State.Idle)
          else self._state.state = State.Idle

          self.emit('ready')
        }
      }
    }
  }
}

// Set state to `state` and apply updates `context` to the state context. Also
// emits a `state-update` event.
Indexer.prototype._setState = function (state, context) {
  if (state === this._state.state) return

  if (!context) context = {}

  this._state.state = state
  this._state.context = Object.assign({}, this._state.context, context)
  this.emit('state-update', clone(this._state, false))
}

Indexer.prototype.getState = function () {
  const state = clone(this._state, false)

  // hidden states
  if (state.state === State.PreIndexing) state.state = State.Idle

  return state
}

function allOrNone (a, b) {
  return (!!a && !!b) || (!a && !b)
}

function unset (x) {
  return x === null || x === undefined
}
