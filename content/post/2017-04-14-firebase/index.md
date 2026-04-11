---
title: 使用firebase快速开发你的应用
date: '2017-04-14'
categories:
  - 前端
tags:
  - 前端
  - Vue
  - Firebase
draft: false
---

> 这两天了解了一下 Google 的 firebase 服务，于是就尝试了一下，结合 vue 做了个简单的小东西，本文简单介绍一下。详情请参看官方文档以及本例源码。

GitHub: [zcong1993/fire-todo](https://github.com/zcong1993/fire-todo)

在线尝试: [http://vue-todos.surge.sh/](http://vue-todos.surge.sh/)

<!--more-->

## 认识

这两天看到`vue-hackernews`使用`hackernews`api 中有用到`firebase`，而且看`2016 Google IO`大会中也提到这个名词。于是就去了解了一下。

[firebase](https://console.firebase.google.com/)，可以看到`firebase`提供好多后端服务，例如`Google Analytics`，`Authentication（身份验证，帮你解决用户认证和管理）`, `Realtime Database（实时数据库，不仅仅是云端数据库）`, `Storage（云存储）`, `Hosting`。

目前我用到的仅仅是`Authentication`和`Realtime Database`，本来想用`Hosting` host 最终项目，结果祖国的防火墙不放过我，terminal 验证总是不能通过，只能放弃了，选择了`surge.sh`。

看到上面这些，可以认识到，`firebase`基本是把后端做的那一套搬到了云端，并且封装好了支持多种平台的`SDK`，也就是全盘接管你的应用后端。所以开发应用非常快速。

## Realtime Database 实时数据库

### 数据库

首先它是一个云端`nosql`数据库，为你提供`API`接口，你可以增删改查，没有`schema`，非常灵活，就是以`json`格式存储的。使用起来比`mongo`还简单。而且你还可以定义字段的存储读取权限或者`validate`条件，结合`Authentication`你可以快速分隔不同用户的数据，做到隐私安全。

### Realtime 实时

为什么是实时呢？因为`Realtime Database`的`SDK`提供一系列的事件监听机制，一旦数据更改被监听到，就会通知所有客户端更新数据，`Google`声称相应会在毫秒级别完成，这样就可以达到不同终端同步，甚至使用这个特性很容易就能构造出聊天室应用。

看到这个，相信你会想到流行的前端 UI 框架`react`和`vue`，它们也是数据状态更新会触发 UI 更新，和`Realtime Database`的通知事件非常配。而且为了让我们更好的使用，官方也提供了用于框架的库，本例我使用的是[vuefire](https://github.com/vuejs/vuefire)（由 vuejs 官方提供）。

## Authentication 权限管理

就算再简单的应用，如果涉及登录都会使人稍微有点头大。你必须有一张用户管理表，用户注册时需要`validate`，向用户发送注册确认邮件，然后用户忘记密码还需要支持发邮件重置密码。使用第三方登录也需要自己实现，并且保存第三方的`uid`。

然而`Authentication`做的事情就是将这些事接管，很简单就能实现上述功能，而且内置`Google`，`Twitter`，`Facebook`，`GitHub`第三方登录认证，几行代码就可以实现，本例我使用的是`Google账号`登录。

## 实际应用

本例，用户可以通过`Google账号`登录，然后我们可以通过`currentUser`拿到当前用户的信息，还有`Accesstoken`（可以拿到用户更多信息，本例没有使用），你可以拿到用户邮箱账号，用户名和头像方便显示。并且会生成一个`uid`，这个`uid`并不是`Google账号`的`uid`，如果你要使用数据读写验证例如下面：

```js
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
    		".write": "auth != null && auth.uid === $uid"
			}
    }
  }
}
```

这里需要的是账号的`uid`，应该是`user.uid`而不是`currentUser.uid`，具体请看[源码](https://github.com/zcong1993/fire-todo/blob/master/src/App.vue#L205)。我们实现了按照用户账号 uid 来存储个人数据，并且只有在登录且是本人的情况下才能读写，保证了数据的安全和隔离。

最后部署应用时，需要将自己的域名添加到`Authentication`中的跳转域名白名单中，以保证安全。

---

总之，`firebase`是非常好的一套解决方案，免费套餐对于个人开发简单的应用非常足够。开放应用可以放下后端压力和负担，快速上手。不过`firebase`的客户可不止是小公司，大公司也可以使用，毕竟`Google`实力大家都明白。对于前端同志们非常友好，不需要后端基友就能开发能够真正上线的应用。

然而，在中国你懂的。
