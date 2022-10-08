---
title: Grpc Proxy
date: 2022-09-14T10:37:51+08:00
cover: /grpc-proxy.jpeg
description: 本文介绍 Grpc Proxy 原理.
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

对于 http proxy 大家非常熟悉, 各式各样的中间件都能简单支持. 但是在反向代理这个场景下, 同样基于 http2 协议的 grpc 却没法像 http 那样随意使用中间件做代理, 很重要的一点原因是: grpc 基于长连接, 普通的反代没法做到调用级别的负载均衡. 今天就来简单探讨下应用层代理的实现.

<!--more-->

## 场景分析

通过上一篇文章 [Grpc 泛化调用](/post/2022-09-04-grpc-generic-call) 我们可以得出结论: grpc 四种调用方式最终都是双向流的某种特殊形式, 也就是全部可以由双向流表示. 所以我们代理只需要实现双向流的转发方式就足够了. 所以反向代理的时序图基本是这样:

{{< figure src="/grpc-proxy-timeline.png" alt="grpc duplex proxy" position="center" caption="grpc duplex proxy">}}

根据上图可以看出代理层逻辑很简单, 代理层既作为 client 端的 server, 由作为业务 server 端的 client, 然后将 client 端的请求转发到业务 server, 将业务 server 的响应转发到 client 端.

分析下来很简单, 那么我们是否忽略了什么问题呢? 还记得上篇文章中我们看到应用层拿到的 pb 消息类型已经是 `interface{}` 了, 也就是反序列化后的. 但是我们代理层对消息只需要转发, 完全没必要反序列化它, 反序列化反而增加了开销, 并且最致命的一点是: pb 的序列化和反序列化都必须拿到消息定义(stub 文件/protoset/proto 文件). 一个中心化的网关一般都是服务于非常多的服务的, 如果反过来耦合所有服务的 proto 定义, 是很难接受的.

### grpc codec 扩展

grpc 允许我们注册扩展自己的序列化反序列化方式, 通过 `encoding.RegisterCodec(&JSONCodec{})` 来扩展, 例如我们下面的代码实现了 json 序列化扩展:

```go
const Name = "json"

func init() {
  encoding.RegisterCodec(&JSONCodec{})
}

type JSONCodec struct{}

func (j *JSONCodec) Marshal(v interface{}) ([]byte, error) {
  return json.Marshal(v)
}

func (j *JSONCodec) Unmarshal(data []byte, v interface{}) error {
  return json.Unmarshal(data, v)
}

func (j *JSONCodec) Name() string {
  return Name
}
```

在使用方面, grpc 允许客户端在建立连接时通过 `grpc.CallContentSubtype(codec.Name)` 指定 sub content-type. 客户端只能使用服务端支持的 codec.

在代理场景下, 代理层想要做的是: 将 client 发过来的序列化后的 []byte 消息原封不动转发给业务 server, 反之同理.

那么怎么拿到原始消息呢? grpc 默认的 codec 为 `proto`, 并且支持我们**覆盖**它. 因此我们通过这种 hack 的方式拿到原始消息:

```go
type Proxy struct {}

// 自定义一个 pb.Message 类型, 单纯保存 raw 消息
type Frame struct {
  payload []byte
}

// ProtoMessage tags a frame as valid proto message.
func (f *Frame) ProtoMessage() {}

// Marshal implements the encoding.Codec interface method.
func (p *Proxy) Marshal(v interface{}) ([]byte, error) {
  // 如果传进来的是 *Frame 类型的消息, 简单将内部 raw 消息返回,
  // 否则 fallback 到 proto 序列化
  out, ok := v.(*Frame)
  if !ok {
    return proto.Marshal(v)
  }

  return out.payload, nil
}

// Unmarshal implements the encoding.Codec interface method.
func (p *Proxy) Unmarshal(data []byte, v interface{}) error {
  // 如果传进来的是 *Frame 类型的消息, 简单将 raw 消息存储在 frame 内部,
  // 否则 fallback 到 proto 反序列化
  dst, ok := v.(*Frame)
  if !ok {
    return proto.Unmarshal(data, v)
  }
  dst.payload = data
  return nil
}

func (*Proxy) Name() string {
  return "proto" // 这里必须是 proto, 因为我们要覆盖默认
}
```

这个 codec 会在代理层使用, 这样收到 pb 消息时, 我们用 `*Frame` 来调用 `RecvMsg` 和 `SendMsg` 时, 完全相当于没有序列化穿透过去了. 这样我们的代理也就不需要感知 proto 定义了.

## 实现

上面两点已经解决了所有难点了, 剩下的只有实现细节了. 总结下来主要分为这几个模块:

1. 代理 upstream 连接管理
2. Codec
3. 双向流转发

### 连接管理

代理不能每来一个请求就和真正的业务服务建立一个连接, 所以我们需要对于同一个上游地址只维护一个连接. 因为 grpc client 自身连接管理已经做得很好了, 所以我们只需要做到单例就够了.

上游是多服务时, 需要额外的信息知道 client 端请求的上游到底是哪个, 有两种实现方式:

1. 代理服务维护路由表, 方法 -> 服务的映射
2. 客户端通过 metadata 传递信息

### Codec

序列化和反序列化上面已经讲的很明白了, 代理层需要引用它, 并且在和业务服务建立连接时设置 CallContentSubtype 为 `proto`.

### 双向流转发

双向流转发在 go 语言里面非常常见, 不过需要注意上节我们说的 grpc 规则.

