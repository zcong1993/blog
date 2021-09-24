---
title: Node Grpc Health Check
date: 2021-09-24T11:43:56+08:00
cover: /grpc-health-check.jpeg
description: 本文讲述如何实现 GRPC Health Checking Protocol.
categories:
  - gRPC
  - NodeJS
tags:
  - gRPC
  - NodeJS
keywords:
  - gRPC
  - NodeJS
  - gRPC health check
draft: false
---

健康检查往往用来判断服务是否能够对外正常提供服务, 例如: k8s 中就会用就绪检查和健康检查来判断是否需要重启/剔除 pod.

之前文章也介绍过 gRPC 是客户端负载均衡(简单来说因为长连接基于连接的负载均衡没太大意义), 所以客户端更需要主动感知服务端健康状态的能力. 因此 gRPC 提出了 [GRPC Health Checking Protocol](https://github.com/grpc/grpc/blob/master/doc/health-checking.md).

<!--more-->

## 服务端实现

健康检查协议也是基于 gRPC 调用, 和普通的 gRPC 请求没有区别, 所以服务端需要实现两个 rpc 方法:

```protobuf
message HealthCheckRequest {
  string service = 1;
}

message HealthCheckResponse {
  enum ServingStatus {
    UNKNOWN = 0;
    SERVING = 1;
    NOT_SERVING = 2;
    SERVICE_UNKNOWN = 3;  // Used only by the Watch method.
  }
  ServingStatus status = 1;
}

service Health {
  rpc Check(HealthCheckRequest) returns (HealthCheckResponse);
  rpc Watch(HealthCheckRequest) returns (stream HealthCheckResponse);
}
```

可以看到 `Check` 方法为 `UnaryCall` 类型也就是一应一答式的, 提供给客户端主动检查服务健康状态的能力; 另一个方法 `Watch` 则是 `ServerStream` 类型也就是服务端流, 提供给客户端订阅服务健康状态的能力.

服务端应当实现以下逻辑:

- 空字符串作为 service 时, 应当返回整体健康状态
- 服务端应该主动注册所有 service, 并设置各自状态
- 请求的 service 如果存在于注册表中, 返回 OK 状态的响应, ServingStatus 应该为 SERVING 或者 NOT_SERVING, 不存在则要返回 NOT_FOUND 状态的响应
- 可以自行实现任何 service 名称匹配逻辑, 例如: 精确匹配或者通配符匹配
- 客户端订阅某个服务状态时, 需要立即响应一个当前健康状态, 并且在之后状态发生改变时, 发送新状态消息
- 订阅某个不存在服务时, 立即响应的状态为 SERVICE_UNKNOWN, 因为该服务有可能在之后注册

### 实现思路

这个需求其实非常简单, 我们使用一个哈希表存储注册进来的服务和健康状态, 并对外提供一个签名为 `setStatus(service: string, status: StatusValue): void` 的方法, 用来增加或者更新某个服务的状态.

`Check` 方法非常好实现, 根据请求 service 名称从哈希表中查到服务状态然后响应.

`Watch` 方法实现起来稍微复杂点, 因为我们需要在收到请求时, 直接响应一个当前状态, 并且需要在服务状态发生改变时广播新状态. 相当于 websocket 实现频道推送, 每个 service 类似于一个频道, 客户端订阅请求进来后我们将这个客户端加入到这个频道, 客户端断开连接或者 cancel 时将它从频道剔除, 还需要记录每个客户端最后一次推送的状态值, 我们就可以做到仅在新状态和上次状态不同时推送. 使用 `Map<service, Map<client, lastStatus>>` 来记录服务和订阅者的关系.

watch 仅处理订阅管理和初始状态响应:

```ts
// Watch implements `service Health`.
watch(call: ServerWritableStream<HealthCheckRequest, HealthCheckResponse>) {
  const service = call.request.getService()
  // 惰性创建 map
  if (!this.watchClientsMap.has(service)) {
    this.watchClientsMap.set(service, new Map())
  }

  const serviceClientMap = this.watchClientsMap.get(service)
  const status =
    this._statusMap[service] ??
    HealthCheckResponse.ServingStatus.SERVICE_UNKNOWN
  // 立即发送当前状态
  call.write(this.responseForStatus(status))
  // 保存为该客户端的最后一次推送状态
  serviceClientMap.set(call, status)
  // 客户端断开时, 从订阅 Map 中删除客户端
  call.once('cancelled', () => {
    serviceClientMap.delete(call)
  })
}
```

实现一个 `dispatchNewStatus` 方法在 `setStatus` 被调用时广播新状态:

```ts
private dispatchNewStatus(service: string, status: StatusValue) {
  if (!this.watchClientsMap.has(service)) {
    return
  }

  const serviceClientMap = this.watchClientsMap.get(service)

  for (const call of serviceClientMap.keys()) {
    const lastStatus = serviceClientMap.get(call)
    // 和上次发送状态相同, 跳过
    if (lastStatus === status) {
      continue
    }
    // 更新最新状态
    serviceClientMap.set(call, status)
    // 发送最新状态
    call.write(this.responseForStatus(status))
  }
}
```

再实现两个工具方法:

- `shutdown` 将所有服务状态设置为 `NOT_SERVING`, 主要用来在服务退出前将所有服务标记为不健康
- `resume` 与 `shutdown` 相反, 将所有服务设置为 `SERVING` 状态的响应

完整代码可以查看 [https://github.com/zcong1993/node-grpc-health-check](https://github.com/zcong1993/node-grpc-health-check).

## 其他作用

- 可以在服务压力大或者一些可预知的问题出现时主动将服务端状态设置为不健康, 来主动拒绝请求减少自身压力
- 使得服务端负载均衡器在剔除有问题的服务端时更加灵敏, 主动通知永远比被动感知要灵敏, 例如 grpc-go 就可以设置将健康检查应用于客户端负载均衡中 [grpc/grpc-go/clientconn.go#L1388](https://github.com/grpc/grpc-go/blob/6ff68b489ecba2884aff152835d745389598935a/clientconn.go#L1388)

## 后记

gRPC 不同语言发展状况完全不一样, 在这里我又想吐槽一下 NodeJS 社区, [https://github.com/grpc/grpc-node/tree/master/packages/grpc-health-check](https://github.com/grpc/grpc-node/tree/master/packages/grpc-health-check) 官方实现的健康检查包不但是基于已经弃用的 native grpc-node 库, 而且还是实现的旧版本的协议. 因此我参考 grpc-go 实现了一版, 总之有任何问题参考 grpc-go 实现就完事了.
