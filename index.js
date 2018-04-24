var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var State = require('./lib/state')

module.exports = Indexer

function Indexer (opts) {
  if (!(this instanceof Indexer)) return new Indexer(opts)

  if (!opts) throw new Error('missing opts param')
  if (!opts.cores) throw new Error('missing opts param "cores"')
  if (!opts.map) throw new Error('missing opts param "map"')
  if (xor(!!opts.storeState, !!opts.fetchState)) throw new Error('either neither or both of {opts.storeState, opts.fetchState} must be provided')
  // TODO: support forward & backward indexing from newest
  // TODO: support opts.batchSize
  // TODO: support batch indexing

  this._cores = opts.cores
  this._map = opts.map
  this._ready = false

  this._at = null
  var state
  if (!opts.storeState && !opts.fetchState) {
    this._storeState = function (buf, cb) {
      state = buf
      process.nextTick(cb)
    }
    this._fetchState = function (cb) {
      process.nextTick(cb, null, state)
    }
  } else {
    this._storeState = opts.storeState
    this._fetchState = opts.fetchState
  }

  var self = this

  this._cores.ready(function () {
    self._ready = true
    self._run()
  })

  this._cores.on('feed', function (feed, idx) {
    feed.on('append', function () {
      self._run()
    })
    if (self._ready) self._run()
  })
}

inherits(Indexer, EventEmitter)

Indexer.prototype.ready = function (fn) {
  if (this._ready) process.nextTick(fn)
  else this.once('ready', fn)
}

Indexer.prototype._run = function () {
  if (!this._ready) return
  var self = this

  this._ready = false

  var didWork = false

  var pending = 1

  // load state from storage
  if (!this._at) {
    this._fetchState(function (err, state) {
      if (err) throw err  // TODO: how to bubble up errors? eventemitter?
      var at = !state ? [] : State.deserialize(state)
      self._at = at
      work()
    })
  } else {
    work()
  }

  function work () {
    var feeds = self._cores.feeds()
    for (var i=0; i < feeds.length; i++) {
      if (self._at[i] === undefined) {
        self._at.push({ key: feeds[i].key, min: 0, max: 0 })
      }

      // prefer to process forward
      if (self._at[i].max < feeds[i].length) {
        pending++
        didWork = true
        var seq = self._at[i].max
        var n = i
        feeds[n].get(seq, function (err, node) {
          var id = feeds[n].key.toString('hex') + '@' + seq
          self._map(node, feeds[n], seq, function () {
            // TODO: write 'at' to storage
            self._at[n].max++
            self._storeState(State.serialize(self._at), done)
          })
        })
      }
    }

    done()

    function done() {
      if (!--pending) {
        self._ready = true
        if (didWork) {
          self._run()
        } else {
          self.emit('ready')
        }
      }
    }
  }
}

function xor (a, b) {
  return (a && !b) || (!a && b)
}
