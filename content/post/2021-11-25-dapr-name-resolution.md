---
title: Dapr 源码解析 | Name Resolution
date: 2021-11-25T15:40:17+08:00
cover: /dapr-name-resolution.png
description: 本文介绍 Dapr Name Resolution 相关源码.
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

Name resolution 解决的是微服务中的服务发现问题, dapr 中服务的标识符为 `app-id` , 服务间调用是通过 `app-id` 来确定目标服务的. 所以就需要 `app-id` 到真实服务地址的映射.

dapr 服务发现其实就是单纯的 gRPC 服务发现, 因为服务间调用是通过 dapr sidecar 转发的, 而 sidecar 之间是通过 gRPC 交流的, 所以最终就变成了 gRPC 服务发现了.

<!--more-->

## 实现

Name resolution 也是一个 component, 目前实现方式有三种: `mDNS`, `HashiCorp Consul` 和 `Kubernetes` .

默认情况下, dapr 在本地模式运行时使用 mDNS, 而在 k8s 环境运行时使用 `Kubernetes`.

查看 component 定义:

```go
type ResolveRequest struct {
  ID        string
  Namespace string
  Port      int
  Data      map[string]string
}

type Resolver interface {
  // Init initializes name resolver.
  Init(metadata Metadata) error
  // ResolveID resolves name to address.
  ResolveID(req ResolveRequest) (string, error)
}
```

`Init` 函数主要处理配置校验和初始化工作, 还会在必要时将自己注册到服务发现服务中, 而 `ResolveID` 则是要提供核心的将 `app-id` 转化为真正地址的逻辑.

mDNS 模式主要处理本地开发服务发现, 有些微服务框架本地开发都会内置这个功能, 例如 go-micro, 本文不做介绍.

## Kubernetes

关于 grpc-go 在 k8s 中的服务发现, 我之前文章 [在 k8s 中使用 gRPC Go 服务发现](https://blog.cong.moe/post/2021-03-15-grpc-go-discovery-in-k8s/) 也写过, 文章中介绍了三种方式: dns, k8s api 和 etcd, dapr 选用的是 dns 模式, 因为它最简单, 几乎不用实现.

所以整个 Kubernetes Name resolution 核心实现仅需要一行代码:

```go
// ResolveID resolves name to address in Kubernetes.
func (k *resolver) ResolveID(req nameresolution.ResolveRequest) (string, error) {
  // Dapr requires this formatting for Kubernetes services
  return fmt.Sprintf("%s-dapr.%s.svc.%s:%d", req.ID, req.Namespace, k.clusterDomain, req.Port), nil
}
```

其实就是拼接对应 dapr sidecar headless service 地址 `{app-id}-dapr.{namespace}.svc.cluster.local:{port}` .

虽然这部分很简单, 但是要真正实现`负载均衡`还需要一些代码细节. grpc 采用客户端负载均衡, 我之前文章 [gRPC Go 服务发现与负载均衡](https://blog.cong.moe/post/2021-03-06-grpc-go-discovery-lb/) 中介绍过.

假如直接使用上述地址建立连接, 那么 grpc 会使用默认的 passthrough resolver, 其实是啥都不做直接建立连接, 所以只会建立一个连接(连接时 dns 查询返回的地址)而且是长连接, 所有的请求都只会发送到这一个服务.

如果选择 dns 模式, 就需要在地址前面添加 scheme 头部 `dns:///` , 所以 dapr runtime 在建立连接时会根据运行环境处理连接地址:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/grpc.go#L77-L77
func (g *Manager) GetGRPCConnection(ctx context.Context, address, id string, namespace string, skipTLS, recreateIfExists, sslEnabled bool, customOpts ...grpc.DialOption) (*grpc.ClientConn, error) {
  // ...
  dialPrefix := GetDialAddressPrefix(g.mode)
  // ...
  conn, err := grpc.DialContext(ctx, dialPrefix+address, opts...)
  // ...
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/dial.go#L11-L11
func GetDialAddressPrefix(mode modes.DaprMode) string {
  if runtime.GOOS == "windows" {
    return ""
  }

  switch mode {
  case modes.KubernetesMode:
    return "dns:///"
  default:
    return ""
  }
}
```

可以看到当运行环境为 k8s 时增加了上面说的 dns resolver scheme 头部.

并且上一节的 operator 创建 sidecar service 时创建的是 headless service. 之所以使用 headless 是因为此模式相当于告诉 k8s 我们要自己做负载均衡, 因此 dns 查询的结果会返回所有 endpoint 而不是其中的某一个.

有了这些其实还没结束, 因为 grpc dns resolver 缓存时间非常长, 而 dns 解析只会出现在连接建立时, 所以假如长连接一直不断, 那么期间服务对应的 pod 增减 client 端其实是感知不到的. 因此 dapr 在 grpc server 端通过 `KeepaliveParams` 参数设置了最长连接时间 30 秒, 也就是当一个连接时间超过 30 秒, server 端会关闭连接迫使 client 端重新建立连接, 这样 dns 解析就会重新进行.

最后需要的就是 client 端配置负载均衡类型 `` grpcServiceConfig = `{"loadBalancingPolicy":"round_robin"}` `` .

总结一下, 在 k8s 中实现 grpc 服务发现负载均衡需要如下几点:

1. grpc server 需要创建 headless service
2. client 端使用 headless service FQDN 连接时需要加上 `dns:///` 前缀
3. grpc server 需要设置 `KeepaliveParams` 参数缩短 client 端对于服务变化的感知延迟
4. client 端需要设置负载均衡类型 `loadBalancingPolicy`

## HashiCorp Consul

我对 consul 了解不多, 但是知道 consul 有一套服务发现 API. Consul Name resolution 只是简单包装了 consul api. 但是有一点值得注意, 假如实现的 `ResolveID` 方法直接返回了 `ip:port` 这样类型的地址, 那么 grpc 其实是没有负载均衡的.

## 总结

对于这一节的内容, 特别是 k8s name resolution 部分我是比较熟悉的, 因为之前写过这部分的文章. 当初并没有那么自信, 因为我都是通过 grpc 文档, grpc-go 源码和自身实践测试出来的结论, 但是当这次看到 dapr 对于这部分的实现和我当初分析差别不大时, 是很开心的, dapr 毕竟是真正的生产级应用, 它这么使用至少说明这么用不会有问题.

## **参考资料**

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://github.com/dapr/components-contrib](https://github.com/dapr/components-contrib)
- [https://docs.dapr.io](https://docs.dapr.io)
- [https://blog.cong.moe/post/2021-03-15-grpc-go-discovery-in-k8s](https://blog.cong.moe/post/2021-03-15-grpc-go-discovery-in-k8s/)
- [https://blog.cong.moe/post/2021-03-06-grpc-go-discovery-lb](https://blog.cong.moe/post/2021-03-06-grpc-go-discovery-lb/)

![wxmp](/wxmp_tiny_1.png)
