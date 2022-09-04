---
title: Grpc 泛化调用
date: 2022-09-04T23:10:36+08:00
cover: /grpc-generic-call.jpeg
description: 本文介绍 Grpc 泛化调用, 即不使用 pb 生成的 server/client stub 代码实现调用.
categories:
  - gRPC
  - RPC
  - Golang
tags:
  - gRPC
  - RPC
  - Golang
draft: false
js:
  - js/prism-protobuf.min.js
---

一般来说 Grpc 使用时, 只需要在 proto 文件中指定好 message 和 service 类型, pb 就能帮我们生成好对应语言的桩代码, 对于服务端只需要 implement 对应的 handler 接口, 对于客户端直接生成了开箱即用的客户端代码. 这也是 Grpc 多语言移植性强的原因. 今天简单介绍下 Grpc 的调用逻辑, 最终做到仅需要 pb 生成的 message 类型实现服务端和客户端逻辑.

<!--more-->

## grpc 四种调用类型

众所周知, grpc 支持下面四种调用类型:

1. unary call (客户端和服务端都发送一条消息)
2. server stream (客户端一条消息, 服务端返回多条)
3. client stream (客户端发送多条消息, 服务端返回一条)
4. duplex stream (客户端和服务端都发送多条消息)

提现在 proto 声明, 大概是这样:

```protobuf
message EchoRequest {
  string message = 1;
}

service Hello {
  rpc Echo(EchoRequest) returns (EchoRequest);
  rpc ServerStream(EchoRequest) returns (stream EchoRequest);
  rpc ClientStream(stream EchoRequest) returns (EchoRequest);
  rpc DuplexStream(stream EchoRequest) returns (stream EchoRequest);
}
```

稍微分析下上面四种模式, 简单思考就会发现: 前面三种是第四种的特殊形式. 因为发送一条消息是发送多条消息的子集, 因此如果支持了流操作也就意味着天然支持了单条消息. 所以 grpc 只需要实现第四种方式, 前面三种都可以通过封装第四种实现高阶 API 也就是语法糖. 下面通过时序图来看看上面四种模式:

{{< figure src="/duplex_stream.png" alt="grpc duplex stream" position="center" caption="grpc duplex stream">}}

{{< figure src="/unary_call.png" alt="grpc unary call" position="center" caption="grpc unary call">}}

