---
title: 服务端超时控制
date: 2021-10-18T19:01:32+08:00
cover: /stone-cladding-wall-2210x1658.jpeg
description: 服务端的资源是有限的, 处理已经超时的请求是没任何意义的. 超时控制是保障服务稳定的一道重要防线, 本质是快速失败节省资源.
categories:
  - Golang
  - NodeJS
tags:
  - Golang
  - NodeJS
  - gRPC
keywords:
  - Golang
  - NodeJS
  - gRPC
  - timeout
draft: false
---

服务端的资源是有限的, 处理已经超时的请求是没任何意义的. 超时控制是保障服务稳定的一道重要防线, 本质是快速失败节省资源.

<!--more-->

## Golang

go 语言超时控制一般使用 `context` 来传递, `context.WithTimeout` 用来创建一个有超时控制的 context.

- context.Done() 返回一个 channel, timeout 或者 cancel 时会收到信号
- context.Err() 在 timeout 或者 cancel 时返回非 nil 值

### http server

http 标准库中有一个中间件 [TimeoutHandler](https://github.com/golang/go/blob/cf51fb5d680a9a1ca98af3361e65722d07bff111/src/net/http/server.go#L3323), 实现也是非常简单:

```go
func (h *timeoutHandler) ServeHTTP(w ResponseWriter, r *Request) {
  ctx := h.testContext
  if ctx == nil {
    var cancelCtx context.CancelFunc
    ctx, cancelCtx = context.WithTimeout(r.Context(), h.dt)
    defer cancelCtx()
  }
  // 将有 timeout 的 context 设置给 request
  // 后续我们自己 handler 中的 request.Context 也就有 timeout 了
  // 所以用了 request.Context 也会在超时时收到 done 信号
  r = r.WithContext(ctx)
  done := make(chan struct{})
  tw := &timeoutWriter{
    w:   w,
    h:   make(Header),
    req: r,
  }
  panicChan := make(chan interface{}, 1)
  go func() {
    defer func() {
      if p := recover(); p != nil {
        panicChan <- p
      }
    }()
    h.handler.ServeHTTP(tw, r)
    close(done)
  }()
  select {
  case p := <-panicChan:
    panic(p)
  case <-done:
    tw.mu.Lock()
    defer tw.mu.Unlock()
    dst := w.Header()
    for k, vv := range tw.h {
      dst[k] = vv
    }
    if !tw.wroteHeader {
      tw.code = StatusOK
    }
    w.WriteHeader(tw.code)
    w.Write(tw.wbuf.Bytes())
  case <-ctx.Done(): // 超时时会返回 503
    tw.mu.Lock()
    defer tw.mu.Unlock()
    w.WriteHeader(StatusServiceUnavailable)
    io.WriteString(w, h.errorBody())
    tw.timedOut = true
  }
}
```

我们在业务 handler 中使用 io 操作时注意使用 `request.Context()`, 有利于回收资源.

### grpc

grpc server 没有像 http.TimeoutHandler 那样直接支持超时处理, 但是会自动将 client `request context` 中的 timeout 通过 header 传递给 server 端, server 端则会将这个超时时间设置为当前请求处理器的超时时间.

```go
// server 端, 拿到 header 中的 timeout 并设置
if v := r.Header.Get("grpc-timeout"); v != "" {
  to, err := decodeTimeout(v)
  if err != nil {
    return nil, status.Errorf(codes.Internal, "malformed time-out: %v", err)
  }
  st.timeoutSet = true
  st.timeout = to
}
```

[internal/transport/handler_server.go#L79](https://github.com/grpc/grpc-go/blob/4757d0249e2d5d16f259ce4224f7ec5fb7f284ee/internal/transport/handler_server.go#L79)

```go
// client 如果 ctx 参数有 deadline, 将超时通过 header 传递出去
if dl, ok := ctx.Deadline(); ok {
  // Send out timeout regardless its value. The server can detect timeout context by itself.
  // TODO(mmukhi): Perhaps this field should be updated when actually writing out to the wire.
  timeout := time.Until(dl)
  headerFields = append(headerFields, hpack.HeaderField{Name: "grpc-timeout", Value: grpcutil.EncodeDuration(timeout)})
}
```

[internal/transport/http2_client.go#L512](https://github.com/grpc/grpc-go/blob/4757d0249e2d5d16f259ce4224f7ec5fb7f284ee/internal/transport/http2_client.go#L512)

但是也可以实现一个 `timeout interceptor`, 例如 go-zero 框架:

[https://github.com/zeromicro/go-zero/blob/265b1f2459eb77c7dd03d0d3fbb109ca7f19a94d/zrpc/internal/serverinterceptors/timeoutinterceptor.go#L16](https://github.com/zeromicro/go-zero/blob/265b1f2459eb77c7dd03d0d3fbb109ca7f19a94d/zrpc/internal/serverinterceptors/timeoutinterceptor.go#L16)

也是一个很经典的 go 语言超时处理.

## NodeJS

node js 中 `abort controller` 还没完全稳定和广泛使用, 所以 timeout 传递没有太大的意义(资源没办法回收), client 端把握好超时时间一般来说不会有太大问题.

假如 abort controller 普及了, 就可以像 go 语言那样, 为每个请求创建一个 `request.abortController` (或者使用 async_hooks 隐式共享) 在后续 handler 中的 io 操作中共享, 这样超时控制器可以作为一个中间件, 在超时响应错误的同时调用 `abortController.abort()` 回收资源.

### 服务间传递

可以写一个请求级别的 `TimeoutManager` 管理该请求的超时状态.

```ts
export class TimeoutManager {
  /**
   * dealine 表示超时的时间戳
   */
  private deadline: number
  constructor(timeoutMs: number) {
    this.updateTimeout(timeoutMs)
  }

  /**
   * 更新超时时间
   * @param timeoutMs - 超时, 单位 ms
   */
  updateTimeout(timeoutMs: number) {
    this.deadline = TimeoutManager.timeout2Deadline(timeoutMs)
  }

  /**
   * 尝试更新 deadline, timeout 会更新为比较小的那一个
   */
  shrinkDeadline(timeoutMs: number) {
    const deadline2 = TimeoutManager.timeout2Deadline(timeoutMs)
    this.deadline = Math.min(deadline2, this.deadline)
  }

  /**
   * 获取 deadline 超时时间
   * @returns Date
   */
  getDeadline() {
    return new Date(this.deadline)
  }

  /**
   * 现在是否已经超时
   * @returns
   */
  done() {
    return this.deadline <= Date.now()
  }

  /**
   * 获取当前还剩多少超时时间, 0 表示已经没有时间了
   * 一般会先调用 done 查看是否还有时间
   * @returns ms
   */
  getTimeout() {
    return Math.max(this.deadline - Date.now(), 0)
  }

  static timeout2Deadline(timeoutMs: number) {
    return Date.now() + timeoutMs
  }
}
```

单服务内部使用 async_hooks 共享一个请求级别的 `TimeoutManager` 用来判断任意时刻是否还有剩余时间做操作, 服务设置一个保底的全局 timeout.

跨服务请求时, 可以使用 header 传递超时时间:

1. client 端, 发送 http 请求时使用 `timeoutManager.getTimeout()` 获取当前剩余超时时间, 放入 header 中传递给 server
2. server 端在全局超时中间件中, 拿到 request header 中的 timeout, 使用 `timeoutManager.shrinkDeadline(timeout)` 将当前请求的超时时间设置为 client 超时和全局超时中较小值

## 参考资料

- [https://mp.weixin.qq.com/s/BERHvjCbxTCEUF8glOBqBg](https://mp.weixin.qq.com/s/BERHvjCbxTCEUF8glOBqBg)

![wxmp](/wxmp_tiny_1.png)
