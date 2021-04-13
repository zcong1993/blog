---
title: '访问控制利器 Casbin'
date: 2019-08-29T22:30:17+08:00
categories:
  - NodeJS
  - RBAC
tags:
  - NodeJS
  - RBAC
draft: false
---

往往我们会有需要访问控制的需要，比如后台系统需要根据部门来控制权限。`k8s` 使用 `RBAC` 作为访问控制策略，使用过的应该知道。那么怎么样才能写出这么优雅的访问控制器呢？有什么成熟的框架呢？答案是：有！那就是今天的主角 [Casbin](https://casbin.org/en/)!

<!--more-->

## Casbin 是什么？

`Casbin` 是一个强大的、高效的开源访问控制框架，其权限管理机制支持多种访问控制模型。它的强大之处在于:

- 支持多种语言(可在官网查看)
- 支持多种模型(可在官网查看)
- 策略持久化支持各种适配器(可在官网查看)

所以基于它我们就能很容易实现访问控制。

## 简单使用

接着简单介绍一下 `Casbin` 在 `Koa` 中使用。我们的目标是达到通过用户角色来限制访问路由。

本文使用我为 `koa` 简单封装的中间件 [koa-casbin](https://github.com/zcong1993/koa-casbin)。

使用中间件：

```ts
import { newEnforcer } from 'casbin'
import { authz, Authorizer } from '@zcong/koa-casbin'

// 鉴权中间件，为了简单，通过 header 中 user 字段来区分用户
// 未登录用户当做默认用户
function authMiddleware(): Koa.Middleware {
  return async (ctx, next) => {
    ctx.user = ctx.header.user || 'default'
    await next()
  }
}
class MyAuthorizer extends Authorizer {
  // 覆盖默认方法，取到鉴权中间件中的用户
  getUserName(ctx: Koa.Context) {
    return ctx.user
  }
}
// 先使用鉴权中间件
app.use(authMiddleware())
// 使用 casbin 中间件
app.use(
  authz({
    newEnforcer: async () => {
      const enforcer = await newEnforcer(
        `${__dirname}/authz_model.conf`, // 载入模型
        `${__dirname}/authz_policy.csv` // 载入策略
      )
      return enforcer
    },
    authorizer: MyAuthorizer,
  })
)
```

定义模型，我们使用最基本的 Restful 模型：

```
# authz_model.conf
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = r.sub == p.sub && keyMatch(r.obj, p.obj) && regexMatch(r.act, p.act)
```

定义策略规则：

```
# authz_policy.csv
p, alice, /alice_data/*, GET
p, alice, /alice_data/resource1, POST

p, bob, /alice_data/resource2, GET
p, bob, /bob_data/*, POST

p, cathy, /cathy_data, (GET)|(POST)
```

> 完整事例可以查看 [koa-casbin/examples](https://github.com/zcong1993/koa-casbin/tree/master/examples)

根据上面的设置，当我们用 `alice` 对路径 `/alice_data/hello` 发起 `GET` 请求时，`alice, /alice_data/hello, GET`，会成功，同理：

![restful_policy_result](/casbin/restful_policy_result.png)

## 更多模型

上面策略我们可以看到我们使用了最简单的 `resuful` 模型，下面我们看看更多模型。我们开发测试模型可以使用官方在线编辑器 [casbin/editor](https://casbin.org/en/editor)。

### 另一种 Restful

标准 `restful` 写法路径往往是这样 `api/users/:id/resource`，所以我们需要另一种模型：

![casbin/resful2](/casbin/restful2.png)

如果想同时支持两种风格的路由，可以这样：

```
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
# support restful keyMatch and keyMatch2
m = g(r.sub, p.sub) && (keyMatch(r.obj, p.obj) || keyMatch2(r.obj, p.obj)) && (p.act == "*" || regexMatch(r.act, p.act))
```

### Restful + RBAC

有时候我们需要支持资源分组，比如同一个部门权限往往相同，如果不支`持权限组角色`，会有太多冗余策略，而且更新管理很不方便，所以我们使用 `RBAC + Restful` 模型：

```
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
# support restful keyMatch and keyMatch2
m = g(r.sub, p.sub) && (keyMatch(r.obj, p.obj) || keyMatch2(r.obj, p.obj)) && (p.act == "*" || regexMatch(r.act, p.act))
```

可以得下结果：

![casbin/restful_rbac](/casbin/restful_rbac.png)

### Restful + RBAC + domains

往往我们后台系统不止一个，需要将权限控制作为中心化服务，也就是需要支持`多租户模式`，也就是命名空间，所以我们需要继续升级我们的模型：

```
[request_definition]
r = sub, dom, obj, act

[policy_definition]
p = sub, dom, obj, act

[role_definition]
g = _, _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
# support restful keyMatch and keyMatch2
m = g(r.sub, p.sub, r.dom) && r.dom == p.dom && (keyMatch(r.obj, p.obj) || keyMatch2(r.obj, p.obj)) && (p.act == "*" || regexMatch(r.act, p.act))
```

可以得到下面结果：

![casbin/restful_rbac_domains](/casbin/restful_rbac_domains.png)

## 总结

可以看到，我们可以很灵活的定义业务需要的模型，而且模型策略多种语言通用，但是当出现多个后台系统时，还是建议统一账号系统，账号鉴权，账号访问权限。

最佳实践还是使用数据库适配器，通过数据库持久化策略。
