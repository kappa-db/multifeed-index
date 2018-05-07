# multifeed-index

> Build an index over a set of hypercores.

Traverses a set of hypercores (as a
[multifeed](https://github.com/noffle/multifeed)) and calls a user
indexing function to build an index.

## Example

Let's build a key-value index using this and
[unordered-materialized-kv](https://github.com/substack/unordered-materialized-kv):

```js
var hypercore = require('hypercore')
var multifeed = require('multifeed')
var indexer = require('.')
var umkv = require('unordered-materialized-kv')
var ram = require('random-access-memory')
var memdb = require('memdb')

var multi = multifeed(hypercore, ram, { valueEncoding: 'json' })

var kv = umkv(memdb())

var hyperkv = indexer({
  cores: multi,
  maxBatch: 5,
  batch: function (nodes, feed, seqs, next) {
    var ops = nodes.map(function (node, i) {
      return {
        id: feed.key.toString('hex') + '@' + seqs[i],
        key: node.key,
        links: node.links
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
      hyperkv.ready(function () {
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

- `cores`: a [multifeed](https://github.com/noffle/multifeed) instance
- `batch`: a mapping function, to be called on 1+ nodes at a time in the
  hypercores of `cores`. Expects params `(nodes, feed, seqs, next)`. `next`
  should be called when you are done processing.

Optional `opts` include:

- `maxBatch`: maximum batch size of nodes to process in one `batch` call.
  Defaults to `1`.
- `storeState`: Function of the form `function (state, cb)`. Called by the
  indexer when there is a new indexing state to save. The user can store this
  Buffer object whereever/however they'd like.
- `fetchState`: Function of the form `function (cb)`. Called by the indexer to
  seed the indexing process when the indexer is created. Expects `cb` to be
  called with `(err, state)`, where `state` is a Buffer that was previously
  given to `opts.storeState`.

If neither of the above are given, state is stored in memory.

### index.ready(cb)

Registers the callback `cb()` to fire when the indexes have "caught up" to the
latest known change. The `cb()` function fires exactly once. You may call
`index.ready()` multiple times with different functions.

## Install

```
$ npm install multifeed-index
```

## See Also
- [hyperlog-index](https://github.com/substack/hyperlog-index)
- [hyperdb-index](https://github.com/noffle/hyperdb-index)

## License

ISC
