---
title: Grpc ClientConnInterface 扩展
date: 2022-08-04T14:50:36+08:00
cover: /grpc-client-conn-interface.jpeg
description: 本文介绍 Grpc ClientConnInterface 扩展.
categories:
  - gRPC
  - RPC
  - Golang
tags:
  - gRPC
  - RPC
  - Golang
draft: false
---

对于 Grpc go 用户来说最熟悉的扩展方式肯定是拦截器, 正如上文中所说, 但是某些场景下使用仍然需要其他扩展方式. 本文简单介绍下 grpc client 端的 `ClientConnInterface` 扩展.

<!--more-->

首先从源码的类型定义入手:

```go
// ClientConnInterface defines the functions clients need to perform unary and
// streaming RPCs.  It is implemented by *ClientConn, and is only intended to
// be referenced by generated code.
type ClientConnInterface interface {
  // Invoke performs a unary RPC and returns after the response is received
  // into reply.
  Invoke(ctx context.Context, method string, args interface{}, reply interface{}, opts ...CallOption) error
  // NewStream begins a streaming RPC.
  NewStream(ctx context.Context, desc *StreamDesc, method string, opts ...CallOption) (ClientStream, error)
}
```

这个类型在生成的 `_grpc.pb.go` 的文件中被使用, 如注释中所写, 生成的 grpc client 代码中用到了 client conn 的这两个方法, 所以这里相当于 *ClientConn 实现功能的部分抽象, 类似于 `http.RoundTripper` 是底层客户端给上层提供的基本功能.

有了这样一层抽象类型, 就可以轻松使用套娃的形式实现中间件, http middleware 就是这个原理. 那么它和 grpc client 端拦截器有什么区别呢?

简单来说就是 `ClientConnInterface` 比拦截器更加底层, 拦截器装饰的 `invoker` 也是它, 拦截器没法修改请求连接层面的信息而 `ClientConnInterface` 可以.

和 http client 对比, 由于 grpc 使用长连接, 所以 `http.RoundTripper` 中改写请求 host 这种功能在 grpc 拦截器中是没法实现的, 而在 `ClientConnInterface` 是可以实现的.

http client 可以通过中间件实现请求分流, 即根据请求 path 将请求 host 改写到不同的后端, 下面简单演示下如何在 grpc client 端实现这个功能.

```go
type customClientConn struct {
	client1 grpc.ClientConnInterface
	client2 grpc.ClientConnInterface
}

func (c *customClientConn) Invoke(ctx context.Context, method string, args interface{}, reply interface{}, opts ...grpc.CallOption) error {
	if method == "aaa" {
		return c.client1.Invoke(ctx, method, args, reply, opts...)
	}
	return c.client2.Invoke(ctx, method, args, reply, opts...)
}
// NewStream 方法同理, 省略
```

这里也可以增加任何在拦截器中可以实现的功能, 例如修改消息序列化类型或格式, 增加认证等.

## 真实业务场景

公司有个老的认证服务, 要求某些敏感的接口在进行服务间调用时需要通过该中心化的服务进行, 也就是 `A -> B` 会变为 `A -> C -> B`, 并且 A -> C 使用的是泛化调用的形式, 即消息体都是 `pb.Any` 的形式. 为了减轻用户使用压力, 我们通过 `ClientConnInterface` 的方式实现了这个功能, 用户只需要修改配置就可以控制请求路径. 简单代码逻辑如下:

```go
type customClientConn struct {
	centerClient grpc.ClientConnInterface
	originClient grpc.ClientConnInterface
}

func (c *customClientConn) Invoke(ctx context.Context, method string, args interface{}, reply interface{}, opts ...grpc.CallOption) error {
  // read user config method whitelist
	if method == "aaa" {
    // convert request type
		err := c.centerClient.Invoke(ctx, method, args, reply, opts...)
    if err != nil {
      return err
    }
    // convert response type
    return nil
	}

	return c.originClient.Invoke(ctx, method, args, reply, opts...)
}
// NewStream 方法同理, 省略
```

用户在使用时是透明的, 并且也可以按需初始化连接, 假如用户所有方法都使用 C 服务中转, 那么只会和 C 建立连接, 反之同理.

## 一些思考

grpc go 在设计上为用户各种扩展需求都留足了口子, 所以很多问题都可以优雅解决. 结合最近看的书中提到的 `抽象是在消费端被发现的而不是在生产端创建的`, 结合 grpc go 的源码, 可以看到 resolver 和 balancer 都需要底层 client conn 提供一些功能, 但他们都是通过 `ccResolverWrapper` 和 `ccBalancerWrapper` 封装 client conn 实现了各自需要的 `resolver.ClientConn` 和 `balancer.ClientConn`, 这些都是值得学习的.
