---
title: koa + graphql + dataloader
date: '2017-07-20'
categories:
  - NodeJS
  - GraphQL
  - Koa2
  - DataLoader
draft: false
---

> 如果不熟悉 dataloader 和 graphql，请看之前的两篇文章。

dataloader 配合 graphql 使用会使得 schema 定义变得非常简洁清晰。

<!--more-->

## 定义 dataloader 服务

首先需要定义一个 koa-graphql 服务，和之前文章的有些许不同， 之前是使用一个 object 当做数据 store 存在内存， 这次我们使用 sqlite 数据库。

```js
const schema = require('./schema')
const { user, post } = require('./dataloader')

const app = new Koa()
const router = new Router()

app.use(bodyParser())

router.get('/graphql', graphiqlKoa({ endpointURL: '/graphql' }))
router.post(
  '/graphql',
  graphqlKoa({
    schema,
    // 上下文，所有的resolver均可拿到
    context: {
      user,
      post,
    },
  })
)

app.use(router.routes())
app.listen(3000, () => console.log(`listening on port 3000`))
```

将 dataloader 实例传入上下文，可供 resolver 使用，如果不使用 dataloader 也可以传入 db model。

## 定义 schema

```js
// schema.js
const { makeExecutableSchema } = require('graphql-tools')
const rootSchema = [
  `
type User {
  id: Int
  username: String
}
type Post {
  id: Int,
  title: String,
  author_id: Int,
  author: User
}
type Query {
  user(id: Int!): User
  post(id: Int!): Post
}
`,
]
const rootResolvers = {
  Query: {
    // 参数1为前一个对象，此处为Query， 参数2为查询输入参数， 参数3为自定义上下文对象
    user: (_, { id }, { user }) => user.load(id),
    // resolver 需要返回一个包含schema定义字段的object或者返回此object的promise函数
    post: (_, { id }, { post }) => post.load(id),
  },
  Post: {
    // 此处定义Post的author字段的resolver，参数1为Post，根据post的author_id得到author信息，
    // 由于这条查询会在查询post的author字段时自动触发，所以没有用户查询输入参数
    author: ({ author_id }, _, { user }) => user.load(author_id),
  },
}

module.exports = makeExecutableSchema({
  typeDefs: rootSchema,
  resolvers: rootResolvers,
})
```

可以看到使用 dataloader 可以将数据查询逻辑放在 dataloader 中，使得 schema 非常简洁清晰。

## 使用

启动服务，打开[http://localhost:3000/graphql](http://localhost:3000/graphql)， 输入：

```
{
  user(id: 15) {
    id
    username
  }
  post(id: 2) {
    id
    title
    author_id
    author{
      id
      username
    }
  }
}
```

可得到结果

```json
{
  "data": {
    "user": {
      "id": 15,
      "username": "Tate Heaney"
    },
    "post": {
      "id": 2,
      "title": "Eum voluptates nulla alias alias excepturi",
      "author_id": 15,
      "author": {
        "id": 15,
        "username": "Tate Heaney"
      }
    }
  }
}
```

完整代码，请看[http://gost.surge.sh/#/gost/99cd47c0-9ad5-409e-9456-0d9e74e19495](http://gost.surge.sh/#/gost/99cd47c0-9ad5-409e-9456-0d9e74e19495)
