---
title: gRPC Go 服务发现与负载均衡
date: 2021-03-06T11:08:06+08:00
cover: /grpc-go-discovery-lb.jpg
description: gRPC 是 Google 开源的一款高性能, 支持多种语言的 RPC 框架. 已经被广泛用于集群内服务间调用. 为了大规模流量和避免单点故障, 所以服务往往是部署多实例的, 于是负载均衡就是硬需求了.
categories:
  - gRPC
  - Golang
tags:
  - gRPC
  - Golang
draft: false
---

[gRPC](https://grpc.io) 是 Google 开源的一款高性能, 支持多种语言的 RPC 框架. 已经被广泛用于集群内服务间调用. 为了大规模流量和避免单点故障, 所以服务往往是部署多实例的, 于是负载均衡就是硬需求了.

<!--more-->

_注意:_ 本文所有内容均基于 [grpc/grpc-go](https://github.com/grpc/grpc-go), 不同语言实现会有不同, 后面不在说明.

## 基本介绍

由于 gRPC client 和 server 建立的长连接, 因而基于连接的负载均衡没有太大意义, 所以 gRPC 负载均衡是基于每次调用. 也就是你在同一个 client 发的请求也希望它被负载均衡到所有服务端.

### 客户端负载均衡

一般来说负载均衡器是独立的, 被放置在服务消费者和提供者之间. 代理通常需要保存请求响应副本, 因此有性能消耗也会造成额外延迟. 当请求量大时, lb 可能会变成瓶颈, 并且此时 lb 单点故障会影响整个服务.

gRPC 采取的客户端负载均衡, 大概原理是:

1. 服务端启动时注册地址到注册中心
1. 客户端从注册中心查询目标服务地址列表, 通过某种负载均衡策略选取目标服务, 并发起请求

这种方式是客户端直接请求服务端, 所以没有额外性能开销. 这种模式客户端会和多个服务端建立连接, gRPC 的 client connection 背后其实维护了一组 subConnections, 每个 subConnection 会与一个服务端建立连接. 详情参考文档 [Load Balancing in gRPC](https://github.com/grpc/grpc/blob/master/doc/load-balancing.md).

## 如何使用

根据上面分析, 我们发现使用负载均衡重点其实在于服务发现, 因为服务发现提供了 `server -> addrs` 的映射, 后续的 lb 仅仅是在已有 addrs 列表中根据不同策略选取不同连接发请求而已.

gRPC go client 中负责解析 `server -> addrs` 的模块是 [google.golang.org/grpc/resolver](https://github.com/grpc/grpc-go/tree/61f0b5fa7c1c375e2bbf29f2f5f8610d2b5ba956/resolver) 模块.

client 建立连接时, 会根据 `URI scheme` 选取 resolver 模块中全局注册的对应 resolver, 被选中的 resolver 负责根据 `uri Endpoint` 解析出对应的 `addrs`. 因此我们实现自己服务发现模块就是通过扩展全局注册自定义 `scheme resolver` 实现. 详情参考 [gRPC Name Resolution](https://github.com/grpc/grpc/blob/master/doc/naming.md) 文档.

扩展 resolver 核心就是实现 [resolver.Builder](https://github.com/grpc/grpc-go/blob/61f0b5fa7c1c375e2bbf29f2f5f8610d2b5ba956/resolver/resolver.go#L229) 这个 interface.

```go
// m is a map from scheme to resolver builder.
var	m = make(map[string]Builder)

type Target struct {
	Scheme    string
	Authority string
	Endpoint  string
}

// Builder creates a resolver that will be used to watch name resolution updates.
type Builder interface {
	// Build creates a new resolver for the given target.
	//
	// gRPC dial calls Build synchronously, and fails if the returned error is
	// not nil.
	Build(target Target, cc ClientConn, opts BuildOptions) (Resolver, error)
	// Scheme returns the scheme supported by this resolver.
	// Scheme is defined at https://github.com/grpc/grpc/blob/master/doc/naming.md.
	Scheme() string
}

// State contains the current Resolver state relevant to the ClientConn.
type State struct {
	// Addresses is the latest set of resolved addresses for the target.
	Addresses []Address

	// ServiceConfig contains the result from parsing the latest service
	// config.  If it is nil, it indicates no service config is present or the
	// resolver does not provide service configs.
	ServiceConfig *serviceconfig.ParseResult

	// Attributes contains arbitrary data about the resolver intended for
	// consumption by the load balancing policy.
	Attributes *attributes.Attributes
}

// Resolver watches for the updates on the specified target.
// Updates include address updates and service config updates.
type Resolver interface {
	// ResolveNow will be called by gRPC to try to resolve the target name
	// again. It's just a hint, resolver can ignore this if it's not necessary.
	//
	// It could be called multiple times concurrently.
	ResolveNow(ResolveNowOptions)
	// Close closes the resolver.
	Close()
}
```

gRPC 客户端在建立连接时, 地址解析部分大致会有以下几个步骤:

1. 根据传入地址的 `Scheme` 在全局 resolver map (上面代码中的 m) 中找到与之对应的 resolver (Builder)
1. 将地址解析为 `Target` 作为参数调用 `resolver.Build` 方法实例化出 `Resolver`
1. 使用用户实现 `Resolver` 中调用 `cc.UpdateState` 传入的 `State.Addrs` 中的地址建立连接

例如: 注册一个 test resolver, m 值会变为 `{test: testResolver}`, 当连接地址为 `test:///xxx` 时,
会被匹配到 `testResolver`, 并且地址会解析为 `&Target{Scheme: "test", Authority: "", Endpoint: "xxx"}`, 作为参数调用 `testResolver.Build` 方法.

整理一下:

1. 每个 Scheme 对应一个 Builder
1. 相同 Scheme 每个不同 target 对应一个 Resolver, 通过 builder.Build 实例化

### 静态 resolver 例子

实现一个写死路由表的例子:

```go
// 定义 Scheme 名称
const exampleScheme = "example"

type exampleResolverBuilder struct {
	addrsStore map[string][]string
}

func NewExampleResolverBuilder(addrsStore map[string][]string) *exampleResolverBuilder {
	return &exampleResolverBuilder{addrsStore: addrsStore}
}

func (e *exampleResolverBuilder) Build(target resolver.Target, cc resolver.ClientConn, opts resolver.BuildOptions) (resolver.Resolver, error) {
  // 初始化 resolver, 将 addrsStore 传递进去
	r := &exampleResolver{
		target:     target,
		cc:         cc,
		addrsStore: e.addrsStore,
	}
  // 调用 start 初始化地址
	r.start()
	return r, nil
}
func (e *exampleResolverBuilder) Scheme() string { return exampleScheme }

type exampleResolver struct {
	target     resolver.Target
	cc         resolver.ClientConn
	addrsStore map[string][]string
}

func (r *exampleResolver) start() {
  // 在静态路由表中查询此 Endpoint 对应 addrs
	addrStrs := r.addrsStore[r.target.Endpoint]
	addrs := make([]resolver.Address, len(addrStrs))
	for i, s := range addrStrs {
		addrs[i] = resolver.Address{Addr: s}
	}
  // addrs 列表转化为 state, 调用 cc.UpdateState 更新地址
	r.cc.UpdateState(resolver.State{Addresses: addrs})
}
func (*exampleResolver) ResolveNow(o resolver.ResolveNowOptions) {}
func (*exampleResolver) Close()                                  {}
```

可以这么使用:

```go
// 注册我们的 resolver
resolver.Register(NewExampleResolverBuilder(map[string][]string{
  "test": []string{"localhost:8080", "localhost:8081"},
}))

// 建立对应 scheme 的连接, 并且配置负载均衡
conn, err := grpc.Dial("example:///test", grpc.WithDefaultServiceConfig(`{"loadBalancingPolicy":"round_robin"}`))
```

原理非常简单, `exampleResolver` 只是把从路由表中查到的 `addrs` 更新到底层的 `connection` 中.

### 基于 etcd 的 resolver

etcd 作为服务发现主要原理是:

1. 服务端启动时, 向 etcd 中存一个 key 为 {{serverName}}/{{addr}}, 并且设置一个较短的 Lease
1. 服务端 KeepAlive 定时续约这个 key
1. 客户端启动时拉取 prefix 为 {{serverName}}/ 的所有 key, 得到当前服务列表
1. 客户端 watch prefix 为 {{serverName}}/ 的 key 就能得到服务列表变动事件

接着实现:

#### 1. 服务端注册

```go
func Register(ctx context.Context, client *clientv3.Client, service, self string) error {
	resp, err := client.Grant(ctx, 2)
	if err != nil {
		return errors.Wrap(err, "etcd grant")
	}
	_, err = client.Put(ctx, strings.Join([]string{service, self}, "/"), self, clientv3.WithLease(resp.ID))
	if err != nil {
		return errors.Wrap(err, "etcd put")
	}
	// respCh 需要消耗, 不然会有 warning
	respCh, err := client.KeepAlive(ctx, resp.ID)
	if err != nil {
		return errors.Wrap(err, "etcd keep alive")
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-respCh:

		}
	}
}
```

代码很简单不做过多说明.

#### 2. 客户端

```go
const (
  // etcd resolver 负责的 scheme 类型
	Scheme      = "etcd"
	defaultFreq = time.Minute * 30
)

type Builder struct {
	client *clientv3.Client
  // 全局路由表快照, 非必要
	store  map[string]map[string]struct{}
}

func NewBuilder(client *clientv3.Client) *Builder {
	return &Builder{
		client: client,
		store:  make(map[string]map[string]struct{}),
	}
}

func (b *Builder) Build(target resolver.Target, cc resolver.ClientConn, opts resolver.BuildOptions) (resolver.Resolver, error) {
	b.store[target.Endpoint] = make(map[string]struct{})

  // 初始化 etcd resolver
	r := &etcdResolver{
		client: b.client,
		target: target,
		cc:     cc,
		store:  b.store[target.Endpoint],
		stopCh: make(chan struct{}, 1),
		rn:     make(chan struct{}, 1),
		t:      time.NewTicker(defaultFreq),
	}

  // 开启后台更新 goroutine
	go r.start(context.Background())
  // 全量更新服务地址
	r.ResolveNow(resolver.ResolveNowOptions{})

	return r, nil
}

func (b *Builder) Scheme() string {
	return Scheme
}

type etcdResolver struct {
	client *clientv3.Client
	target resolver.Target
	cc     resolver.ClientConn
	store  map[string]struct{}
	stopCh chan struct{}
	// rn channel is used by ResolveNow() to force an immediate resolution of the target.
	rn chan struct{}
	t  *time.Ticker
}

func (r *etcdResolver) start(ctx context.Context) {
	target := r.target.Endpoint

	w := clientv3.NewWatcher(r.client)
	rch := w.Watch(ctx, target+"/", clientv3.WithPrefix())
	for {
		select {
		case <-r.rn:
			r.resolveNow()
		case <-r.t.C:
			r.ResolveNow(resolver.ResolveNowOptions{})
		case <-r.stopCh:
			w.Close()
			return
		case wresp := <-rch:
			for _, ev := range wresp.Events {
				switch ev.Type {
				case mvccpb.PUT:
					r.store[string(ev.Kv.Value)] = struct{}{}
				case mvccpb.DELETE:
					delete(r.store, strings.Replace(string(ev.Kv.Key), target+"/", "", 1))
				}
			}
			r.updateTargetState()
		}
	}
}

func (r *etcdResolver) resolveNow() {
	target := r.target.Endpoint
	resp, err := r.client.Get(context.Background(), target+"/", clientv3.WithPrefix())
	if err != nil {
		r.cc.ReportError(errors.Wrap(err, "get init endpoints"))
		return
	}

	for _, kv := range resp.Kvs {
		r.store[string(kv.Value)] = struct{}{}
	}

	r.updateTargetState()
}

func (r *etcdResolver) updateTargetState() {
	addrs := make([]resolver.Address, len(r.store))
	i := 0
	for k := range r.store {
		addrs[i] = resolver.Address{Addr: k}
		i++
	}
	r.cc.UpdateState(resolver.State{Addresses: addrs})
}

// 会并发调用, 所以这里防止同时多次全量刷新
func (r *etcdResolver) ResolveNow(o resolver.ResolveNowOptions) {
	select {
	case r.rn <- struct{}{}:
	default:

	}
}

func (r *etcdResolver) Close() {
	r.t.Stop()
	close(r.stopCh)
}
```

上面代码核心在于 `func (r *etcdResolver) start(ctx context.Context)` 这个函数, 他做了下面三件事情:

1. watch etcd 相应的 key prefix, 变更事件发生时, 更新本地缓存, 更新底层连接的 addrs
1. r.rn channel 收到消息时做一次全量刷新, r.rn 消息在 ResolveNow 被调用时产生
1. 全局设了一个 30 分钟全量刷新的兜底方案, 周期到达时, 做一次全量刷新

使用方法和静态路由差不多, 完整代码以及事例可以查看 [zcong1993/grpc-example](https://github.com/zcong1993/grpc-example).

## 负载均衡

说了那么多 resolver, 该说负载均衡了, 就像我们说的 lb 难点在于服务发现, 服务发现实现了之后, 使用内置的 lb 就行了, 只需要简单一个参数: `grpc.WithDefaultServiceConfig(`{"loadBalancingPolicy":"round_robin"}`)`.

以前是可以使用 `grpc.WithBalancerName("round_robin")`, 但是这个方法被废弃了. 我个人认为后者更加清晰, GitHub 上面也有一个 [grpc-go/issues/3003](https://github.com/grpc/grpc-go/issues/3003) 讨论此问题, 感兴趣的可以查看.

## 写在最后

通过学习 gRPC 负载均衡我们可以看到不同类型负载均衡器的优缺点, gRPC 所采用的客户端负载均衡虽然解决了性能问题, 但是也为客户端代码增加了很多复杂度, 虽然我们使用者不太感知得到, 而且文章开头也说明了 gRPC 是支持多种语言的, 也就意味着每种语言客户端都得实现. 然而现状是不同语言的客户端对于一些新特性的实现周期有很大差异, 例如: `c++`, `golang`, `java` 的客户端新特性支持情况会最好, 但是 NodeJS 之类的语言支持情况就不那么好, 这也是长期 gRPC 面临的问题. 例如至今 NodeJS client 库还是 callback 的形式, 并且仍不支持 `server interceptor`.
