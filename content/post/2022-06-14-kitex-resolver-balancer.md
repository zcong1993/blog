---
title: Kitex 服务发现与负载均衡
date: 2022-06-14T18:28:01+08:00
cover: /cover.jpeg
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
