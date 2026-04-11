---
title: koa graphql server 支持 application/graphql
date: '2017-06-25'
categories:
  - NodeJS
  - GraphQL
tags:
  - NodeJS
  - GraphQL
  - Koa2
  - Middleware
draft: false
---

> 本文需要您对 graphql 有基本的了解

graphql 服务端有两个很方便的库，[express-graphql](https://github.com/graphql/express-graphql) 和 [apollo-server](https://github.com/apollographql/apollo-server)。

`express-graphql`默认支持`application/graphql`， 而`apollo-server`中的库都不支持，我们可以自行实现。

<!--more-->

## 首先，我们做一个简单的 graphql 服务

```js
const Koa = require('koa')
const Router = require('koa-router')
const bodyParser = require('koa-bodyparser')
const { graphqlKoa, graphiqlKoa } = require('graphql-server-koa')
const { buildSchema } = require('graphql')

const app = new Koa()
const router = new Router()

const schema = buildSchema(`
type Query {
  hello: String
}
`)

const root = {
  hello() {
    return 'hello'
  },
}

app.use(bodyParser())

router.get('/graphql', graphiqlKoa({ endpointURL: '/graphql' }))
router.post(
  '/graphql',
  graphqlKoa({
    schema: schema,
    rootValue: root,
  })
)

app.use(router.routes())
app.listen(3000, () => console.log(`listening on port 3000`))
```

打开`http://localhost:3000/graphql`，测试一下 graphiql，请求：

```json
{
  hello
}
```

使用 http 请求(application/json)：

```js
fetch('http://localhost:3000/graphql', {
  method: 'post',
  body: JSON.stringify({ query: '{ hello }' }),
  headers: {
    'Content-Type': 'application/json',
  },
})
  .then((r) => r.json())
  .then((d) => console.log(d.data))
// {hello: "hello"}
```

## 对比分析两种格式参数

`graphql`: `{ hello }`

`json`: `{ query: '{ hello }' }`

其实就是自动包装了一层`{ query: value }`，所以我们自己写个中间件来实现。

## graphql 中间件

bodyparser 处理`application/json`请求，其实就是从请求中得到原始 body 然后 parse，将结果传给`ctx.request.body`，同理我们要做的就是将请求包装一层，然后传给`ctx.request.body`。

首先，我们使用现成的 bodyparser 以处理`text/plain`请求的方式得到请求体；

```js
# bodyparser需要这样使用
app.use(bodyParser({
  enableTypes: ['json', 'text'],
  extendTypes: {
    text: ['application/graphql'],
    json: ['application/json']
  }
}))
```

接着书写我们的中间件：

```js
const parseGraphql = async (ctx, next) => {
  // 如果是'application/graphql'请求，就包装一层
  if (ctx.request.is('application/graphql')) {
    ctx.request.body = { query: ctx.request.body }
  }
  await next()
}
```

中间件要放在 bodyparser 之后，最好不要放在全局。

```js
router.post(
  '/graphql',
  parseGraphql,
  graphqlKoa({
    schema: schema,
    rootValue: root,
  })
)
```

此时，我们的请求就变成了这样

```js
fetch('http://localhost:3000/graphql', {
  method: 'post',
  body: '{hello}',
  headers: {
    'Content-Type': 'application/graphql',
  },
})
  .then((r) => r.json())
  .then((d) => console.log(d.data))
// {hello: "hello"}
```

## 为什么

- 首先，简洁，能够和`graphiql`统一
- 其次，减少了了复杂请求引号嵌套问题

最终完整代码：

```js
const Koa = require('koa')
const Router = require('koa-router')
const bodyParser = require('koa-bodyparser')
const { graphqlKoa, graphiqlKoa } = require('graphql-server-koa')
const { buildSchema } = require('graphql')

const app = new Koa()
const router = new Router()

const schema = buildSchema(`
type Query {
  hello: String
}
`)

const root = {
  hello() {
    return 'hello'
  },
}

app.use(
  bodyParser({
    enableTypes: ['json', 'text'],
    extendTypes: {
      text: ['application/graphql'],
      json: ['application/json'],
    },
  })
)

const parseGraphql = async (ctx, next) => {
  // 如果是'application/graphql'请求，就包装一层
  if (ctx.request.is('application/graphql')) {
    ctx.request.body = { query: ctx.request.body }
  }
  await next()
}

router.get('/graphql', graphiqlKoa({ endpointURL: '/graphql' }))
router.post(
  '/graphql',
  parseGraphql,
  graphqlKoa({
    schema: schema,
    rootValue: root,
  })
)

app.use(router.routes())
app.listen(3000, () => console.log(`listening on port 3000`))
```
