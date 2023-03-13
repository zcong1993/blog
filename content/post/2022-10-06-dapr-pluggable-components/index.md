---
title: Dapr 源码解析 | Pluggable Components
date: 2022-10-06T17:40:39+08:00
cover: /dapr-pluggable-components-cover.png
description: 本文介绍 Dapr 1.9 Pluggable Components 相关源码.
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
js:
  - js/prism-protobuf.min.js
---

对于 Dapr 这种基础组件, 可扩展性是非常重要的一个特性. Dapr 最主要的特性和目标就是为用户提供不同场景下的标准化 API 屏蔽依赖中间件底层, 从而降低用户开发成本增加增强软件可移植性. 所以 Dapr 底层中间件支持越多也就意味着适用的范围越广. 本文来分析 Dapr 即将发布的 1.9 版本的新特性 -- `Pluggable Components`, 这是一个用户扩展 component 的完整解决方案.

<!--more-->

### 现状

再次说明下 Dapr 目前 component 模块的组织形式, 以 state store 为例:

![dapr-components](/dapr-components.png)

dapr 将对应场景下对于底层中间件的能力依赖抽象成为一个 interface(go 语言层面), 然后通过实现接口的方式实现对于不同底层中间件的适配, 最终由 dapr runtime 根据用户配置选择对应适配器并加载. 所以适配器代码也是放在 dapr 代码仓库中的, 由于需要根据社区用户需求来适配越来越多的中间件, dapr 将此部分代码单独放在了 [https://github.com/dapr/components-contrib](https://github.com/dapr/components-contrib) 仓库中, 因此如果我们有特殊需求需要改动适配器代码或者需要对公司闭源组件做适配是需要 fork 代码的. 这种扩展方式显然是不太能接受的.

因此, dapr 1.9 增加了 `Pluggable Components` 扩展方式.

### Pluggable Components

以 state store 为例, 看看新模块是如何解决扩展问题的:

![dapr-pluggable-components](/dapr-pluggable-components.png)

相当于 dapr 重新抽象出了一层需要依赖的底层中间件能力的接口(proto), dapr runtime 通过与用户写的可插拔服务间接与底层中间件交互.

我们描述下 Pluggable Components 是什么.

1. 是由用户开发的独立程序(grpc server)
2. 和 dapr runtime 独立部署, 属于不同进程(容器)
3. dapr runtime 和可插拔组件通过 grpc 交互

因此如果我们想要自己扩展一个可插拔组件, 则需要实现一个对用的 grpc server.

```protobuf
// StateStore service provides a gRPC interface for state store components.
service StateStore {
  // Initializes the state store component with the given metadata.
  rpc Init(InitRequest) returns (InitResponse) {}

  // Returns a list of implemented state store features.
  rpc Features(FeaturesRequest) returns (FeaturesResponse) {}

  // Deletes the specified key from the state store.
  rpc Delete(DeleteRequest) returns (DeleteResponse) {}

  // Get data from the given key.
  rpc Get(GetRequest) returns (GetResponse) {}

  // Sets the value of the specified key.
  rpc Set(SetRequest) returns (SetResponse) {}

  // Ping the state store. Used for liveness porpuses.
  rpc Ping(PingRequest) returns (PingResponse) {}

  // Deletes many keys at once.
  rpc BulkDelete(BulkDeleteRequest) returns (BulkDeleteResponse) {}

  // Retrieves many keys at once.
  rpc BulkGet(BulkGetRequest) returns (BulkGetResponse) {}

  // Set the value of many keys at once.
  rpc BulkSet(BulkSetRequest) returns (BulkSetResponse) {}
}
```

对比标准的 state store 组件, 可以看到基本一致, 只是多了个 `Ping` 方法. 而 dapr runtime 也会通过实现一个适配器将此类组件 grpc client 转化成标准组件, 所以 Ping 方法就是探测可插拔组件是否存活的.

dapr 目前只有 `state store` 和 `pub sub` 两个模块支持可插拔组件. 相关 proto 文件声明在 [dapr/proto/components/v1](https://github.com/dapr/dapr/tree/master/dapr/proto/components/v1), 相关适配器文件在 [pkg/components/state/pluggable.go](https://github.com/dapr/dapr/blob/master/pkg/components/state/pluggable.go) 和 [pkg/components/pubsub/pluggable.go](https://github.com/dapr/dapr/blob/master/pkg/components/pubsub/pluggable.go).

由于不直接与中间件交互, 所以可插拔组件需要实现的接口和标准组件接口是有差异的, 以 pubsub 为例:

```protobuf
service PubSub {
  rpc Init(PubSubInitRequest) returns (PubSubInitResponse) {}
  rpc Features(FeaturesRequest) returns (FeaturesResponse) {}
  rpc Publish(PublishRequest) returns (PublishResponse) {}
  rpc PullMessages(stream PullMessagesRequest)
      returns (stream PullMessagesResponse) {}
  rpc Ping(PingRequest) returns (PingResponse) {}
}
```

可以看到 `Publish` 只是单纯将标准组件方法翻译成 proto, 而 `Subscribe` 方法变成了更复杂的 `PullMessages` 方法, 因为标准组件直接在代码实现层屏蔽了差异化, 因此消息 ack 是由标准组件代码根据底层中间件类型来决定是否实现, 然而对于可插拔组件, 就必须永远将 ack 信息发送给可插拔组件服务, 因此 `PullMessagesRequest` 的另一个作用就是发送 ack 信息.

### 可插拔组件自动发现

上面我们知道 dapr runtime 会通过适配器将可插拔组件 grpc client 封装成标准组件, 所以和可插拔组件交互时需要知道服务地址和服务组件类型.

由于可插拔组件是标准的 grpc 服务, 一个服务可以实现多个 proto 定义的 service, 如果让用户手动配置会显得非常繁琐, 并且可能出现和实现不一致的情况, 因此 dapr 要求可插拔组件 grpc 开启 reflection. dapr runtime 通过 grpc reflection 的方式感知服务类型.

对于可插拔组件服务地址, 上文说到通过 unix socket 的方式建立连接, 所以这个文件描述符需要通过共享存储的方式被 dapr runtime 访问到, 因此 dapr 会约定一个文件夹(可通过配置修改)并尝试加载此文件夹下所有 socket 文件, 由于 dapr 有两种运行模式, standalone 模式下需要用户手动维护, 而 kubernetes 模式下由于 dapr runtime 是以 sidecar 的模式运行, 所以可插拔组件服务也需要通过 sidecar 模式运行, 并和 dapr runtime 共享 volume(该模式最终会在 dapr operator 中实现, 目前暂未实现).

相关代码可查看 [pkg/components/pluggable/discovery.go](https://github.com/dapr/dapr/blob/master/pkg/components/pluggable/discovery.go).

## 总结

可以看到 dapr 引入的可插拔组件扩展方式有以下一些优点:

1. 支持多种语言扩展, 理论上所有 grpc 支持的语言都可以
2. 独立于 dapr runtime, 插件问题不会导致核心 runtime 崩溃
3. 不需要 fork dapr 代码
4. 不会因为 dapr 代码适配组件越来越多导致二进制文件越来越臃肿, 虽然大多时候用户根本不需要那么多中间件实现

目前的方案实现我个人觉得比较简单优雅, 但是如果从最开始关注这个问题, 就会看到这个功能在社区还是经过了很长时间的公开讨论, 并且对比调研了多个方案, 直观感受这个过程还是能够学到很多东西的.
感兴趣的可以看看这两个 issue [https://github.com/dapr/dapr/issues/3787](https://github.com/dapr/dapr/issues/3787) 和 [https://github.com/dapr/dapr/issues/4925](https://github.com/dapr/dapr/issues/4925).

## **参考资料**

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
