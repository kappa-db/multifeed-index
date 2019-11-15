# multifeed-index

> Build an index over a set of hypercores.

Traverses a set of hypercores (as a [multifeed][multifeed] and calls a user
indexing function to build an index.

## Purpose

A [multifeed][multifeed] is a set of append-only logs (feeds), with the
property that only the feed's author can write new entries to it.

One type of document that you might write to such a feed are key -> value
pairs. Maybe documents looks like this:

```js
{
  id: '23482934',
  name: 'quinn',
  gender: null
}
```

So some key, `'23482934'`, could can map to this document. How could you make
this look-up from `'23482934'` to the aforementioned document fast? What if
there are thousands of such entries?

You'd probably want to build some kind of index. One that iterates over every
entry in every feed, and also listens for new entries that get added. Then you
could create an efficient data structure (say, maybe with
[level](https://github.com/Level/level)) that can map each key to a value
quickly. 

Good news: this is essentially what `multifeed-index` does!

It does this by taking a multifeed you give it, along with three functions that
the user provides:

1. `storeState(state, cb)`: multifeed-index will give you a `Buffer` object,
   `state`, to store somewhere of your choosing. This could be in memory, to a
   database, to a JSON file, to browser storage, or whatever makes sense for
   your program. The module doesn't want to tie you down to a specific storage
   method.
2. `fetchState(cb)`: Like `storeState`, except this function will be called by
   multifeed-index when it needs to retrieve the state. Your job is to call the
   callback `cb` with the same `state` Buffer that was given to `storeState`
   earlier.
3. `clearIndex(cb)`: This only gets called when you change the `version` of the
   multifeed-index (see below). This function should delete the entire index
   *and* whatever `state` it stored earlier, so that the new version of the
   index can be regenerated from scratch.

## Example

Let's build a key-value index using this and
[unordered-materialized-kv](https://github.com/substack/unordered-materialized-kv):

```js
var multifeed = require('multifeed')
var indexer = require('multifeed-index')
var umkv = require('unordered-materialized-kv')
var ram = require('random-access-memory')
var memdb = require('memdb')

var multi = multifeed(ram, { valueEncoding: 'json' })

var kv = umkv(memdb())

var kvView = indexer({
  version: 1,  // setting a different number will cause the index to be purged and rebuilt
  log: multi,
  maxBatch: 5,
  batch: function (nodes, next) {
    var ops = nodes.map(function (node) {
      return {
        id: node.key.toString('hex') + '@' + node.seq,
        key: node.value.key,
        links: node.value.links
      }
    })
    kv.batch(ops, next)
  }
})

function append (w, data, cb) {
  w.append(data, function (err) {
    if (err) return cb(err)
    var id = w.key.toString('hex') + '@' + (w.length - 1)
    cb(null, id)
  })
}

multi.writer(function (_, w) {
  append(w, {
    key: 'foo',
    value: 'bax',
    links: []
  }, function (_, id1) {
    console.log('id-1', id1)
    append(w, {
      key: 'foo',
      value: 'bax',
      links: [id1]
    }, function (_, id2) {
      console.log('id-2', id2)
      kvView.ready(function () {
        kv.get('foo', function (_, res) {
          console.log(res)
        })
      })
    })
  })
})
```

outputs

```
id-1 9736a3ff7ae522ca80b7612fed5aefe8cfb40e0a43199174e47d78703abaa22f@0
id-2 9736a3ff7ae522ca80b7612fed5aefe8cfb40e0a43199174e47d78703abaa22f@1
[
  '9736a3ff7ae522ca80b7612fed5aefe8cfb40e0a43199174e47d78703abaa22f@1'
]
```

## API

> var Index = require('multifeed-index')

### var index = Index(opts)

Required `opts` include:

- `log`: a [multifeed](https://github.com/noffle/multifeed) instance
- `batch`: a mapping function, to be called on 1+ nodes at a time in the
  hypercores of `log`.
- `storeState`: Function of the form `function (state, cb)`. Called by the
  indexer when there is a new indexing state to save. The user can store this
  Buffer object whereever/however they'd like.
- `fetchState`: Function of the form `function (cb)`. Called by the indexer to
  seed the indexing process when the indexer is created. Expects `cb` to be
  called with `(err, state)`, where `state` is a Buffer that was previously
  given to `opts.storeState`.

The `batch` function expects params `(nodes, next)`. `next` should be called
when you are done processing. Each `node` of `nodes` is of the form

```js
{
  key: 'hex-string-of-hypercore-public-key',
  seq: 14,
  value: <whatever value is in the hypercore at this feed + sequence number>
}
```

Optional `opts` include:

- `version`: the version of the index. If increased, any indexes built with an
  earlier version will be purged and rebuilt. This is useful for when you
  change the data format of the index and want all peers to rebuild to use this
  format. Defaults to `1`.
- `maxBatch`: maximum batch size of nodes to process in one `batch` call.
  Defaults to `50`.
- `clearIndex`: Function of the form `function (cb)`. Called by the indexer
  when a new version for the index has been passed in (via `opts.version`) and
  the index needs to be cleared & regenerated.

### index.ready(cb)

Registers the callback `cb()` to fire when the indexes have "caught up" to the
latest known change. The `cb()` function fires exactly once. You may call
`index.ready()` multiple times with different functions.

### index.pause([cb])

Pauses the indexing process. Whatever batches of entries are currently being
processed will finish first. If a callback `cb` is given, it will be called
once pending entries are processed and the indexer is fully paused.

### index.resume()

Synchronously restarts a paused indexer.

### index.on('indexed', function (nodes) {})

Event emitted when entries have finished being indexed.

### index.on('error', function (err) {})

Event emitted when an error within multifeed-index has occurred. This is very
important to listen on, lest things suddenly seem to break and it's not
immediately clear why.

## Install

```
$ npm install multifeed-index
```

## See Also
- [hyperlog-index](https://github.com/substack/hyperlog-index)
- [hyperdb-index](https://github.com/noffle/hyperdb-index)

## License

ISC

[multifeed]: https://github.com/noffle/multifeed

