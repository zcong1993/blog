---
title: bind in javascript
date: '2017-05-26'
categories:
  - JavaScript
  - 总结
draft: false
---

`bind` 在 `JavaScript` 中有个重要的用法就是偏函数。我之前不太熟悉这个方法，所以一些东西看了半天才明白。

<!--more-->

## 偏函数
简单的例子：
```js
function add(a, b) {
  return a + b
}

const addByOne = add.bind(null, 1)

console.log(addByOne(2)) // 3
```
其实，相当于封装一个参数有默认值得函数。
```js
function addOne(a = 1, b) {
  return a + b
}

console.log(addOne(undefined, 2))// 3
```
可以看出上面的写法显然更好一点。

特别是用在回调方法中， 例如：

```js
// express
// app.use((req, res) => {...})
function findById(DB, req, res) {
  const id = req.params.id
  const data = DB.findById(id)
  // ... handle res
}
// 我们可以这么使用
app.use((req, res) => findById(User, req, res))
app.use((req, res) => findById(Book, req, res))
// 使用bind, 函数接受两个参数
const findUserById = findById.bind(null, User)
const findBookById = findById.bind(null, Book)
app.use(findUserById)
app.use(findBookById)

## 函数重载？
```js
function base(x, y, z) {
  if (!y && !z) return base.bind(null, x)
  if (!z) return base.bind(null, x, y)
  return x + y + z
}
const addOne = base(1)
console.log(addOne(2, 3)) // 6
const addOneAddTwo = base(1, 2)
console.log(addOneAddTwo(3)) // 6
```
再复杂一点
```js
function mapTo(keys, keyFn, rows) {
  if (!rows) return mapTo.bind(null, keys, keyFn)
  const group = new Map(keys.map(key => [key, null]))
  rows.forEach(row => group.set(keyFn(row), row))
  return Array.from(group.values())
}

const rows = [
  {
    id: 2,
    name: 'hello'
  },
  {
    id: 3,
    name: 'world'
  },
  {
    id: 1,
    name: '!'
  }
]

const arr = mapTo([2, 3, 4], x => x.id + 1, rows)
console.log(arr)
//[ { id: 1, name: '!' },
//  { id: 2, name: 'hello' },
//  { id: 3, name: 'world' } ]
const arr1 = mapTo([2, 3, 4], x => x.id + 1)(rows)
console.log(arr1 === arr)
//[ { id: 1, name: '!' },
//  { id: 2, name: 'hello' },
//  { id: 3, name: 'world' } ]
```
---

总之，使用 bind，会很容易写出别人一眼看不明白的代码（雾）。
