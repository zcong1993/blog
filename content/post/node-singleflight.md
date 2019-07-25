---
title: 'Node Singleflight'
date: 2019-07-26T00:59:12+08:00
categories:
  - NodeJS
  - JavaScript
draft: false
---

什么是 `singleflight` ？

这里引用 `go` 语言的描述：`singleflight` 为重复函数调用提供抑制机制，通俗的讲就是短时间内同时重复调用同一函数时，确保函数只被调用一次，别的调用 “等待” 调用完成并返回相同结果。

<!--more-->

在我们编写缓存工具时，`singleflight` 往往用来防止并发调用击穿。

想象一个缓存场景：

```js
let cache = null

const call = async () => {
  console.log('called')
  // sleep 1s
  sleep(1000)
  return 'resp'
}

const simpleCache = async fn => {
  // if has cache, return cache
  if (cache) {
    return cache
  }

  // call and set cache
  const res = await fn()
  cache = res
  return res
}

// 并发调用
Array(5)
  .fill(null)
  .forEach(() => {
    simpleCache(call)
  })

// called
// called
// called
// called
// called
```

可以看到，`call` 函数被并发调用了 5 次， 也就是我们的缓存没有效果。

那么我们怎么才能做到，让第一次调用真正调用请求，剩下的等待呢？

## 实现

### 1. 轮询等待

```js
let lock = null

const simpleCache = async fn => {
  // 第一次调用，抢到锁的真正执行并设置缓存
  if (!cache && !lock) {
    lock = true
    return fn().then(res => {
      cache = res
      return res
    })
  }

  while (true) {
    // 有缓存，返回结果
    if (cache) {
      return cache
    }
    // 没有缓存，等待 1s，循环
    await sleep(1000)
  }
}
```

这样仿佛解决了问题，但是直觉上 `sleep` 总感觉是对资源的浪费，而且 sleep 间隔也很难确定合适的，这种方式还有一个致命缺点，缓存往往之缓存正常结果，假如我们调用一直在一秒后失败，那么 cache 永远不会被设置，也就是并发请求会变成 **同步** 执行！所以不要使用上面的代码！

### 2. Promise 实现

```js
// 使用队列
const queue = []
const simpleCache = async fn => {
  if (cache) {
    return cache
  }
  const promise = new Promise(resolve => {
    // 将 resolve 放入队列
    queue.push(resolve)
    // 第一次，真正调用函数
    if (queue.length === 1) {
      fn().then(res => {
        // 执行完成后，调用队列中的 resolve
        queue.map(resolve => resolve(res))
      })
    }
  })
  return promise
}
```

这样就做到了真正的 `singleflight`。

## 更多

我们也可以将 `reject` 放入另一个队列，发生错误时调用，这样出错时我们也只做到了只有一次调用。

这种思路如果明白了同理就能实现很多东西，比如大名鼎鼎的 `dataloader` 原理也是非常简单，之后我会写一篇关于它的文章，我们甚至可以做到将 `ws` 封装成 `HTTP API`，大家可以自己尝试下。
