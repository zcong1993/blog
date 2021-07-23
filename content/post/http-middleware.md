---
title: 'Http Middleware'
date: 2019-07-28T01:27:39+08:00
categories: [NodeJS, Golang]
tags: [NodeJS, Golang]
draft: false
---

接触过 web 服务编程的人对中间件无人不知无人不晓，那么这么常见的东西本质是什么样子的呢？下面我们简单了解一下。

<!--more-->

## 原理

要说中间件，还得从 `http handler` 说起，来看一个最基本的 web 服务代码：

```js
const http = require('http')

// http handler function
const handler = async (req, res) => {
  console.log('handler')
  res.end('hello world!')
}

const server = http.createServer(handler)

server.listen(3000)
// curl localhost:3000
// got: hello world!
```

可以看到 `http handler` 接收两个参数，`request` 和 `response` 对象，要做的事情就是根据 `request` 调整处理逻辑，然后将响应写入 `response`。

那么中间件其实就是一个 `HOF(高阶函数)` 接收一个 `http handler` 返回一个 `http handler`。

例如：

```js
// ...
const helloMw = (handler) => async (req, res) => {
  console.log('helloMw start')
  await handler(req, res)
  console.log('helloMw end')
}
const server = http.createServer(helloMw(handler))
// ...
// output:
// helloMw start
// handler
// helloMw end
```

可以看到中间件代码包裹着真正的逻辑处理代码，中间件就是通过自己的逻辑修改 request 和 response 这两个对象工作的。

那么我们再加一个中间件吧：

```js
// ...
// 再高阶一层，相当于工厂函数，能够根据不同的 options 控制中间件行为
const mw2 = (options) => (handler) => async (req, res) => {
  console.log('mw2 start', options)
  await handler(req, res)
  console.log('mw2 end', options)
}
const server = http.createServer(mw2('test options')(helloMw(handler)))
// ...
// mw2 start test options
// helloMw start
// handler
// helloMw end
// mw2 end test options
```

可以看到请求的顺序是 `mw2 -> helloMw -> handler -> helloMw -> mw2`，很熟悉吧，就是 `koa` 框架所说的“剥洋葱”模型。

## 中间件管理器

上面例子可以看出，随着中间件数量的增加，嵌套调用很不优雅，看起来也很困难，所以我们写一个方法整理一下：

```js
// ...
const wrapper = (handler, mws = []) => {
  let h = handler
  mws.forEach((mw) => {
    // 嵌套调用
    h = mw(h)
  })

  // 返回嵌套之后的 http handler function
  return h
}
const server = http.createServer(
  wrapper(handler, [helloMw, mw2('test options')])
)
// ...
// mw2 start test options
// helloMw start
// handler
// helloMw end
// mw2 end test options
```

从结果来看，请求依次经过了两个中间件，但是美中不足的是调用顺序与声明顺序相反了，因为我们把后面中间件包裹到了外层，所以修改一下：`mws.forEach -> mws.reverse().forEach`。这样结果就正确了。

怎么样能够更优雅呢？整理一下代码：

```js
// ...
class MwManager {
  constructor() {
    this.mws = []
  }

  use(mw) {
    // type check
    if (typeof mw !== 'function') {
      throw new Error('mw must be function')
    }
    this.mws.push(mw)
    return this
  }

  wrapper(handler) {
    let h = handler
    this.mws.reverse().forEach((mw) => {
      h = mw(h)
    })
    return h
  }
}

const mwm = new MwManager()
mwm.use(helloMw)
mwm.use(mw2('test options'))

const server = http.createServer(mwm.wrapper(handler))
// ...
```

效果还是相同的，API 修改成了大家熟悉的样子了。

## 总结

`http middleware` 其实一点也不神秘，如果理解 `HOF` 就很容易理解，`Go 语言`中间件形式也是这样的，大家可以自行尝试。
