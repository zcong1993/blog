---
title: Kitex 服务发现与负载均衡
date: 2022-06-16T21:28:01+08:00
cover: /kitex-resolver-balancer.jpeg
description: 本文分析 Kitex 服务发现与负载均衡实现原理.
categories:
  - Kitex
  - RPC
  - Golang
tags:
  - Kitex
  - RPC
  - Golang
keywords:
  - Kitex
  - RPC
  - Golang
draft: true
---

Kitex 是字节开源的高性能, 强可扩展 的 Golang 微服务 RPC 框架. 之前写过 [gRPC-go 的服务发现和负载均衡源码分析](/post/2021-03-06-grpc-go-discovery-lb), 本文分析下 Kitex 源码, 对比下两者的差异.

<!--more-->

先说结论: 两者模块拆分都是 `Resolver` 和 `Balancer`, 但是 kitex 的实现比较直接, 比 gRPC 简单很多. 例如: kitex 没有维护 subConn 的状态.

_注意:_ 本文源码基于 `0.3.1` 版本. 并且使用多路复用的连接形式(对标 gRPC).

## 服务发现

kitex 的服务发现扩展方式和 gRPC 基本一样, 都是通过实现 `Resolver` 接口. `Resolver` 的职责也是将 serviceName 转化成真正的连接地址. 首先看接口定义:

```go
// pkg/discovery/discovery.go
// Resolver resolves the target endpoint into a list of Instance.
type Resolver interface {
  // Target should return a description for the given target that is suitable for being a key for cache.
  Target(ctx context.Context, target rpcinfo.EndpointInfo) (description string)

  // Resolve returns a list of instances for the given description of a target.
  Resolve(ctx context.Context, desc string) (Result, error)

  // Diff computes the difference between two results.
  // When `next` is cacheable, the Change should be cacheable, too. And the `Result` field's CacheKey in
  // the return value should be set with the given cacheKey.
  Diff(cacheKey string, prev, next Result) (Change, bool)

  // Name returns the name of the resolver.
  Name() string
}

type Result struct {
  Cacheable bool
  CacheKey  string
  Instances []Instance
}

type Instance interface {
  Address() net.Addr
  Weight() int
  Tag(key string) (value string, exist bool)
}
```

核心接口只有 `Resolve` 一个, `Target` 和 `Diff` 是缓存优化相关, 后续再单独介绍.

`Resolve` 的签名很直接: 将给定 `desc` 名称解析成地址列表 `Result`. 可以看出调用方会以 `pull` 的形式拉取最新结果而不是 gRPC 那样通过 callback 的形式需要 resolver 通知变化.

由于 `Resolve` 扩展过于简单, 只是单纯做同步翻译查询工作, 所以这里不做介绍.

## 负载均衡

kitex 的负载均衡扩展方式和 gRPC 基本一样, 是通过实现 `Loadbalancer` 接口. 它的职责也是在每个 rpc 调用之前选择一个连接返回. 首先查看接口定义:

```go
// Loadbalancer generates pickers for the given service discovery result.
type Loadbalancer interface {
  GetPicker(discovery.Result) Picker
  Name() string // unique key
}

// Picker picks an instance for next RPC call.
type Picker interface {
  Next(ctx context.Context, request interface{}) discovery.Instance
}
```

可以看出实现也是非常直接, `discovery.Result` 是调用 `Resolver.Resolve` 的结果, 所以我们可以简单组合下两者写出一个伪代码:

```go
func resolverBalancerMW(ctx context.Context, req, res interface{}) error {
  // 1. 获取目标地址
  destService := getDestService(ctx)
  // 2. 通过 resolver 拿到地址列表
  discoveryResult, _ := resolver.Resolve(ctx, destService)
  // 3. get picker
  picker := loadbalancer.GetPicker(discoveryResult)
  // 4. pick
  instance := picker.Next(ctx, req)
  // ... use instance handle rpc
}
```

如上面伪代码所示, 这样就能完整走通请求流程, 但是很容易就能看出一下几点问题:

1. 这种实现**有极大的性能问题**
2. 如何做到容错(kitex 没有像 grpc 那样维护 readySCs 可用连接暴露给上层)

### 性能问题

解决性能最简单的方式就是**缓存**, 减少不必要的请求和计算. 所以 kitex 维护了 `lbcache` 包来解决性能问题. 根据上面伪代码能够简单看出 2 和 3 两步有昂贵的开销.

对于 `Resolver` 的调用开销问题, kitex 使用 `libcache.Balancer` 封装实现**轮询加缓存**的形式:

```go
type Balancer struct {
  b            *BalancerFactory
  target       string
  res          atomic.Value // 将最近一次 resolve 成功的 result 缓存
  expire       int32        // 单例缓存 balancer, 一定时间不使用会在 BalancerFactory cache 中删除当前实例
  sharedTicker *sharedTicker // 定时调用 resolve 的共享 ticker
}

// 此时的 GetPicker 的参数 discovery.Result 是直接拿的缓存结果
func (bl *Balancer) GetPicker() loadbalance.Picker {
  atomic.StoreInt32(&bl.expire, 0)
  res := bl.res.Load().(discovery.Result)
  return bl.b.balancer.GetPicker(res)
}
```

