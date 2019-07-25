---
title: koa graphql 处理图片上传
date: '2017-07-05'
categories:
  - NodeJS
  - GraphQL
  - Koa2
  - Middleware
draft: false
---

graphql 一般都是以`application/json`和`application/graphql`的形式请求的，如果要上传文件，会用到`form-data`形式，所以，我们需要写一个中间件来处理。

<!--more-->

## 主要思路

设计一个中间件处理`multipart/form-data`请求，将文件保存在临时文件夹，然后将文件信息整合到请求上下文，供 graphql 解析。

首先，定义一个简单的`schema`：

```js
type Query {
  hello: String
}

type Img {
  url: String
}

input Upload {
  name: String!
  type: String!
  size: Int!
  path: String!
}

type Mutation {
  uploadImg(name: String!, img: Upload!): Img
}
```

`img`就是我们需要的传入的文件信息，所以我们中间件需要将文件保存然后得到这些信息，传入请求的`variables`中。

## 中间件

处理`multipart/form-data`请求我们使用[formidable](https://www.npmjs.com/package/formidable)这个库。

```js
// form-data.js
function processRequest(request, { uploadDir } = {}) {
  // 确保目录存在，不存在则新建
  if (uploadDir) mkdirp.sync(uploadDir)

  const form = formidable.IncomingForm({
    // 文件保存目录，默认为系统临时目录
    uploadDir,
  })

  // 解析multipart/form-data请求
  return new Promise((resolve, reject) => {
    form.parse(request, (error, fields, files) => {
      if (error) reject(new Error(error))
      // operations字段为graphql查询语句
      let operations = fields.operations

      operations = JSON.parse(operations)
      // img字段为上传文件的字段
      if (files.img) {
        // 得到文件信息
        const { name, type, size, path } = files.img
        // 传给variables
        operations.variables.img = { name, type, size, path }
      }

      resolve(operations)
    })
  })
}
```

中间件

```js
function uploadKoa(options) {
  return async function(ctx, next) {
    // 仅处理header为'multipart/form-data'的请求
    if (ctx.request.is('multipart/form-data')) {
      // 将结果传入上下文
      ctx.request.body = await processRequest(ctx.req, options)
    }
    await next()
  }
}
```

## 使用中间件

```js
const uploadKoa = require('./form-data')

const schema = buildSchema(`
type Query {
  hello: String
}

type Img {
  url: String
}

input Upload {
  name: String!
  type: String!
  size: Int!
  path: String!
}

type Mutation {
  uploadImg(name: String!, img: Upload!): Img
}
`)

const root = {
  hello() {
    return 'hello'
  },
  uploadImg({ name, img }) {
    // 这里就能拿到所有参数，img 就是 { name, type, size, path }
    const { name: imgName, path } = img
    const tmparr = imgName.split('.')
    const ext = tmparr[tmparr.length - 1]
    const file = `${path}.${ext}`
    fs.renameSync(path, file)
    // 为文件增加后缀，然后返回处理后链接
    return { url: 'http://localhost:3000/' + file.replace(/^static\//, '') }
  },
}

app.use(bodyParser())

router.get('/graphql', graphiqlKoa({ endpointURL: '/graphql' }))
router.post(
  '/graphql',
  uploadKoa({
    uploadDir: './static/imgs',
  }),
  graphqlKoa({
    schema: schema,
    rootValue: root,
  })
)
```

## 请求

```html
<form id="form">
  <input
    type="file"
    name="img"
    accept="image/gif, image/jpeg, image/png"
    required
  />
</form>
<button type="button" id="btn">submit</button>
<script>
  const btn = document.querySelector('#btn')
  const form = document.querySelector('#form')

  btn.addEventListener('click', () => {
    const formData = new FormData(form)
    formData.append(
      'operations',
      '{"query": "mutation($name: String!, $img: Upload!){uploadImg(name: $name, img: $img){url}}", "variables": {"name": "zc1993"}}'
    )

    fetch('/graphql', {
      method: 'post',
      body: formData,
    })
      .then(r => r.json())
      .then(d => console.log(d.data))
      .catch(err => console.log(err))
  })
  // { uploadImg: { url: "http://localhost:3000/imgs/upload_f24cb04bd50d596aa4c0b3c67ae8c374.jpg" } }
</script>
```

## 结尾

可以看到，要让 graphql 支持某种功能，最简单的做法就是写一个中间件，处理自己的逻辑，然后 graphql 能接受的请求传递写下去。

完整 demo 文件请看[http://gost.surge.sh/#/gost/cba4553d-4239-42fe-bf3e-fc4ea35137c1](http://gost.surge.sh/#/gost/cba4553d-4239-42fe-bf3e-fc4ea35137c1)

大家可以自行想想怎么实现多文件上传。
