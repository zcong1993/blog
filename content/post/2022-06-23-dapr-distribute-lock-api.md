---
title: Dapr 源码解析 | Distribute Lock
date: 2022-06-23T20:03:25+08:00
cover: /dapr-distribute-lock.png
description: 本文介绍 Dapr Distribute Lock Api 相关源码.
categories:
  - Golang
  - Dapr
  - Cloud Native
tags:
  - Golang
  - Dapr
  - Cloud Native
keywords:
  - Golang
  - Dapr
  - Cloud Native
draft: false
---

Dapr 1.18 版本即将发布, 本文介绍 1.18 版本新功能 `Distribute Lock Api` 分布式锁功能.

<!--more-->

分布式锁这个问题会被很多人觉得非常简单, 而且经常出现在各种后端面试当中. 之所以写这篇文章是因为这个功能迭代和问题思考方式值得学习, 很多开发者在设计系统时喜欢 "炫技", 会在初期引入很多组件, 考虑各种各样的极端场景, 质疑你 "考虑不周" 的地方, 殊不知克制和权衡才是好的设计难的地方.

## 背景

开发者往往需要分布式锁来保证资源状态在竞态条件下不会出错, 但是正确实现分布式锁是有挑战的, 会对开发者有额外的心智负担. 因此提供一个简单的 API 和 Dapr 的理念是相符的.

## API 设计

通用性的 API 永远需要权衡 `泛用性` 和 `易用性` 两个点, 因为不同组件所能提供的基本功能是不同的, 也无法抹平的. 所以对于每个组件提供的功能都可以分为 `core` 和 `feature` 两种, 一般来说我们会将 core 功能抽象成确定的参数类型和响应类型, 但是 feature 往往需要通过 `metadata` 来扩展, 会提高使用成本(动态参数, 隐式不同中间件表现形式可能不同), 并且降低可移植性. 例如: 对于 dapr 状态管理, 存储 key 和 value 就是核心稳定功能, 而设置有效期就是 feature, 所以使用时用户需要考虑自己配置的中间件是否支持此功能, 而且需要使用 `metadata.ttlInSeconds` 传递参数.

对于分布式锁这个功能, 核心功能是提供 lock 和 unlock 功能, 但是 feature 有很多(阻塞锁, 可重入锁, 读写锁, sequencer 等等). 因此, 对于第一版功能应当做的足够简单, 抓住主要矛盾. 后续可以根据真正的用户需求来扩展. 而且对于 dapr 这种大项目, 迭代是要保证兼容性的, 如果一开始设计得很复杂后续需要修改成本会非常高. 最终第一版决定只实现两个核心 API, 甚至没实现续约功能, 并且只实现了 `redis standalone` 模式.

查看 component 定义:

```go
type Store interface {
	// Init this component.
	InitLockStore(metadata Metadata) error

	// TryLock tries to acquire a lock.
	TryLock(req *TryLockRequest) (*TryLockResponse, error)

	// Unlock tries to release a lock.
	Unlock(req *UnlockRequest) (*UnlockResponse, error)
}
```

`InitLockStore` 是初始化模块标准方法, `TryLock` 和 `Unlock` 则是真正对外提供的能力.

## 实现


这两个 API 没啥分析的, 这里简单说明下用 redis 实现分布式锁需要注意的几点:

1. 加锁时 setNX value 值应当有随机性, 释放时可通过 `CAS` 判断是否是 owner
2. 释放时 `CAS` 操作需要以 lua 脚本的形式保证原子操作

分析下参数类型:

```go
type TryLockRequest struct {
	ResourceID      string `json:"resourceId"`
	LockOwner       string `json:"lockOwner"`
	ExpiryInSeconds int32  `json:"expiryInSeconds"`
}
```

`ResourceID` 决定了锁的 key 值, `LockOwner` 就是上面说的随机 value 值, 使用者应当使用随机值, 防止被别的程序释放. 但是真正的 key 会通过 `appId` 进行命名空间隔离.

## 总结

本文的主角源码实现方面没什么信息量, 所以我们就再扯回系统设计这个点.

很多开发者对于系统设计不考虑需求, 总是把高可用之类的挂在嘴边, 你说一句使用 redis 做分布式锁或者队列使用, 他马上能够反驳很多, 甚至质疑你的技术水平, 丝毫不考虑额外中间件引入系统的维护成本, 仿佛 etcd 出现之后大家都不应该使用 redis 做分布式锁服务. 然而对于大多数场景是可以容忍小概率锁丢失的, 甚至都碰不到 redis 不可用, 而引入 etcd 带来的维护和使用成本, 出错用错的概率往往更高. 所以考虑现实场景和权衡组件引入成本和复杂度是非常必要的.

下面引用 `boltDB` 作者在 [Why I Built Litestream](https://litestream.io/blog/why-i-built-litestream) 博客中对于开发者不满足 99.99% uptime 所说的一段话:

> The software industry has chased uptime as a goal in and of itself over the last several decades. Solutions such as Kubernetes tout the benefits of zero-downtime deployments but ignore that their inherent complexity causes availability issues.

简单复述下: 在过去的几十年里, 软件行业一直将正常运行时间作为一个目标来追逐. 像 Kubernetes 这样的解决方案吹嘘零停机部署的好处, 但却忽略了其固有的复杂性会导致可用性问题.

所以不要觉得你引入 etcd 就可以高枕无忧高可用了, etcd 这个复杂组件因为自身或者运维出问题的概率可能比别的场景还要高.

最终再次强调: 考虑现实场景和权衡组件引入成本和复杂度是非常必要的.

## 参考资料

- [https://github.com/dapr/dapr/issues/3549](https://github.com/dapr/dapr/issues/3549)
- [https://github.com/dapr/components-contrib](https://github.com/dapr/components-contrib)