总结一下, 解决 resolver 调用问题用了以下几点优化:

1. BalancerFactory 管理共享 `Balancer` 实例, 并回收不再使用的实例
2. 定时调用 `Resolver.Resolve` 方法并将结果缓存(默认 5s 一次)
3. 定时轮询 `sharedTicker` 也是单例共享的, 同一个 interval 全局只会有一个 `time.Ticker`

对于 `GetPicker` 这里不同的负载均衡策略需要根据当前的地址列表初始化自己的数据结构, 例如: `WeightedRandom` 需要计算加权的随机列表, 而 `ConsistentHash` 需要计算一致性哈希的虚实 node 列表. 本质上这些初始化函数都是**纯函数**, 也就是对于**给定地址列表**, 计算出的数据结构也是**确定的**, 因此我们仅需要在**地址列表改变时**重新计算. gRPC 会在地址列表改变时用最新的地址信息作为参数调用 `balancer.Build` 方法. 由于 kitex 是 pull 的形式感知地址变化, 所以还是通过 cache 的方式实现优化.

为了能够让用户控制是否使用缓存, `resolver.Result` 中增加了 `Cacheable` 来控制, 当它值为 `true` 时才会进行缓存.

以 `WeightedRandom` 负载均衡实现为例:

```go
// GetPicker implements the Loadbalancer interface.
func (wb *weightedBalancer) GetPicker(e discovery.Result) Picker {
  var w *weightInfo
  // 如果支持缓存则尝试进行缓存
  if e.Cacheable {
    // 从缓存中尝试取值
    wi, ok := wb.cachedWeightInfo.Load(e.CacheKey)
    if !ok {
      // 没有值则初始化, 用 singleflight 防止并发重复计算
      wi, _, _ = wb.sfg.Do(e.CacheKey, func() (interface{}, error) {
        return wb.calcWeightInfo(e), nil
      })
      // 存入缓存
      wb.cachedWeightInfo.Store(e.CacheKey, wi)
    }
    w = wi.(*weightInfo)
  } else {
    w = wb.calcWeightInfo(e)
  }

  if w.weightSum == 0 {
    return new(DummyPicker)
  }

  // 优化操作, 如果所有 instance 权重一样, 直接退化到随机
  // 不进行权重计算
  if w.balance {
    picker := randomPickerPool.Get().(*randomPicker)
    picker.immutableInstances = w.instances
    picker.firstIndex = -1
    return picker
  }
  picker := weightedPickerPool.Get().(*weightedPicker)
  picker.immutableEntries = w.entries
  picker.weightSum = w.weightSum
  picker.immutableInstances = w.instances
  picker.firstIndex = -1
  return picker
}
```

上面的代码可以看出一个问题, 就是假如支持缓存, 实例列表永远取得是第一次计算的值, 后续都是直接拿的缓存中的结果. `Balancer` 层面需要感知到地址列表变化, 并更新缓存. 所以 kitex 使用通知回调的方式实现变化通知, 在 `Balancer` 层面上要求支持缓存的负载均衡器需要实现 `Rebalancer` 接口:

```go
type Rebalancer interface {
  // 地址列表发生变化时, 会调用此函数
  Rebalance(discovery.Change)
  // close 时通知
  Delete(discovery.Change)
}
```

所以 `WeightedRandom` 实现了此接口:

```go
// Rebalance implements the Rebalancer interface.
func (wb *weightedBalancer) Rebalance(change discovery.Change) {
  if !change.Result.Cacheable {
    return
  }
  // 感知到地址列表变化时, 重新计算并更新缓存
  wb.cachedWeightInfo.Store(change.Result.CacheKey, wb.calcWeightInfo(change.Result))
}

// Delete implements the Rebalancer interface.
func (wb *weightedBalancer) Delete(change discovery.Change) {
  if !change.Result.Cacheable {
    return
  }
  wb.cachedWeightInfo.Delete(change.Result.CacheKey)
}
```

那么这个变化通知是谁发出来的呢? 前面提到过 `Balancer` 是轮询的方式调用 `Resolve` 方法的, 所以它是能够感知到有没有变化的.

```go
func (bl *Balancer) refresh() {
  res, err := bl.b.resolver.Resolve(context.Background(), bl.target)
  if err != nil {
    klog.Warnf("KITEX: resolver refresh failed, key=%s error=%s", bl.target, err.Error())
    return
  }
  renameResultCacheKey(&res, bl.b.resolver.Name())
  prev := bl.res.Load().(discovery.Result)
  // 初始化时会判断 balancer 有没有实现 Rebalancer 接口
  // 有才会给 rebalancer 赋值
  if bl.b.rebalancer != nil {
    // 调用 resolver.Diff 判断是否发生变化
    if ch, ok := bl.b.resolver.Diff(res.CacheKey, prev, res); ok {
      // 变化时回调 Rebalance 通知
      bl.b.rebalancer.Rebalance(ch)
    }
  }
  // replace previous result
  bl.res.Store(res)
}
```

