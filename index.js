var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter

module.exports = Indexer

function Indexer (opts) {
  if (!(this instanceof Indexer)) return new Indexer(opts)

  if (!opts) throw new Error('missing opts param')
  if (!opts.cores) throw new Error('missing opts param "cores"')
  if (!opts.map) throw new Error('missing opts param "map"')
  // TODO: support forward & backward indexing from newest
  // TODO: support opts.batchSize
  // TODO: support batch indexing

  this._cores = opts.cores
  this._map = opts.map
  this._ready = false

  // TODO: use some kind of storage instead
  this._at = []

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

  var feeds = this._cores.feeds()
  for (var i=0; i < feeds.length; i++) {
    if (this._at[i] === undefined) {
      this._at.push({ max: 0 })  // processed up to, exclusive
    }

    // prefer to process forward
    if (this._at[i].max < feeds[i].length) {
      pending++
      didWork = true
      var seq = this._at[i].max
      var n = i
      feeds[n].get(seq, function (err, node) {
        var id = feeds[n].key.toString('hex') + '@' + seq
        self._map(node, feeds[n], seq, function () {
          // TODO: write 'at' to storage
          self._at[n].max++
          done()
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