由于篇幅原因, 完整的四种时序图可以在[这里查看](https://github.com/zcong1993/grpc-go-beyond/blob/master/docs/sequenceDiagram.md).

整体时序图可以总结下面几点规则:

1. 都由客户端发起(否则服务端感受不到客户端的存在)
2. 服务端发送 header 只能发送一次, 并且只能在发送第一条消息之前
3. 服务端发送 trailer 会在断开前发送给客户端, 客户端必须在 CloseSend 调用之后读取
4. 客户端在调用 CloseSend 之后无法再发送消息, 表明自己不需要再发送消息, 但是可以继续接收消息
5. 服务端关闭后两边流都会关闭(不然连接泄露)

## 客户端代码分析

我们首先看看客户端, pb 生成的代码仅需要我们传入 `grpc.ClientConnInterface` 类型的客户端连接, 来看看它的类型:

```go
type ClientConnInterface interface {
  // Invoke performs a unary RPC and returns after the response is received
  // into reply.
  Invoke(ctx context.Context, method string, args interface{}, reply interface{}, opts ...CallOption) error
  // NewStream begins a streaming RPC.
  NewStream(ctx context.Context, desc *StreamDesc, method string, opts ...CallOption) (ClientStream, error)
}
```

`NewStream` 就是 stream API, 而 `Invoke` 则是 unary API(语法糖). 所以我们主要关注前者返回的 `ClientStream` 类型.

```go
type ClientStream interface {
  // 读取 header
  Header() (metadata.MD, error)
  // 读取 trailer
  Trailer() metadata.MD
  // 表明自己不需要再发送消息
  CloseSend() error
  // 发一条消息
  SendMsg(m interface{}) error
  // 接收一条消息
  RecvMsg(m interface{}) error
  Context() context.Context
}
```

结合上面的时序图看这个接口会非常清晰, 仅仅需要将时序图里面对应的事件替换成对应的 API 即可. 那么 pb 帮我们生成的客户端多了些什么呢? 答案是: 类型和前三种类型语法糖.

先看类型这点, 这也是 grpc 的一大优势, 就是 proto 定义类型可以跨端直接使用, grpc sdk 层面肯定只能提供一个低阶的通用化 API, 所以 pb 会根据我们的 service 定义, 帮我们把上面的类型包装成带有我们对应消息类型的方法. 例如我们上面 proto 种的 `ClientStream` 接口会生成如下代码:

```go
// 生成 API 将参数类型变成了我们声明的 message 类型
func (x *helloClientStreamClient) Send(m *EchoRequest) error {
  // 仅仅是封装了下 SendMsg API
  return x.ClientStream.SendMsg(m)
}
```

第二点是语法糖, 对于 client stream 的类型, 服务端只会发送一条消息, 而且根据流程图我们可以看出是: 客户端发送 n 条消息 -> 调用 CloseSend -> 接收服务端消息. 所以 pb 帮我们生成了语法糖 `CloseAndRecv` 方法, 就是将后面两个动作组合在了一起:

```go
// CloseAndRecv 就是组合 CloseSend 和 RecvMsg
func (x *helloClientStreamClient) CloseAndRecv() (*EchoRequest, error) {
  if err := x.ClientStream.CloseSend(); err != nil {
    return nil, err
  }
  m := new(EchoRequest)
  // 这里也会将 interface{} 类型转换为我们声明的类型
  if err := x.ClientStream.RecvMsg(m); err != nil {
    return nil, err
  }
  return m, nil
}
```

总结下来 pb 生成 client 端代码做的事情主要是下面几点:

1. unary call: 将 `Invoke` 方法请求体和响应体类型转化成声明类型
2. server stream: 提供 `ServerStream(ctx context.Context, in *EchoRequest, opts ...grpc.CallOption) (Hello_ServerStreamClient, error)` 语法糖, 由于客户端只需要发送一条消息, 所以参数直接接收了声明的请求体类型, 并且返回一个 stream, 提供 `Recv` 仅仅是将 `RecvMsg` 包装成声明类型
3. client stream: 方法参数中没有请求类型, 直接返回 stream, 提供 `Send(*EchoRequest) error` 和 `CloseAndRecv() (*EchoRequest, error)` 语法糖
4. duplex stream: 返回 stream, 提供 `Send(*EchoRequest) error` 和 `Recv() (*EchoRequest, error)` API 仅仅是类型转换

看似最麻烦的 duplex stream 的封装反而是最少的. 搞清楚了这些, 我们就可以直接使用 `ClientConnInterface.NewStream` 来直接进行上面四种类型调用.

### 泛化调用

我们以 client stream 类型为例, 假如业务场景是: client 端流式发送 5 条消息给服务端, 服务端处理后返回, 代码大概是这样:

```go
// client stream
func (r *RawTester) TestClientStream() {
  // 1. 调用 ClientConnInterface.NewStream 建立流
  cs, _ := r.conn.NewStream(r.ctx, desc, "/proto.Hello/ClientStream")

  // 2. 业务逻辑, 发送 5 条消息
  req := &pb.EchoRequest{Message: "test"}
  for i := 0; i < 5; i++ {
    _ = cs.SendMsg(req)
  }

  // 3. 结束发送
  _ = cs.CloseSend()

  // 4.1 接收 header(optional)
  md, _ := cs.Header()

  resp := new(pb.EchoRequest)
  // 4.2 接收服务端响应
  _ = cs.RecvMsg(resp)
  // 4.3 接收 trailer(optional)
  trailer := cs.Trailer()
}
```

四种类型都是通过 `SendMsg` 和 `RecvMsg` 调用次数来区分, 调用多次就表示这个方向是 stream. 再来实现个 unary call 对比下:

```go
func (r *RawTester) TestEcho() {
  cs, _ := r.conn.NewStream(r.ctx, desc, "/proto.Hello/Echo")

  req := &pb.EchoRequest{Message: "test"}
  _ = cs.SendMsg(req)
  _ = cs.CloseSend()
  // ...省略掉 header trailer 部分

  resp := new(pb.EchoRequest)
  _ = cs.RecvMsg(resp)
}
```

流程更加简单了, 只是按照顺序调用 `SendMsg` -> `CloseSend` -> `RecvMsg` 即可. 但是 grpc 缺额外封装了一层 `Invoke` 语法糖, 主要是因为 unary 是使用频率最高的一种类型, `Invoke` 语法糖会对用户更友好, 并且 `UnaryClientInterceptor` 比 `StreamClientInterceptor` 也会好用非常多.

完整四种实现可见 [https://github.com/zcong1993/grpc-go-beyond/blob/master/internal/clienttest/raw.go](https://github.com/zcong1993/grpc-go-beyond/blob/master/internal/clienttest/raw.go).

## 服务端代码分析

文章开头提到过, server 端仅需要将我们的业务逻辑填充到 pb 生成好的服务端 interface 类型实现中即可. 类比 http 框架, 服务端需要做的只是把业务 handler 绑定给对应的框架路由, 框架在请求匹配到路由时调用我们注册的 handler. grpc server 端逻辑也差不多, 也就是我们只提供 handler 并不是直接管理连接, 这一点非常重要. 所以时序图里面的服务端连接关闭其实就是在我们的 handler 退出后, grpc sdk 会根据 handler 返回的结果和 error 给客户端返回 status 信息并关闭连接.

和客户端类似, pb 生成的服务端代码依赖 grpc sdk 提供的 `ServerStream`:

```go
type ServerStream interface {
  // 暂存 header 而不直接发送, 调用多次会 merge
  SetHeader(metadata.MD) error
  // 发送 header, 只能在 SendMsg 前调用一次
  SendHeader(metadata.MD) error
  // 设置 trailer
  SetTrailer(metadata.MD)
  // 发送消息
  SendMsg(m interface{}) error
  // 接收消息
  RecvMsg(m interface{}) error
  Context() context.Context
}
```

和客户端差不多, 只是 header 和 trailer 变成了发送. 服务端生成的代码也只是做了 interface{} 类型到声明类型的转换, 最终还是需要使用 `pb.RegisterHelloServer` 生成的类型注册我们的实现. 但是我们需要的是泛化调用, 所以我们需要使用 `grpc.UnknownServiceHandler(server.Handler())` 这种方式, 类似于 grpc 为我们留了 404 handler, 在路由匹配不到时会 fallback 到这个 handler, 函数签名为 `type StreamHandler func(srv interface{}, stream ServerStream) error`.

### 泛化调用

同理我们以 server stream 为例, 假如业务场景是: 客户端发送一条信息, 服务端流式返回 5 条, 代码大概是这样:

```go
func (s *stream) handleServerStream() error {
  // 1. 接收客户端 metadata(optional)
  if md, ok := metadata.FromIncomingContext(s.serverStream.Context()); ok {
    fmt.Println("metadata: ", md)
  }

  // 2. 接收客户端请求, server stream 客户端只会发一条消息
  var req pb.EchoRequest
  _ = s.serverStream.RecvMsg(&req)

  // 3. 发送 header(optional)
  _ = s.serverStream.SendHeader(header)

  // 5. 最后发送 tailer(optional)
  defer s.serverStream.SetTrailer(trailer)

  for i := 0; i < 5; i++ {
    // 4. 发送 5 条消息
    _ = s.serverStream.SendMsg(&req)
  }

  return nil
}
```

和客户端完全一样的逻辑, 再来实现个 unary handler 对比下:

```go
func (s *stream) handleEcho() error {
  // 1. 接收请求
  var req pb.EchoRequest
  _ = s.serverStream.RecvMsg(&req)
  // 2. 发送响应
  return s.serverStream.SendMsg(&req)
}
```

完整四种实现可见: [https://github.com/zcong1993/grpc-go-beyond/blob/master/internal/server/stream.go](https://github.com/zcong1993/grpc-go-beyond/blob/master/internal/server/stream.go).

最终我们可以根据方法名区分 handler:

```go
func Handler() grpc.StreamHandler {
  return func(srv interface{}, serverStream grpc.ServerStream) error {
    fullMethodName, ok := grpc.MethodFromServerStream(serverStream)
    if !ok {
      return status.Errorf(codes.Internal, "lowLevelServerStream not exists in context")
    }

    s := stream{serverStream: serverStream}

    switch fullMethodName {
    case "/proto.Hello/Echo":
      return s.handleEcho()
    case "/proto.Hello/ServerStream":
      return s.handleServerStream()
    case "/proto.Hello/ClientStream":
      return s.handleClientStream()
    case "/proto.Hello/DuplexStream":
      return s.handleDuplexStream()
    default:
      return status.Errorf(codes.Internal, "method not exists")
    }
  }
}
```

至此, proto grpc 部分生成代码的功能逻辑我们就很清楚了.

## 后记

在我们学习一个技术的时往往会想这个有什么用? 使用场景是什么? 其实这篇文章是后面我打算写的 grpc proxy 相关文章的铺垫.

grpc 在业务中使用时, proto 定义就是 API 的定义, 能够拉齐服务端和客户端, 但是对于中心化 proxy 这种场景需要承接多个服务, 如果依赖感知所有 proto 定义会变成一个枷锁, 今天这篇文章讲述了如何抛弃 proto 生成的 service 定义部分, 后续 grpc proxy 文章会移除掉所有 proto 依赖.

本文所有的代码均可查看: [https://github.com/zcong1993/grpc-go-beyond](https://github.com/zcong1993/grpc-go-beyond).
