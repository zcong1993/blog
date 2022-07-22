---
title: Grpc client 拦截器 CallOption 扩展
date: 2022-07-21T16:26:40+08:00
cover: /grpc-interceptor-call-option.jpeg
description: 本文介绍 Grpc client 拦截器 CallOption 扩展.
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

本文简单讲述 Grpc client 拦截器 CallOption 扩展.

<!--more-->

拦截器应该是最常见的 grpc client 扩展方式, 众多常见服务治理功能都是通过拦截器实现的, 例如: metric, trace, 限流, 熔断.

易用是它很核心的优点, 基本都是配置一次做到业务无感知. 也就是大多数拦截器是全局配置(在同一个 grpc client 连接层面), 但是我们有时候需要对某些接口使用特殊的拦截器配置.

举一个具体的例子: 对于一个 `TimeoutInterceptor` 我们全局配置是 `1s` 的超时, 但是该服务某几个接口需要 `3s` 的响应时间. 常见的处理方式就是被迫把这个连接的超时时间设置成 `3.5s`, 也就是取最长接口响应时间作为这个连接的全局超时时间. 这样做的缺点太明显了, 完全就是一种妥协, 假如后面再出现一个 `4s` 的接口难道再改为 `4.5s` 吗? 这样大多数情况会使得客户端超时没有意义. 那么我们能否做到单独对这个接口设置 `3.5s` 配置, 然后全局配置仍然为 `1s` 呢? 答案是肯定的.

## Golang Options Pattern

这里简单聊聊 go 语言的 options 设计模式. 它主要是为了解决 go 语言函数不支持可选参数和参数默认值的缺点.

```go
// 声明私有可选参数
type option struct {
  age int
}

// option 修改器类型
type Option func(o *option)

// 返回一个设置 age 的 Option 方法
func WithAge(age int) Option {
  return func(o *option) {
    o.age = age
  }
}

func A(name string, opts ...Option) {
  // 可以指定默认值
  o := &option{age: 18}
  for _, opt := range opts {
    opt(o)
  }
  // 如果用户使用了 WithAge 则他指定的值会覆盖默认值
  // 未使用的话, age 会是默认值.
}
```

简单来说函数签名为 `func A(a string, opts ...Option)` 形式并且提供一些 `WithXXX` 的函数让你可以指定/修改某些可选参数. 这个模式在大量的 go 项目中使用. 同时还有另一种扩展形式:

```go
// Option 变成了 interface 类型
type Option interface {
  apply(o *option)
}

type OptionFunc func(o *option)
func (f OptionFunc) apply(o *option) {
  f(o)
}

func WithAge(age int) Option {
  return OptionFunc(func(o *option) {
    o.age = age
  })
}

func A(name string, opts ...Option) {
  o := &option{age: 18}
  for _, opt := range opts {
    opt.apply(o)
  }
}
```

## grpc client CallOption

当然 grpc client 进行方法调用时也是支持使用 Option 模式传递可选参数. 我们可以查看下函数签名:

```go
// 客户端调用生成代码都是基于这个底层 API client Invoke
type Invoke func(ctx context.Context, method string, args interface{}, reply interface{}, opts ...CallOption) error
// 拦截器
type UnaryClientInterceptor func(ctx context.Context, method string, req, reply interface{}, cc *ClientConn, invoker UnaryInvoker, opts ...CallOption) error
```

因此我们在拦截器里面能够拿到用户在外层调用时传递的 `CallOption` 参数, 但是可选参数的容器都是私有的(上例中的 option), 所以我们拿不到这些值, 并且我们也没法给它扩展增加属性.

相信聪明的读者已经想到了解决方案, 也就是上面铺垫的 `interface` 类型的 Option 模式. grpc CallOption 类型为 interface:

```go
type CallOption interface {
  before(*callInfo) error
  after(*callInfo, *csAttempt)
}
```

但是还是有问题, 因为接口中的方法类型是私有的, 外面没法扩展. 所以 grpc 对外暴露了 `EmptyCallOption` 这个空的接口实现, 将它内嵌到我们的扩展结构体, 这个结构体就变成了 `CallOption` 接口. 最终我们可以在拦截器中使用类型断言过滤出我们的扩展类型.

上面的超时拦截器需求就可以这样解决:

```go
type CallOption struct {
  // 内嵌类型
  grpc.EmptyCallOption

  forceTimeout time.Duration
}

// 暴露给用户使用, 可以当做 grpc.CallOption 来使用
func WithForceTimeout(forceTimeout time.Duration) CallOption {
  return CallOption{forceTimeout: forceTimeout}
}

func getForceTimeout(callOptions []grpc.CallOption) (time.Duration, bool) {
  for _, opt := range callOptions {
    // 类型断言过滤出我们自己的扩展类型
    if co, ok := opt.(CallOption); ok {
      return co.forceTimeout, true
    }
  }

  return 0, false
}

func TimeoutInterceptor(t time.Duration) grpc.UnaryClientInterceptor {
  return func(ctx context.Context, method string, req, reply interface{}, cc *grpc.ClientConn,
    invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
    timeout := t
    if v, ok := getForceTimeout(opts); ok {
      timeout = v
    }

    if timeout <= 0 {
      return invoker(ctx, method, req, reply, cc, opts...)
    }

    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    return invoker(ctx, method, req, reply, cc, opts...)
  }
}
```

## 总结

每个语言都有自己的特点, 也就演化出了符合自规则的玩法(设计模式). go 语言的 Option 模式是每一个 gopher 都需要掌握的基本技能, 个人觉得在现有框架下还是比较优雅的. 但是 grpc 拦截器参数扩展这种场景不算常见, 因为它的前提是中间件模式, 这种只会在基础框架中出现.
