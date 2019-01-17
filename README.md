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
  Defaults to `1`.
- `clearIndex`: Function of the form `function (cb)`. Called by the indexer
  when a new version for the index has been passed in (via `opts.version`) and
  the index needs to be cleared & regenerated.

### index.ready(cb)

Registers the callback `cb()` to fire when the indexes have "caught up" to the
latest known change. The `cb()` function fires exactly once. You may call
`index.ready()` multiple times with different functions.

### index.on('indexed', function (nodes) {})

Event emitted when entries have finished being indexed.

## Install

```
$ npm install multifeed-index
```

## See Also
- [hyperlog-index](https://github.com/substack/hyperlog-index)
- [hyperdb-index](https://github.com/noffle/hyperdb-index)

## License

ISC
