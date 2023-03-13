---
title: Ristretto 高性能 go 语言缓存
date: 2022-03-19T19:03:50+08:00
cover: /ristretto.jpeg
description: 'Ristretto: A high performance memory-bound Go cache.'
categories:
  - Golang
  - Cache
  - SystemDesign
tags:
  - Golang
  - Cache
  - SystemDesign
keywords:
  - Golang
  - Cache
  - SystemDesign
draft: false
---

[dgraph-io/ristretto](https://github.com/dgraph-io/ristretto) 是一个高性能, 可限制内存的局部缓存.

**注意:** 本文基于 ristretto 最初版本 [v0.0.1](https://github.com/dgraph-io/ristretto/tree/v0.0.1).

## 特色

- store 分片, 缩小锁粒度
- batch 操作, sync.Pool + ring buffer 允许数据丢失
- 允许写失败, buffer channel 满时直接丢弃
- TinyLFU 准入控制, sampleLFU 淘汰控制
- 将 key hash 值也存起来, 减少重复计算

## 细节分析

### batch 操作, sync.Pool + ring buffer 允许数据丢失

[https://github.com/zcong1993/ristretto/blob/learn/ring.go](https://github.com/zcong1993/ristretto/blob/learn/ring.go)

LFU cache 每次操作都要维护 key 的 freq 值, 而且一般来说这个组件和 cache 一样是共享的, 会带来很多锁竞争.

#### 1. 引入 ring buffer 做批操作 (并发不安全)

```go
// Push appends an item in the ring buffer and drains (copies items and
// sends to Consumer) if full.
func (s *ringStripe) Push(item uint64) {
  s.data = append(s.data, item)
  // if we should drain
  if len(s.data) >= s.capa {
    // Send elements to consumer. Create a new one.
    if s.cons.Push(s.data) {
      s.data = make([]uint64, 0, s.capa)
    } else {
      s.data = s.data[:0]
    }
  }
}
```

批操作, 当数据量达到 capa 时, 发给 consumer, 这里处理很激进, 如果 consumer 返回 false (阻塞), 会直接丢弃数据.

#### 2. sync.Pool 无锁包裹, 保存临时数据

```go
// ringBuffer stores multiple buffers (stripes) and distributes Pushed items
// between them to lower contention.
//
// This implements the "batching" process described in the BP-Wrapper paper
// (section III part A).
type ringBuffer struct {
  pool *sync.Pool
}
// newRingBuffer returns a striped ring buffer. The Consumer in ringConfig will
// be called when individual stripes are full and need to drain their elements.
func newRingBuffer(cons ringConsumer, capa int64) *ringBuffer {
  // LOSSY buffers use a very simple sync.Pool for concurrently reusing
  // stripes. We do lose some stripes due to GC (unheld items in sync.Pool
  // are cleared), but the performance gains generally outweigh the small
  // percentage of elements lost. The performance primarily comes from
  // low-level runtime functions used in the standard library that aren't
  // available to us (such as runtime_procPin()).
  return &ringBuffer{
    pool: &sync.Pool{
      New: func() interface{} { return newRingStripe(cons, capa) },
    },
  }
}
// Push adds an element to one of the internal stripes and possibly drains if
// the stripe becomes full.
func (b *ringBuffer) Push(item uint64) {
  // reuse or create a new stripe
  stripe := b.pool.Get().(*ringStripe)
  stripe.Push(item)
  b.pool.Put(stripe)
}
```

`sync.Pool.Get()` 操作可以并发, 如果有可用对象直接返回, 如果没有会调用 `New` 方法创建新的. sync.Pool 里面的对象是临时对象, 2 个 gc 周期会被回收, 所以这里也会丢数据. `RingStripe` 实例化对象保存在 pool 中, push 的 item 也会临时保存, 如果 item 数量没达到该 RingStripe 的 capa, 并且过了两个 gc 周期, 会丢失此对象的 items (对象被回收了).

### key hash

string 和 []byte 使用 go 语言用的 memhash, 性能很高

```go
// TODO: Figure out a way to re-use memhash for the second uint64 hash, we
//       already know that appending bytes isn't reliable for generating a
//       second hash (see Ristretto PR #88).
//
//       We also know that while the Go runtime has a runtime memhash128
//       function, it's not possible to use it to generate [2]uint64 or
//       anything resembling a 128bit hash, even though that's exactly what
//       we need in this situation.
func KeyToHash(key interface{}) (uint64, uint64) {
  if key == nil {
    return 0, 0
  }
  switch k := key.(type) {
  case uint64:
    return k, 0
  case string:
    raw := []byte(k)
    return MemHash(raw), xxhash.Sum64(raw)
  case []byte:
    return MemHash(k), xxhash.Sum64(k)
  case byte:
    return uint64(k), 0
  case int:
    return uint64(k), 0
  case int32:
    return uint64(k), 0
  case uint32:
    return uint64(k), 0
  case int64:
    return uint64(k), 0
  default:
    panic("Key type not supported")
  }
}
```

### store 分片, 缩小锁粒度

store 实现比较简单, 组合锁和标准 map. 为了减少锁粒度提高性能做了分片.

```go
type lockedMap struct {
  sync.RWMutex
  data map[uint64]storeItem
}

const numShards uint64 = 256

type shardedMap struct {
  shards []*lockedMap
}

func newShardedMap() *shardedMap {
  sm := &shardedMap{
    shards: make([]*lockedMap, int(numShards)),
  }
  for i := range sm.shards {
    sm.shards[i] = newLockedMap()
  }
  return sm
}

func (sm *shardedMap) Get(key, conflict uint64) (interface{}, bool) {
  return sm.shards[key%numShards].Get(key, conflict)
}

func (sm *shardedMap) Set(key, conflict uint64, value interface{}) {
  sm.shards[key%numShards].Set(key, conflict, value)
}
```

### 允许写失败, buffer channel 满时直接丢弃

```go
func (c *Cache) Set(key, value interface{}, cost int64) bool {
  if c == nil || key == nil {
    return false
  }
  keyHash, conflictHash := c.keyToHash(key)
  i := &item{
    flag:     itemNew,
    key:      keyHash,
    conflict: conflictHash,
    value:    value,
    cost:     cost,
  }
  // attempt to immediately update hashmap value and set flag to update so the
  // cost is eventually updated
  if c.store.Update(keyHash, conflictHash, i.value) {
    i.flag = itemUpdate
  }
  // attempt to send item to policy
  select {
  case c.setBuf <- i:
    return true
  default:
    c.Metrics.add(dropSets, keyHash, 1)
    return false
  }
}
```

值得注意的是 Set 方法包含 create 和 update, update 操作是不能丢弃和延迟的(不然会读到脏缓存), 所以会先尝试做 update 操作.

这里 channel 操作相当于异步写, 会出现 Set 之后 Get 可能会拿不到缓存, 但是这都是为了尽可能提高 Set 性能.

### TinyLFU 准入控制

TinyLFU 基于此 [论文](https://dgraph.io/blog/refs/TinyLFU%20-%20A%20Highly%20Efficient%20Cache%20Admission%20Policy.pdf), 优化了内存使用.

对外提供三个方法:

- Increment(key uint64) // 增加 freq
- Estimate(key uint64) int (referred as ɛ) // 获取
- Reset // 重置

准入控制要保证进入元素的 ɛ 大于淘汰的元素, 否则不允许进入. 简单来说, ristretto 永远会优先缓存 **更有价值** 的数据.

Increment 会在 Get 调用是通过 sync.Pool + ring buffer batch 更新.

Estimate 会在存储空间达到阈值时, 会随机获取 5 个旧元素, 如果新元素 ɛ 小于所有选取的旧元素, 直接拒绝, 不允许进入缓存. 否则淘汰掉 ɛ 最小的元素, 再随机补充一个旧元素, 重复操作直到空间充足.

```go
// Snippet from the Admission and Eviction Algorithm
incHits := p.admit.Estimate(key)
for ; room < 0; room = p.evict.roomLeft(cost) {
    sample = p.evict.fillSample(sample)
    minKey, minHits, minId := uint64(0), int64(math.MaxInt64), 0
    for i, pair := range sample {
        if hits := p.admit.Estimate(pair.key); hits < minHits {
            minKey, minHits, minId = pair.key, hits, i
        }
    }
    if incHits < minHits {
        p.stats.Add(rejectSets, key, 1)
        return victims, false
    }
    p.evict.del(minKey)
    sample[minId] = sample[len(sample)-1]
    sample = sample[:len(sample)-1]
    victims = append(victims, minKey)
}
```

还有一点要注意, 如果只用上面的处理方式, 老的元素 ɛ 值会一直增加, 新元素没有机会进入, 为了解决这个问题 在调用 n 次 Increment 方法时会调用 Reset 方法将 TinyLFU 重置.

其他优化点: 为了防止大量只出现一次的 key 使得 TinyLFU 里面数据量过大, 引入布隆过滤器, 只允许 Increment 过滤器中存在的 key, 所以会忽略掉第一次进来的 key. 调用 Estimate 时如果过滤器存在该 key ɛ 值会再额外 +1.

### sampleLFU 淘汰控制

淘汰控制是在空间不足时执行, 参考上面代码片段.

`fillSample` 操作使用的是 go 语言 map 随机访问特性.

```go
type sampledLFU struct {
  keyCosts map[uint64]int64
  maxCost  int64
  used     int64
  metrics  *Metrics
}

func (p *sampledLFU) fillSample(in []*policyPair) []*policyPair {
  if len(in) >= lfuSample {
    return in
  }
  for key, cost := range p.keyCosts {
    in = append(in, &policyPair{key, cost})
    if len(in) >= lfuSample {
      return in
    }
  }
  return in
}
```

## 总结

提升吞吐方面, 从设计上支持数据丢弃, set 操作不确保成功, get 操作更新 freq 也做了批操作, 并且容忍丢失. 提升命中方面 TinyLFU 在准入时只允许 rank 分更高也就是更有价值的元素进入, 淘汰也是优先淘汰 rank 值低的, 永远尝试保留更有价值的数据.

## 参考资料

- [https://dgraph.io/blog/post/introducing-ristretto-high-perf-go-cache](https://dgraph.io/blog/post/introducing-ristretto-high-perf-go-cache)
- [https://github.com/dgraph-io/ristretto](https://github.com/dgraph-io/ristretto)

![wxmp](/wxmp_tiny_1.png)
