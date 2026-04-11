---
title: 使用dataloader
date: '2017-07-13'
categories:
  - NodeJS
tags:
  - NodeJS
  - DataLoader
draft: false
---

`dataloader`简单的说就是实现了接口`([input1, input2...]) => ([output1, output2...])`，输入几个值就会输出几条数据，对于我们使用者知道这个就差不多了。当然，他的功能实现远不止这些，[详情请查看项目](https://github.com/facebook/dataloader)。

<!--more-->

## 使用数据库 query builder

我们使用[knex](https://github.com/tgriesser/knex)。

```js
// db.js
const knex = require('knex')

const db = knex({
  client: 'sqlite3',
  connection: {
    filename: './mydb.sqlite',
  },
  useNullAsDefault: true,
})

module.exports = db
```

初始化和填充假数据

```js
// db init
const faker = require('faker')
const db = require('./db')

async function down() {
  await db.schema.dropTableIfExists('posts')
  await db.schema.dropTableIfExists('users')
}

async function up() {
  await db.schema.createTable('users', (t) => {
    t.increments('id').primary()
    t.string('username', 100)
    t.unique('username')
  })
  await db.schema.createTable('posts', (t) => {
    t.increments('id').primary()
    t.string('title', 100)
    t.integer('author_id')
      .unsigned()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE')
      .onUpdate('CASCADE')
    t.unique('title')
  })
}

async function mock() {
  const users = Array(20)
    .fill()
    .map(() => ({
      username: faker.name.findName(),
    }))
  await Promise.all(
    users.map((user) => db.table('users').insert(user).returning('id'))
  )

  const posts = Array(100)
    .fill()
    .map(() => ({
      title: faker.lorem
        .sentence(faker.random.number({ min: 4, max: 7 }))
        .slice(0, -1)
        .substr(0, 80),
      author_id: faker.random.number({ min: 1, max: users.length }),
    }))
  await Promise.all(
    posts.map((post) => db.table('posts').insert(post).returning('id'))
  )
}

async function run() {
  await down()
  await up()
  await mock()
}

run()
```

此时就可以这样查询数据：

```js
const db = require('./db')
db.table('users')
  .where('id', 1)
  .select('*')
  .then((data) => console.log(data))
```

## 定义 dataloader

dataloader 相当于 model，只不过功能非常单一。

比如，定义一个`select user by id`：

```js
const user = new Dataloader((ids) =>
  db.table('users').whereIn('id', ids).select('*')
)
// 相当于语句 `select * from users where in (...ids)`
```

使用`user.load(id)`可以得到相应的 id 的数据，相当于`promise`类型， `user.loadMany([1, 2, 3])`可以得到 id 为 1， 2， 3 的三条记录，相当于`Promise.all([user.load(1), user.load(2), user.load(3)])`， 官方文档也有说明这点。

## 问题

查询单挑记录没有任何问题，但是看到查询多条数据用的是`Promise.all()`，因此查询是并行的，所以结果顺序会混乱，与我们期望的不相符。所以我们需要写一个 helper 函数。

```js
// 增加__type类型字段
function assignType(obj, type) {
  obj.__type = type
  return obj
}

function mapTo(keys, keyFn, type, rows) {
  if (!rows) return mapTo.bind(null, keys, keyFn, type)
  const group = new Map(keys.map((key) => [key, null]))
  rows.forEach((row) => group.set(keyFn(row), assignType(row, type)))
  return Array.from(group.values())
}
```

改造 dataloader

```js
exports.user = new Dataloader((ids) =>
  db
    .table('users')
    .whereIn('id', ids)
    .select('*')
    .then(mapTo(ids, (x) => x.id, 'User'))
)
exports.post = new Dataloader((ids) =>
  db
    .table('posts')
    .whereIn('id', ids)
    .select('*')
    .then(mapTo(ids, (x) => x.id, 'Post'))
)
```

此时结果会达到预期。

```js
const { user, post } = require('./dataloader')
async function getPost(id) {
  const p = await post.load(id)
  p.author = await user.load(p.author_id)
  return p
}
Promise.all([1, 2, 3, 4].map((id) => getPost(id))).then((data) =>
  console.log(data)
)
// 得到文章信息和作者信息
```

完整代码请查看：[http://gost.surge.sh/#/gost/ec67d348-1d3b-47c5-8bbc-afb0edf3e324](http://gost.surge.sh/#/gost/ec67d348-1d3b-47c5-8bbc-afb0edf3e324)
