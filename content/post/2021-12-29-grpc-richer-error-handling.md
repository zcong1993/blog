---
title: gRPC 扩展错误处理
date: 2021-12-29T16:15:57+08:00
cover: /cover.jpeg
description: 本文介绍 gRPC 基本错误处理和使用 goolge 扩展处理错误.
categories:
  - gRPC
  - Golang
  - NodeJS
tags:
  - gRPC
  - Golang
  - NodeJS
keywords:
  - gRPC
  - Error handling
draft: true
---

开发过程中我们会花费大量时间和错误处理打交道, HTTP 协议错误处理基本会通过 status code 和请求响应(自定义消息) 来传递错误, 而 gRPC 这边错误处理就没有 HTTP 这么好控制.

<!--more-->

## 基本错误处理

gRPC 默认使用 `Status` 来表示错误, 这个结构包含了 `code` 和 `message` 两个字段. code 是类似于 http status code 的一系列错误类型的 [枚举](https://grpc.io/docs/guides/error/#error-status-codes), 所有语言 sdk 都会内置这个枚举列表, 而 message 就是服务端需要告知客户端的一些错误详情信息.

gRPC 错误响应或获取都是使用语言的标准 Error 处理方式, 例如: 通过 `throw Error` 发送错误响应, 通过 `try catch` 来获取错误. 所以有些语言 sdk 会带有 `Status` 和语言 `Error` 的互转方法.

以 Golang 为例:

```go
// 发送错误响应
err := status.Errorf(codes.InvalidArgument, "invalid args")

// 错误转回 status
// 转换有可能失败
st, ok := status.FromError(err)
fmt.Println(st.Code(), st.Message())
```

有人建了一个仓库展示了几乎所有语言的 gRPC 错误处理方式: [https://avi.im/grpc-errors](https://avi.im/grpc-errors).

默认错误处理方式非常简单直白, 但是有个很大的问题就是 `表达能力非常有限`. 因为使用类似于 HTTP 状态码的有限抽象 code 没法表达出多样的业务层的错误, 而 message 这种字符串也是不应该被请求方当做业务错误标识符来使用. 所以我们需要一个额外能够传递业务错误码甚至更多额外错误信息字段的功能.

## Richer error model

Google 基于自身业务, 有了一套错误扩展 [https://cloud.google.com/apis/design/errors#error_model](https://cloud.google.com/apis/design/errors#error_model), 简单来说就是自己定义了一个 protobuf 错误消息类型:

```protobuf
// The `Status` type defines a logical error model that is suitable for
// different programming environments, including REST APIs and RPC APIs.
message Status {
  // A simple error code that can be easily handled by the client. The
  // actual error code is defined by `google.rpc.Code`.
  int32 code = 1;

  // A developer-facing human-readable error message in English. It should
  // both explain the error and offer an actionable resolution to it.
  string message = 2;

  // Additional error information that the client code can use to handle
  // the error, such as retry info or a help link.
  repeated google.protobuf.Any details = 3;
}
```

可以看到比标准错误多了一个 `details` 数组字段, 而且这个字段是 Any 类型, 支持我们自行扩展.

那么问题来了, 如何传递这个非标准的错误扩展消息呢? 答案是放在 `trailing response metadata` 中, key 为 `grpc-status-details-bin`.

这个功能只被部分语言 sdk 支持了, 所以有些不被支持的语言想要使用这个功能需要手动处理.

由于 Golang 支持了这个扩展, 所以可以看到 `Status` 直接就是有 `details` 字段的.

```go
// 使用 WithDetails 附加自己扩展的错误类型, 该方法会自动将我们的扩展类型转换为 Any 类型
st, err := status.New(codes.Unknown, "test error").WithDetails(&pb.BizError{})
// 将 st.Err() 当做 error 返回
if err == nil {
  return st.Err()
}

st, ok := status.FromError(err)
if ok {
  // 直接可以读取 details
  fmt.Printf("%+v\n", st.Details())
}
```

grpc-go 源码搜索 `grpc-status-details-bin` 可以看到相关源码:

```go
// 发送错误
// https://github.com/grpc/grpc-go/blob/23a83dd097ec07fc7ddfb4a30c675763e4972ba4/internal/transport/handler_server.go#L205
func (ht *serverHandlerTransport) WriteStatus(s *Stream, st *status.Status) error {
  // ...
  // 包含 details 时, 将 status 消息序列化放到 metadata 中
  if p := st.Proto(); p != nil && len(p.Details) > 0 {
    stBytes, err := proto.Marshal(p)
    if err != nil {
      // TODO: return error instead, when callers are able to handle it.
      panic(err)
    }

    h.Set("Grpc-Status-Details-Bin", encodeBinHeader(stBytes))
  }
  // ...
}

// 接收错误
// https://github.com/grpc/grpc-go/blob/40916aa021698425b1685741a48315a4c675bc92/internal/transport/http2_client.go#L1343
func (t *http2Client) operateHeaders(frame *http2.MetaHeadersFrame) {
  // ...
  case "grpc-status-details-bin":
    var err error
    statusGen, err = decodeGRPCStatusDetails(hf.Value)
    if err != nil {
      headerError = fmt.Sprintf("transport: malformed grpc-status-details-bin: %v", err)
    }
  // ...
}
```

值得一提的是, Golang 提供的 `status.Details()` 方法已经将 details 中的 Any 消息进行了动态反序列化, 也就是只要是你 protobuf 包含的类型, 直接可以使用 `detail.(*Type)` 来进行转换, 但是如果出现未知类型你将会得到一个 error.

## 在 NodeJS 中使用 richer error

NodeJS 官方 sdk 没有实现这种扩展错误, 所以我们这里尝试手动扩展.

### 引入类型

NodeJS sdk 默认是不附带扩展后的 status 类型的, 所以我们需要将上面的 status protobuf 文件放入自己项目中并生成出 protobuf 类型.

### 错误发送

首先, 查看 nodejs sdk 的错误类型:

```ts
export interface StatusObject {
  code: Status // 这里的 Status 指的是 Codes 枚举, 不是我们生成的 Status
  details: string // 这里的 details 是 message 而不是我们要实现的扩展
  metadata: Metadata
}
```

可以看到支持我们响应 metadata, 所以需要我们做的就是在使用 details 时将 status 整条消息序列化后设置在 metadata 中. 所以实例代码大致如下:

```ts
// 暂时忽略用户需要响应 metadata 的情况简化代码
export const buildStatus = (
  code: Codes,
  message?: string,
  details?: Any[]
): Partial<StatusObject> => {
  // 注意这里的 Status 类型为我们生成出来的类型
  const st = new Status()
  st.setCode(code)
  st.setMessage(message)
  st.setDetailsList(details)

  const metadata = new Metadata()
  if (details?.length > 0) {
    const bf = st.serializeBinary()
    metadata.set('grpc-status-details-bin', Buffer.from(bf))
  }

  return {
    code,
    details: message,
    metadata,
  }
}
```

我们上篇文章讲述 Any 类型使用时说过由于 NodeJS 无法从 protobuf 消息中获取标识符, 所以我们没法像 Golang 那样帮助用户将消息转化成 Any 类型. 使用示例基本为:

```ts
const any = new Any()
// BizError 为我们自定义错误类型
const bizError = new BizError()
any.pack(bizError.serializeBinary(), 'pb.BizError')
buildStatus(Codes.UNKNOWN, 'invalid args', [any])
```

![wxmp](/wxmp_tiny_1.png)