现在回顾 `Resolver` 接口定义, 发现 `Target` 和 `Diff` 两个函数都是为了这里的缓存功能添加的, `Diff` 是为了支持自定义扩展, 一般使用 `DefaultDiff` 就好了.

至此上面提到的性能问题基本解决了.

### 如何容错

我们知道 gRPC 会维护 `subConns` 的状态, 永远只会使用正常的连接构建负载均衡器, 这样就有了一定的容错性, 某个后端节点突然下线或者网络波动只要不是所有节点都不可用的情况下都不会出问题. 但是 kitex 没有维护这个状态, 负载均衡模块也无法感知到这些信息, 怎么做到容错呢? 答案是重试.

对于上面的 `resolverBalancerMW` 伪代码, 真实流程其实是这样的:

```go
func resolverBalancerMW(ctx context.Context, req, res interface{}) error {
  // 1. 获取目标地址
  dest := getDestService(ctx)
  // 2. 从复杂均衡工厂方法里面根据 dest 信息拿到 lb 实例
  // 缓存单例优化性能
  lb, _ := lbf.Get(ctx, dest)
  // 3. get picker
  // resolver 通过轮询调用, 封装在了 GetPicker 方法里
  picker := lb.GetPicker()
  // 4. pick 连接并发起 rpc 调用
  for {
    select {
    case <-ctx.Done():
      return kerrors.ErrRPCTimeout
    default:
    }

    // 从 lb 拿到连接
    ins := picker.Next(ctx, request)
    if ins == nil {
      return kerrors.ErrNoMoreInstance.WithCause(fmt.Errorf("last error: %w", lastErr))
    }
    remote.SetInstance(ins)

    retryable := func(err error) bool {
      return errors.Is(err, kerrors.ErrGetConnection) || errors.Is(err, kerrors.ErrCircuitBreak)
    }

    // 执行中间件链式调用, 在 连接错误 或 熔断错误 发生时重试
    if err = next(ctx, request, response); err != nil && retryable(err) {
      lastErr = err
      continue
    }
    return err
  }
}
```

这里有个细节, 每次 rpc 请求只会调用一次 `GetPicker` 方法, 但是会调用一次或多次 `picker.Next` 方法. 所以 picker 是有状态的, 为了防止运气差重复随机到非正常地址或者所有地址都不正常时重试到超时甚至用户不设置超时时永远重试, picker 会在每次调用 `Next` 方法时, 将当前选择的地址剔除掉, 并且当所有地址都不可用时返回 `nil`, 此时 rpc 会直接抛出 `kerrors.ErrNoMoreInstance` 错误并停止重试. 因此 lb 错误重试终止条件有两种:

1. ctx 超时
2. 所有地址全部尝试了仍未成功

那么对于一致性哈希负载均衡器, 某个请求应当总是被路由到某个确定的节点, 假如这个节点有问题怎么办? 试想一下, 对于 gRPC 而言, 连接状态发生变化会触发重新构建一致性哈希节点, 会剔除掉不健康节点, 所以就和增减节点一样, 一定比例的请求会自动发生漂移.

但是对于 kitex 而言, 某个连接错误并不会触发重新构建节点, 重试也仍然会选择此节点. 所以 kitex 默认此种情况下直接会直接报错. 可是在生产中很多时候这种处理方式是不能接受的, 因此 kitex 在一致性哈希复杂均衡里面引入了 `Replica` 参数, 此参数的意思是为每一个节点都额外选取 n 个节点作为备用节点, 在主节点不可用时, 会使用该节点的备用节点重试.

## 总结

通过分析和对比 kitex 和 gRPC 可以看出来, 两者对于同样的问题采用两种完全不同的解决方案. 也可以看出来技术永远是权衡, 复杂抽象和简单抽象各有优缺点.

对于学习和思考上面要循序渐进, 先抓住主要矛盾和核心问题, 再逐步思考优化演进. 不然就会在细枝末节上面浪费太多时间.

kitex 代码也有很多地方可以学习, 比如: sync.Pool 优化, 单例优化, singleflight, sharedTicker, 还有缓存回收等等.

## 参考资料

- [https://www.cloudwego.io/docs/kitexe](https://www.cloudwego.io/docs/kitex)
- [https://github.com/cloudwego/kitex](https://github.com/cloudwego/kitex)
- [https://github.com/grpc/grpc/blob/master/doc/load-balancing.md](https://github.com/grpc/grpc/blob/master/doc/load-balancing.md)
