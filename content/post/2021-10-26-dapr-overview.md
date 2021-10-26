---
title: Dapr 基本介绍
date: 2021-10-26T19:22:58+08:00
cover: /dapr.jpeg
description: Introduction to the Distributed Application Runtime.
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

## Dapr 是什么?

dapr 是 **`Distributed Application Runtime`** 的缩写, 翻译一下就是分布式运行时.

官方文档中的定义是:

- Dapr is a portable, event-driven runtime that makes it easy for any developer to build resilient, stateless and stateful applications that run on the cloud and edge and embraces the diversity of languages and developer frameworks.

- Dapr 是一个可移植的、事件驱动的运行时，使任何开发者都能轻松地建立在云和边缘运行的有弹性、无状态和有状态的应用程序，并拥抱语言和开发者框架的多样性。

## 微服务带来的问题

虽然现在已经是后微服务时代了, 但还是应用很广泛的一种服务设计模式.

微服务虽然让服务职责更加单一, 并且可以摆脱单一语言框架限制, 但是它也带来了很多服务治理问题. 例如:

1. 可观测性变得非常复杂
2. 中心化日志收集
3. 需要服务发现
4. 调用链路变长, 需要一些容错机制, 例如: 重试
5. 服务间权限管理
6. 海量服务部署

要成为分布式专家是很困难的事情, 而且开发者应该花更多的精力在业务逻辑上, 而不是分布式问题.

不用语言微服务相关基础库功能参差不齐, 维护多种语言相关基础库是很难的事情.

## Sidecar 模式

dapr 作为 sidecar 的方式运行在用户应用旁边, 并且对外暴露 HTTP/gRPC 类型的 API , 这样用户应用不需要引用任何 dapr runtime 代码就可以和 dapr 交互.

dapr 相当于用 Go 语言做了个轻量级的, 包含分布式常用功能的 sdk, 通过 sidecar 的方式和用户 app 交互.

## 功能模块

### 1. **Service-to-service invocation**

弹性分布式服务间调用, 支持服务发现, 重试.

### 2. **State management**

提供高可用的键值存储服务, 支持各种存储服务.

### 3. **Publish and subscribe**

发布订阅.

### 4. **Resource bindings**

Dapr 的 Bindings 是建立在事件驱动架构的基础之上的。通过建立触发器与资源的绑定，可以从任何外部源（例如数据库，队列，文件系统等）接收和发送事件，而无需借助消息队列，即可实现灵活的业务场景。

### 5. **Actors**

Actor 模型 = 状态 + 行为 + 消息。一个应用/服务由多个 Actor 组成，每个 Actor 都是一个独立的运行单元，拥有隔离的运行空间，在隔离的空间内，其有独立的状态和行为，不被外界干预，Actor 之间通过消息进行交互，而同一时刻，每个 Actor 只能被单个线程执行，这样既有效避免了数据共享和并发问题，又确保了应用的伸缩性。 Dapr 在 Actor 模式中提供了很多功能，包括并发，状态管理，用于 actor 激活/停用的生命周期管理，以及唤醒 actor 的计时器和提醒器。

### 6. **Observability**

独立的状态管理，使用键/值对作为存储机制，可以轻松的使长时运行、高可用的有状态服务和无状态服务共同运行在您的应用程序中。 状态存储是可插拔的，目前支持使用 Azure CosmosDB、 Azure SQL Server、 PostgreSQL,、AWS DynamoDB、Redis 作为状态存储介质。

### 7. **Secrets**

Dapr 提供了密钥管理，支持与公有云和本地的 Secret 存储集成，以供应用检索使用。

## **Dapr 和服务网格**

![dapr_vs_service_mesh](/dapr_vs_service_mesh.png)

Dapr 虽然和服务网格功能有重叠, 但是 dapr **不是**服务网格. 与专注于网络问题的服务网格不同，Dapr 专注于提供构建基块, 使开发人员更容易将应用程序构建为微服务. Dapr 以开发人员为中心, 而服务网格以基础设施为中心.

Dapr 与服务网格都有的一些常见功能包括:

- 基于 mTLS 加密的服务到服务安全通信
- 服务到服务的度量指标收集
- 服务到服务分布式跟踪
- 故障重试恢复能力

服务网格在网络层面上运行, 并跟踪服务之间的网络调用. dapr 更偏向于应用层, 所以它不但可以追踪服务间的网络调用, 甚至发布订阅这类消息都可以追踪.

而且 dapr 抽象出了很多通用的应用层服务.

## 参考资料

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