```go
func (s *handler) handler(srv interface{}, serverStream grpc.ServerStream) error {
  fullMethodName, ok := grpc.MethodFromServerStream(serverStream)
  if !ok {
    return status.Errorf(codes.Internal, "lowLevelServerStream not exists in context")
  }
  // 需要根据 method 信息拿到真正的 upsteam 服务连接
  outgoingCtx, backendConn, _, err := s.director(serverStream.Context(), fullMethodName)
  if err != nil {
    return err
  }

  // 转发用户 client metadata 到 upstream 服务
  md, ok := metadata.FromIncomingContext(serverStream.Context())
  if ok {
    outgoingCtx = metadata.NewOutgoingContext(outgoingCtx, md.Copy())
  }

  clientCtx, clientCancel := context.WithCancel(outgoingCtx)
  defer clientCancel()
  // clientStream 是 proxy 和 upstream 建立的连接
  clientStream, err := grpc.NewClientStream(clientCtx, clientStreamDescForProxying, backendConn, fullMethodName)
  if err != nil {
    return err
  }

  // forwardServerToClient 是将用户 client 的消息转发给业务 upsteam 服务
  s2cErrChan := s.forwardServerToClient(serverStream, clientStream)
  // forwardClientToServer 是将业务 upsteam 服务消息转发给用户 client
  c2sErrChan := s.forwardClientToServer(clientStream, serverStream)
  // 双向流允许 client 端单边关闭, 所以必须等两个流都关闭再退出 handler(会关闭代理和 client 的流)
  for i := 0; i < 2; i++ {
    select {
    case s2cErr := <-s2cErrChan:
      if s2cErr == io.EOF {
        // s2cErr 收到 EOF 代表用户 client 给代理发送了 CloseSend
        // 所以我们也需要给 upsteam 发送 CloseSend
        // 因为用户 client 端不再有消息了
        _ = clientStream.CloseSend() //nolint
      } else {
        // 别的错误时, 通过 cancel ctx 回收连接
        clientCancel()
        return status.Errorf(codes.Internal, "failed proxying s2c: %v", s2cErr)
      }
    case c2sErr := <-c2sErrChan:
      // 当服务端正常完成响应时会收到 io.EOF, 否则收到错误, 但是两种场景都代表服务端要断开流了
      // 这时候需要将 trailer 转发给用户 client
      serverStream.SetTrailer(clientStream.Trailer())
      // 如果错误不是 EOF, 返回错误(包含 grpc status)
      if c2sErr != io.EOF {
        return c2sErr
      }
      // EOF 是因为我们不知道什么时候结束, 多尝试读了一次消息, 因此需要在 EOF 错误时返回 nil
      return nil
    }
  }
  return status.Errorf(codes.Internal, "gRPC proxying should never reach this stage.")
}

// forwardClientToServer 是将业务 upsteam 服务消息转发给用户 client
func (s *handler) forwardClientToServer(src grpc.ClientStream, dst grpc.ServerStream) chan error {
  ret := make(chan error, 1)
  go func() {
    f := &codec.Frame{}
    for i := 0; ; i++ {
      if err := src.RecvMsg(f); err != nil {
        ret <- err // this can be io.EOF which is happy case
        break
      }
      if i == 0 {
        // 这里比较 hack, 因为 grpc header 只能发送一次, 并且必须在第一条消息发送之前,
        // 因此我们作为 client 端在收到 upstream 第一条消息的时候肯定能够拿到 upstream 发送的 header,
        // 所以需要在此时先将 header 发送给用户 client
        md, err := src.Header()
        if err != nil {
          ret <- err
          break
        }
        if err := dst.SendHeader(md); err != nil {
          ret <- err
          break
        }
      }
      // 简单转发消息
      if err := dst.SendMsg(f); err != nil {
        ret <- err
        break
      }
    }
  }()
  return ret
}

// forwardServerToClient 是将用户 client 的消息转发给业务 upsteam 服务
func (s *handler) forwardServerToClient(src grpc.ServerStream, dst grpc.ClientStream) chan error {
  ret := make(chan error, 1)
  go func() {
    f := &codec.Frame{}
    for i := 0; ; i++ {
      if err := src.RecvMsg(f); err != nil {
        ret <- err // this can be io.EOF which is happy case
        break
      }
      // 简单转发消息
      if err := dst.SendMsg(f); err != nil {
        ret <- err
        break
      }
    }
  }()
  return ret
}
```

上面的 handler 逻辑就是代理服务的核心, 作为 `grpc.StreamHandler` 代理泛化请求就行了.

完整代码可查看 [https://github.com/zcong1993/grpc-go-beyond/tree/master/internal/proxy](https://github.com/zcong1993/grpc-go-beyond/tree/master/internal/proxy).

## 使用场景

一个应用层的代理能做什么大家肯定心里有数, 理论上不需要依赖消息体的都能做, 列出来基本就这几大类:

- 可观测 - metric, trace
- 服务弹性 - 超时, 限流, 熔断, 重试
- 安全 - 消息签名, 加解密, 路由权限控制

对于 grpc 来说更关键的一点是: 让客户端使用上能够透明. 这一点可以参考 dapr 项目引入 grpc proxy 的新路历程.

## 参考资料

- [https://github.com/dapr/dapr/tree/master/pkg/grpc/proxy](https://github.com/dapr/dapr/tree/master/pkg/grpc/proxy)
- [https://github.com/trusch/grpc-proxy](https://github.com/trusch/grpc-proxy)
