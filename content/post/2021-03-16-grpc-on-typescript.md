---
title: 在 Typescript 中使用 gRPC
date: 2021-03-16T15:32:21+08:00
cover: /cover.jpeg
description: gRPC 是一个高性能, 支持多种语言的 RPC 框架, 官方已经支持了 NodeJS 语言. 而 Typescript 作为 JavaScript 的超集, 可以提高 js 代码的可维护性, 并且代码提示很不错, 已在 js 市场占据了很大份额. 本文简单介绍下 gRPC 在 Typescript 中如何使用.
categories:
  - gRPC
  - NodeJS
  - TypeScript
tags:
  - gRPC
  - NodeJS
  - TypeScript
draft: true
---

gRPC 是一个高性能, 支持多种语言的 RPC 框架, 官方已经支持了 NodeJS 语言. 而 Typescript 作为 JavaScript 的超集, 可以提高 js 代码的可维护性, 并且代码提示很不错, 已在 js 市场占据了很大份额. 本文简单介绍下 gRPC 在 Typescript 中如何使用.

<!--more-->

## 官方库选择

早年 grpc 官方 NodeJS client 是基于 c++ 的原生 addon (npm package: [grpc](https://yarnpkg.com/package/grpc)), 随着纯 js 版本([@grpc/grpc-js](https://yarnpkg.com/package/@grpc/grpc-js))的成熟, 官方弃用了 native 版本, 所以没什么必要做选择了, 选择纯 js 版本就够了.

## 代码生成工具选择

一般静态语言使用 grpc 时, 需要先使用 `protoc` 配合各种语言自身的代码生成插件根据 `proto` 文件生成出对应语言的 `message` 类型, `grpc server` 端需要实现的 interface, `grpc client` 代码.

js 这种动态语言官方提供了动态生成工具 [@grpc/proto-loader](https://www.npmjs.com/package/@grpc/proto-loader), 也就是不需要我们显式生成代码, 但是缺点很明显: 没有任何类型. 由于本文考虑的是 ts 生态, 所以不考虑此种方式.

由于是 ts, 我们不光需要代码还需要类型生成, 我们选择 [improbable-eng/ts-protoc-gen](https://github.com/improbable-eng/ts-protoc-gen) 作为生成插件.

以下面 proto 文件举例:

```proto
syntax = "proto3";

package pb;

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

生成脚本为:

```bash
# Path to this plugin, Note this must be an abolsute path on Windows (see #15)
PROTOC_GEN_TS_PATH="./node_modules/.bin/protoc-gen-ts"
# Path to the grpc_node_plugin
PROTOC_GEN_GRPC_PATH="./node_modules/.bin/grpc_tools_node_protoc_plugin"
OUT_DIR="./src/generated"

protoc \
    --plugin="protoc-gen-ts=${PROTOC_GEN_TS_PATH}" \  # 生成消息类型 .js 和 .d.ts 文件
    --plugin="protoc-gen-grpc=${PROTOC_GEN_GRPC_PATH}" \ # 生成 grpc 相关 .js
    --js_out="import_style=commonjs,binary:${OUT_DIR}" \
    --ts_out="service=grpc-node,mode=grpc-js:${OUT_DIR}" \ # 传递参数, 生成 grpc .d.ts 文件, 并指明我们使用的是 @grpc/grpc-js
    --grpc_out="grpc_js:${OUT_DIR}" \
    hello.proto
```

运行后会生成这四个文件:

```bash
$ tree ./src/generated
./src/generated
├── hello_grpc_pb.d.ts # grpc 相关
├── hello_grpc_pb.js # grpc 相关
├── hello_pb.d.ts # 消息相关
└── hello_pb.js # 消息相关
```

只关注生成出来的类型文件:

```ts
// hello_pb.d.ts
// 生成出来的 message 类型
export class EchoRequest extends jspb.Message {
  getMessage(): string
  setMessage(value: string): void

  serializeBinary(): Uint8Array
  toObject(includeInstance?: boolean): EchoRequest.AsObject
  // ... 忽略一些别的方法
}
```

```ts
// hello_grpc_pb.d.ts
// server 需要实现的接口
export interface IHelloServer extends grpc.UntypedServiceImplementation {
  echo: grpc.handleUnaryCall<hello_pb.EchoRequest, hello_pb.EchoRequest>
  serverStream: grpc.handleServerStreamingCall<
    hello_pb.EchoRequest,
    hello_pb.EchoRequest
  >
  clientStream: grpc.handleClientStreamingCall<
    hello_pb.EchoRequest,
    hello_pb.EchoRequest
  >
  duplexStream: grpc.handleBidiStreamingCall<
    hello_pb.EchoRequest,
    hello_pb.EchoRequest
  >
}

// client 类型, 省略掉一些重载方法
export class HelloClient extends grpc.Client {
  constructor(
    address: string,
    credentials: grpc.ChannelCredentials,
    options?: object
  )
  echo(
    argument: hello_pb.EchoRequest,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<hello_pb.EchoRequest>
  ): grpc.ClientUnaryCall
  serverStream(
    argument: hello_pb.EchoRequest,
    metadata?: grpc.Metadata | null,
    options?: grpc.CallOptions | null
  ): grpc.ClientReadableStream<hello_pb.EchoRequest>
  clientStream(
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<hello_pb.EchoRequest>
  ): grpc.ClientWritableStream<hello_pb.EchoRequest>
  duplexStream(
    metadata?: grpc.Metadata | null,
    options?: grpc.CallOptions | null
  ): grpc.ClientDuplexStream<hello_pb.EchoRequest, hello_pb.EchoRequest>
}
```
