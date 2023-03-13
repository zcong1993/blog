---
title: Dapr 源码解析 | 项目总览
date: 2021-10-28T17:58:42+08:00
cover: /dapr-project-overview-cover.png
description: Dapr 项目总览, 基本概念, 项目结构介绍.
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

本文源码选用 dapr 1.4.3 [https://github.com/zcong1993/dapr-1/tree/learn-1.4.3](https://github.com/zcong1993/dapr-1/tree/learn-1.4.3)

<!--more-->

## Concepts

![mind](/dapr-overview/mind.png)

总体来看, dapr 可以分为这么几个概念:

### Building blocks 构建块

dapr 向用户提供的 HTTP/gRPC API, 由一个或多个 component 组成.

例如: Secrets 模块对用户提供获取 secrets 的 API.

```markup
# 获取单个 secret
GET http://localhost:<daprPort>/v1.0/secrets/<secret-store-name>/<name>
# 批量获取
GET http://localhost:<daprPort>/v1.0/secrets/<secret-store-name>/bulk
```

### Components 模块

dapr 抽象出来的用于构建块和应用的通用化模块.

例如: Secret Stores 组件对外提供 secret 读取服务.

```go
type SecretStore interface {
  // Init authenticates with the actual secret store and performs other init operation
  Init(metadata Metadata) error

  // GetSecret retrieves a secret using a key and returns a map of decrypted string/string values
  GetSecret(req GetSecretRequest) (GetSecretResponse, error)

  // BulkGetSecrets retrieves all secrets in the store and returns a map of decrypted string/string values
  BulkGetSecret(req BulkGetSecretRequest) (BulkGetSecretResponse, error)
}
```

支持 Kubernetes, Hashicorp Vault, Azure KeyVault 等多种 provider.

### Configuration

组织 dapr 运行需要的各种配置, 主要分为: 全局配置, 模块配置和运行时配置.

### Observability 可观测性

dapr 可观测性模块, 对外提供 logging, metrics, tracing 等指标.

### Security

dapr 安全相关, 例如: 服务间 mTLS 加密.

### Services

dapr 项目对外提供的 cli app. 从项目入口 cmd 文件夹也可以看出:

```bash
cmd
├── daprd // 核心 runtime, 后续源码阅读重点
├── injector // k8s dapr sidecar 注入器
├── operator // k8s operator
├── placement // actor 相关
└── sentry // mTLS  相关
```

## 运行环境

dapr 支持两种运行方式, 分别是: **独立运行**和 **k8s 运行**.

### Self-hosted

此种模式下, daprd 会作为一个 sidecar 进程运行在你的每个 app 旁边, 你的 app 可以通过 HTTP/gRPC 与它交互. 配置文件会存储在本地. 运行时配置需要使用 flag 传递.

![local](/dapr-overview/local.png)

### **Kubernetes**

在 k8s 中, daprd 会做为一个 sidecar 容器运行在你的 app pod 中, 并且这一切都是 `dapr-sidecar-injector` 和 `dapr-operator` 帮你自动完成的. 配置文件也是使用 k8s crd 的形式管理, 运行配置可以通过 k8s annonation 来配置.

![k8s](/dapr-overview/k8s.png)

## 参考资料

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://github.com/dapr/components-contrib](https://github.com/dapr/components-contrib)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
