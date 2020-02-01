---
title: 'NodeJS 如何实现 "ThreadLocal"'
date: 2020-02-01T15:52:04+08:00
categories:
  - NodeJS
tags:
  - NodeJS
draft: false
---

提起 `ThreadLocal` 这个词，线程局部存储，Java 的朋友们可能很熟悉。从名字看就可以看出来应该是多线程语言的 “特权”，大家都知道 NodeJS 是单线程的，那么它与 NodeJS 又有什么关系呢？

<!--more-->

## 关于 ThreadLocal

多线程语言的 http server 为了提高性能，会使用多线程来处理请求，线程往往就像 worker 一样处理着请求，**一般**来说一个请求整个生命周期会在同一个线程中，那么此时，使用 `ThreadLocal` 来传递请求上下文，tracing 信息之类的就很方便了。也就是我们可以不用向 `golang` 那样显示传递这些上下文信息。

那么 NodeJS 虽然是单线程，但是它使用 `异步` 的方式提升性能，所以请求处理器也就是一堆异步同步函数的调用，假如异步调用能够追踪，我们也就可以实现类似于多线程语言的 `ThreadLocal` 了，不过我们只是隔离相同异步函数的 “并发” 调用。

## Async Hooks

NodeJS 在 8.1 版本引入了一个新的 API -- [Async Hooks](https://nodejs.org/dist/latest-v13.x/docs/api/async_hooks.html)。官方对它的介绍是：‘async_hooks 用来追踪 Node.js 中异步资源的生命周期’。

`async_hooks.createHook` 可以允许我们注册 4 个方法来跟踪所有异步资源的初始化（init），回调前（before），回调后（after），销毁后（destroy）事件。

我们引用官方事例了解一下：

```js
let indent = 0
async_hooks
  .createHook({
    init(asyncId, type, triggerAsyncId) {
      const eid = async_hooks.executionAsyncId()
      const indentStr = ' '.repeat(indent)
      fs.writeSync(
        1,
        `${indentStr}${type}(${asyncId}):` +
          ` trigger: ${triggerAsyncId} execution: ${eid}\n`
      )
    },
    before(asyncId) {
      const indentStr = ' '.repeat(indent)
      fs.writeFileSync('log.out', `${indentStr}before:  ${asyncId}\n`, {
        flag: 'a',
      })
      indent += 2
    },
    after(asyncId) {
      indent -= 2
      const indentStr = ' '.repeat(indent)
      fs.writeFileSync('log.out', `${indentStr}after:  ${asyncId}\n`, {
        flag: 'a',
      })
    },
    destroy(asyncId) {
      const indentStr = ' '.repeat(indent)
      fs.writeFileSync('log.out', `${indentStr}destroy:  ${asyncId}\n`, {
        flag: 'a',
      })
    },
  })
  .enable()

require('net')
  .createServer(() => {})
  .listen(8080, () => {
    // Let's wait 10ms before logging the server started.
    setTimeout(() => {
      console.log('>>>', async_hooks.executionAsyncId())
    }, 10)
  })

// nc localhost:8080
// output:
//
// TCPSERVERWRAP(5): trigger: 1 execution: 1
// TickObject(6): trigger: 5 execution: 1
// before:  6
//   Timeout(7): trigger: 6 execution: 6
// after:   6
// destroy: 6
// before:  7
// >>> 7
//   TickObject(8): trigger: 7 execution: 7
// after:   7
// before:  8
// after:   8
```

**注意：** 官方文档提醒我们这一点，`createHook` 中我们不能使用 `console.log` 打印，因为 NodeJS 中 `console.log` 也是异步的，如果使用会发生递归。

解释一下这个输出：

1. 为了实现异步追踪，NodeJS 为每个函数（无论同步或异步）提供了一个 `async scope`，我们可以使用 `async_hooks.executionAsyncId()` 获取当前作用域的 async scope id 也就是 `asyncId`, 使用 `async_hooks.triggerAsyncId()` 可以获取调用者的 asyncId

2. 异步资源创建时，会触发 init 事件，该事件会穿给我们当前 scope 的 `asyncId` 和 `triggerAsyncId` （还有资源类型 type 和资源 resource），别的事件均只会收到 `asyncId` 这一个参数

3. 我们可以看出上面的调用关系为: 7 -> 6 -> 5 -> 1

4. 最外层的作用域总为 1，并且别的异步资源创建时 `asyncId` 递增

这几点对我们下面实现 “ThreadLocal” 很重要。

## 如何实现

先理一下思路，由于 NodeJS 是单线程，并且我们可以得到异步调用的关系，那么我们就可以建立一个以 `asyncId` 为 key 的全局 `Map` 来保存这些关系并继承调用方的上下文数据，再维护一个 “正在执行的 asyncId”，同一时刻执行的函数是唯一的，所以对应的 `asyncId` 也是唯一的，那么用它拿到的上下文数据就是与之对应的了。

### 首先，定义数据类型

```ts
interface HookInfo<T = any> {
  id: number // asyncId
  triggerId: number // triggerAsyncId, 也就是调用者（父）的 asyncId
  activated: boolean // 有没有保存调用关系和继承父 scope 的数据
  parent?: HookInfo<T> // 父 scope 的信息
  contextData?: T // 用来存放 “ThreadLocal” 值
}
```

### 建立全局 Map，并初始化

```ts
const ROOT_ID = 1

class Context<T = any> {
  private readonly hookMap = new Map<number, HookInfo<T>>()
  private currentId: number = ROOT_ID

  constructor() {
    // 存储 root 节点的信息
    this.hookMap.set(ROOT_ID, { id: ROOT_ID, triggerId: 0, activated: true })
    // 初始化 hook 下面说
    this.setupHook()
  }
}
```

### 初始化 hook

```ts
private setupHook() {
  createHook({
    init: (asyncId, _, triggerId) => {
      // 使用 triggerId 查询调用者信息
      let parent = this.hookMap.get(triggerId)
      if (!parent) {
        // 如果没有，指定 root 为调用者
        triggerId = ROOT_ID
        parent = this.hookMap.get(ROOT_ID)
      }

      // 保存当前 asyncId 的 hook 信息
      this.hookMap.set(asyncId, {
        id: asyncId,
        activated: false,
        parent,
        triggerId
      })
    },
    before: asyncId => {
      // 设置正在执行的 scope id 为当前 asyncId
      this.currentId = asyncId
      // 获取初始化时保存的 hook 信息
      const hookInfo = this.hookMap.get(asyncId)
      if (hookInfo) {
        // 如果没有处理关系则处理父子关系
        if (!hookInfo.activated) {
          // 查询调用者的 hook 信息, 有则保存该信息
          const parent = this.findActivatedNode(hookInfo)
          if (parent) {
            hookInfo.parent = parent // 保存关系
            hookInfo.triggerId = parent.id // 保存关系
            hookInfo.contextData = parent.contextData // 继承调用者的 scope contextData
          }
        }
        // 标记为处理完成
        hookInfo.activated = true
      }
    },
    after: asyncId => {
      if (asyncId === this.currentId) {
        // 回调已调用，初始化 currentId 为 root
        this.currentId = ROOT_ID
      }
    },
    destroy: asyncId => {
      // 资源销毁，删除该 id 的 hook 信息，防止内存泄露
      this.hookMap.has(asyncId) && this.hookMap.delete(asyncId)
    }
  }).enable()
}

private findActivatedNode(hi: HookInfo<T>): HookInfo<T> {
  if (!hi) {
    // 空则返回 root
    return this.hookMap.get(ROOT_ID)
  }
  if (hi.activated) {
    // 已经处理过关系，返回当前值
    return hi
  }
  // 递归查找 parent
  return this.findActivatedNode(hi.parent)
}
```

### 暴露 ContextData 读写 API

```ts
// 均使用 currentId 查询信息并操作

// 读取 contextData
getContextData() {
  const hi = this.hookMap.get(this.currentId)
  return hi && hi.contextData
}

// 写入 contextData
setContextData(data: T) {
  const hi = this.hookMap.get(this.currentId)
  if (hi) {
    hi.contextData = data
  }
}
```

接着我们可以验证下：

```ts
const delay = (n: number) => new Promise(resolve => setTimeout(resolve, n))

const ctx = new Context<any>()

const child = async (i: string) => {
  console.log('child start >>>>> ', i, ctx.getContextData())
  await delay(500)
  console.log('child end >>>>> ', i, ctx.getContextData())
}

const childSet = async (i: string) => {
  ctx.setContextData('test-childSet-' + i)
  console.log('childSet start >>>>> ', i, ctx.getContextData())
  await delay(1000)
  console.log('childSet end >>>>> ', i, ctx.getContextData())
}

const run = async (i: string) => {
  ctx.setContextData('test-' + i)
  await child(i)
  await childSet(i)
}

Promise.all([
  Promise.resolve().then(() => run('1')),
  Promise.resolve().then(() => run('2')),
])

// output
//
// child start >>>>>  1 test-1
// child start >>>>>  2 test-2
// child end >>>>>  1 test-1
// childSet start >>>>>  1 test-childSet-1
// child end >>>>>  2 test-2
// childSet start >>>>>  2 test-childSet-2
// childSet end >>>>>  1 test-childSet-1
// childSet end >>>>>  2 test-childSet-2
```

可以看出两次调用，各自的 contextData 确实做到了隔离。

上述完整代码见 [Gist](https://gist.github.com/zcong1993/dfa358e7b41eda65a5e6a14eac14e422)。

## 应用

这样的功能可以在哪些场景下使用呢？

最基本的就是在 web server 中传递上下文，可以传递 requestId 之类的 tracing 信息，然后 logger， http client, rpc client 就可以轻松拿到这些信息了。具体应用后续会列出一点点。

NodeJS 社区著名 ORM 库 `Sequelize` 也在使用此种技术管理事务，自动传递事务参数，见[文档](https://sequelize.org/v5/manual/transactions.html)。

## 后记

虽然这个功能仍然是 `实验性` 的，但是相信不久就会稳定。如果你想使用，可以使用这个现成库 [node-async-context](https://github.com/gms1/node-async-context)，本文的实现方式也是学习了此项目。
