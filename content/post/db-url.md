---
title: 'DB Url'
date: 2018-08-28T18:38:32+08:00
draft: false
categories: ['感想', '扯淡', '经验']
---

服务基本都会使用各式各样的数据库, 一般会使用配置文件配置数据库的地址, 用户名, 密码, 使用数据库名等信息. 有的人喜欢配置一条 url, 而有的人喜欢把它拆开, 两者有什么区别呢?

<!--more-->

## 认识 url

`https://www.google.com` 这个网址应该很熟悉. 我们使用 `url parser` 来进一步认识它:

```js
const url = require('url')

console.log(url.parse('https://www.google.com'))

Output: Url {
  protocol: 'https:', // 协议
  slashes: true,
  auth: null, // 鉴权
  host: 'www.google.com',
  port: null, // 端口
  hostname: 'www.google.com', // 域名
  hash: null,
  search: null,
  query: null, // query string
  pathname: '/',
  path: '/', // 路径
  href: 'https://www.google.com/' }
```

再看个复杂一点的 `mysql://root:root@localhost:3306/test_db?chartset=utf8`:

```js
const url = require('url')

console.log(url.parse('mysql://root:root@localhost:3306/test_db?chartset=utf8'))

Output: Url {
  protocol: 'mysql:',
  slashes: true,
  auth: 'root:root',
  host: 'localhost:3306',
  port: '3306',
  hostname: 'localhost',
  hash: null,
  search: '?chartset=utf8',
  query: 'chartset=utf8',
  pathname: '/test_db',
  path: '/test_db?chartset=utf8',
  href: 'mysql://root:root@localhost:3306/test_db?chartset=utf8' }
```

这下就很明显了吧, `auth` 是用户名密码, `hostname` 是地址, `port` 是端口, `path` 是数据库名, `query` 是额外参数.

## 简单的转换器

### 1. mysql

```js
const url = require('url')
const qs = require('querystring')

const transfer = uri => {
  const u = url.parse(uri)

  const auth = u.auth.split(':')
  const db = u.pathname.split('/')[1]

  return {
    host: u.hostname,
    port: u.port,
    database: db,
    user: auth[0],
    password: auth[1],
    ...qs.parse(u.query)
  }
}

console.log(transfer('mysql://root:root@localhost:3306/test_db?chartset=utf8'))

Output: { host: 'localhost',
  port: '3306',
  database: 'test_db',
  user: 'root',
  password: 'root',
  chartset: 'utf8' }
```

### 2. redis

```js
const url = require('url')

const transfer = (uri) => {
  const u = url.parse(uri)

  const auth = u.auth && u.auth.split(':')
  const db = u.pathname && u.pathname.split('/')[1]

  return {
    host: u.hostname || 'localhost',
    port: Number(u.port) || 6379,
    db: db ? Number(db) : 0,
    password: auth ? auth[1] : '',
  }
}

console.log(transfer('redis://'))
// { host: 'localhost', port: 6379, db: 0, password: '' }
console.log(transfer('redis://:pwd@localhost:6380/2'))
// { host: 'localhost', port: 6380, db: 2, password: 'pwd' }
```

类似的其他数据库也可以这样写.

## 总结

很多时候我们配置数据库地址会使用 `env`, 如果分开的话, 一个 mysql 连接就要配置 5 个环境变量, 所以我们可以使用这种形式, 将它配置成一个.

不过要注意的是, 有时候生产环境数据库密码有特殊字符, 所以我们可能需要注意 `escape`.
