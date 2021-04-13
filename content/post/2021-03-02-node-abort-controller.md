---
title: NodeJS 新特性 AbortController
date: 2021-03-02T23:25:10+08:00
cover: /node-abort-controller.jpeg
description: NodeJS 15.0.0 版本增加了一个很有意思的新特性 AbortController, 主要是用来撤销某些正在运行的 Promise.
categories:
  - NodeJS
tags:
  - NodeJS
  - AbortController
draft: false
---

NodeJS `15.0.0` 版本增加了一个很有意思的新特性 [AbortController](https://nodejs.org/dist/latest-v15.x/docs/api/globals.html#globals_class_abortcontroller), 主要是用来撤销某些正在运行的 `Promise`.

<!--more-->

[AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) 最早是浏览器支持的一个 API, 主要是用来终止 Web 请求. 扩展到 NodeJS 中就是用来撤销一些异步 IO 操作或者 timer, 提高资源利用率, 相比之下服务端是集中化的资源, 更需要此 API.

## 基本用法

`AbortController` 是一个全局类, 可以直接使用.

```js
const ac = new AbortController()

ac.signal.addEventListener('abort', () => console.log('Aborted!'), {
  once: true,
})

ac.abort()

console.log(ac.signal.aborted) // Prints true
```

`abortController.signal` 是一个 `EventTarget` 用来通知 abort 事件, 同时我们也可以使用 `ac.signal.aborted` 来判断一个 controller 是否已经取消, 调用 `abortController.abort()` 方法会触发 abort 事件, 并且 signal 状态也会切换.

在实际使用时, 都是将 `signal` 作为额外参数传入支持此功能的 API 方法中, 例如下面是一个撤销 timer 的例子:

```js
// promise 版的 timer API, 支持 abortController
const timersPromises = require('timers/promises')

const ac = new AbortController()
const signal = ac.signal

const main = async () => {
  // 2 秒后撤销
  setTimeout(() => ac.abort(), 2000)
  try {
    console.time('test')
    // 开启一个 10s 的 timeout, 将 signal 传入
    await timersPromises.setTimeout(10000, true, { signal })
  } catch (err) {
    console.timeLog('test', err)
  } finally {
    console.timeEnd('test') // 退出时打印耗时
  }
}

main()
// ❯ node main.js
// test: 2.005s AbortError: The operation was aborted
//     at Timeout.cancelListenerHandler (node:timers/promises:30:12)
//     at EventTarget.[nodejs.internal.kHybridDispatch] (node:internal/event_target:459:20)
//     at EventTarget.dispatchEvent (node:internal/event_target:407:26)
//     at abortSignal (node:internal/abort_controller:81:10)
//     at AbortController.abort (node:internal/abort_controller:94:13)
//     at Timeout._onTimeout (/Users/cong/zcong/test/js-repl/ac.js:7:23)
//     at listOnTimeout (node:internal/timers:557:17)
//     at processTimers (node:internal/timers:500:7) {
//   code: 'ABORT_ERR'
// }
// test: 2.014s
```

上面代码会在 `2s` 时结束, `timersPromises.setTimeout` 会 throw 一个 `AbortError: The operation was aborted` 错误.

## API 现状

目前只有部分 API 支持此功能, 可以在 [nodejs/node](https://github.com/nodejs/node/search?q=AbortSignal&type=commits) 官方仓库搜索此特性相关提交.

稍微列举一下:

1. fs/fsPromises 部分 API
1. timers/promises
1. http/http2 client
1. child_process
1. stream
1. dgram

## 实现原理

`AbortController` 源码可以看 [abort_controller.js](https://github.com/nodejs/node/blob/f6b1df2226/lib/internal/abort_controller.js), 也可以看这个实现 [mysticatea/abort-controller](https://github.com/mysticatea/abort-controller). 实现非常简单而且上面也大概提到了, 所以这里不在赘述. 着重介绍标准库如何集成支持 AbortController.

### 1. [timersPromises.setTimeout](https://github.com/nodejs/node/blob/f6b1df2226/lib/timers/promises.js#L34)

```js
function setTimeout(after, value, options = {}) {
  const { signal, ref = true } = options
  // 1. 校验 signal 合法性
  try {
    validateAbortSignal(signal, 'options.signal')
  } catch (err) {
    return PromiseReject(err)
  }
  // 2. 如果 signal 已经撤销, 直接 throw
  if (signal?.aborted) {
    return PromiseReject(new AbortError())
  }
  let oncancel
  const ret = new Promise((resolve, reject) => {
    // 3. 执行真正逻辑
    const timeout = new Timeout(resolve, after, args, false, true)
    if (!ref) timeout.unref()
    insert(timeout, timeout._idleTimeout)
    // 4. 如果有 signal, 将 clearTimeout 绑定在 abort 事件上
    if (signal) {
      oncancel = FunctionPrototypeBind(
        cancelListenerHandler,
        timeout,
        clearTimeout,
        reject
      )
      signal.addEventListener('abort', oncancel)
    }
  })

  // 5. 如果有 signal, 清理 EventListener
  return oncancel !== undefined
    ? PromisePrototypeFinally(ret, () =>
        signal.removeEventListener('abort', oncancel)
      )
    : ret
}
```

上面代码删减了部分不相关代码, 总结下来实现需要 5 步:

1. 校验 signal 是否合法
1. 执行操作前, 检查 signal 是否已经是 aborted 状态, 如果是直接 throw AbortError
1. 执行真正操作(异步)
1. 将终止方法绑定在 abort 事件上面, abort 触发时也会 throw AbortError
1. 清理 EventListener

### 2. [fsPromises.readFile](https://github.com/nodejs/node/blob/f6b1df2226/lib/internal/fs/promises.js#L297)

```js
async function readFileHandle(filehandle, options) {
  const signal = options?.signal

  // 1. 如果 signal 已经撤销, 直接 throw
  if (signal?.aborted) {
    throw lazyDOMException('The operation was aborted', 'AbortError')
  }
  const statFields = await binding.fstat(filehandle.fd, false, kUsePromises)
  // 2. 再次检查 signal 状态
  if (signal?.aborted) {
    throw lazyDOMException('The operation was aborted', 'AbortError')
  }
  do {
    // 3. chunk read 前检查 signal 状态
    if (signal?.aborted) {
      throw lazyDOMException('The operation was aborted', 'AbortError')
    }
    const { bytesRead, buffer } = await read(filehandle, buf, 0, buf.length, -1)
  } while (!endOfFile)

  const result = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)

  return options.encoding ? result.toString(options.encoding) : result
}
```

上面代码删减了不相关代码, `fsPromises.readFile` 核心通过 `readFileHandle` 方法实现, 总结一下就是带缓冲的 read, 每次异步 read chunk 直到文件读完, 最后将内容返回. 因此更加简单, 总结下来只需要两步:

1. 执行操作前, 检查 signal 是否已经是 aborted 状态, 如果是直接 throw AbortError
1. 同步循环每次操作前检查 signal 是否已经是 aborted 状态

整个总结下来, 其实实现原理都和上面两种方式一样, 也就是: `异步监听事件, 同步循环在循环间检查状态`.

## 对比 Go 语言

熟悉 go 语言的朋友看到这个肯定会想到 `context`, context 的一个很大的作用就是在不同 Goroutine 之间同步取消信号来减少资源浪费. 本文所讲的 AbortController 相当于 `context.WithCancel`, 当然 go 语言的 context 功能更加复杂, 是一个树形结构, 但是在用法上思想其实是相通的.

```go
// 同步在 for 循环间检查是否已取消
for {
  if ctx.Err() != nil {
    // 取消了
    return
  }
  // 逻辑代码
}

// 同步 2, 使用 select default
for {
  select {
    case <- ctx.Done():
      // 取消了
      return
    default:
      // 逻辑代码
  }
}

// 并发
select {
  case <- ctx.Done():
    // 取消了
    return
  case <- otherCh:
    // 逻辑代码
}
```

## 总结

服务端资源是中心化, 所以我们在写代码时应该考虑资源利用情况, `AbortController` 填补了 NodeJS 在这方面的不足. 想象一下在实现网关时我们会有很多并发聚合 http 调用, 一个请求出错时就可以撤销其他的请求了.

对比 go 语言, context 已经非常成熟, 基本已经是 io 操作函数的第一个参数标配了, 期待 AbortController 在 NodeJS 社区广泛支持的这一天早点到来.
