---
title: inlets + caddy 实现安全内网穿透隧道
date: 2021-03-26T18:37:48+08:00
cover: /inlets-cover.jpeg
description: 对接外部产品回调(callback)类需求时, 如果将我们开发中的服务暴露到公网, 对接调试会省很大力气. 因此 `inlets` 就是我们需要的轻量级内网穿透工具.
categories:
  - Devops
  - Tool
tags:
  - Devops
  - Tool
draft: false
---

对接外部产品回调(callback)类需求时, 如果将我们开发中的服务暴露到公网, 对接调试会省很大力气. 因此 [inlets](https://github.com/inlets/inlets) 就是我们需要的轻量级内网穿透工具.

<!--more-->

_注意:_ 如您需要在企业网络中使用 inlets，建议先征求 IT 管理员的同意.

## 为什么选择 inlets

这里引用下 inlets 官方项目介绍中的一段话:

> 类似的工具例如 [ngrok](https://ngrok.com/) 和由 [Cloudflare](https://www.cloudflare.com/) 开发的 [Argo Tunnel](https://developers.cloudflare.com/argo-tunnel/) 皆为闭源，内置了一些限制，并且价格不菲，以及对 arm/arm64 的支持很有限。Ngrok 还经常会被公司防火墙策略拦截而导致无法使用。

而且 ngrok 在大陆访问有时也没那么稳定.

当使用 inlets 时, 意味着出口服务器完全可以自己掌控, 因此可以在上面做任何需要的限制.

## 如何保证安全

![inlets](/inlets.png)

根据上图可以看出 inlets 有两段流量是要经过公网的, 分别是: inlets server client 之间和用户访问 inlets server. inlets 开源社区版本不提供开箱即用的 TLS 支持. 因此我们需要自己将这两段流量增加 TLS.

[Caddy](https://caddyserver.com) 作为一个 Go 语言编写的开源 web 服务器, 一个主打功能就是 `automatic HTTPS`. 因此我们选择它来做这件事情.

## 实现方式

一句话概括就是用 Caddy 将 inlets server 的端口反向代理为 TLS.

inlets server 启动时会指定两个端口: port 和 control-port. control-port 是与 inlets client 通信的 ws 连接端口, port 则是外部用户访问的端口.

假如启动命令为:

```bash
# server
$ inlets server --port 9000 --control-port 9001 --token xxx
# client
$ inlets client --url="ws://example.com:9001" --token=xxx --upstream="http://localhost:1313" --insecure
```

_注意:_ 本文使用的 Caddy 为 [Caddy2](https://caddyserver.com/v2).

需要的 Caddy 配置为:

```Caddyfile
example.com:9443 {
	reverse_proxy 127.0.0.1:9000
}

example.com:9444 {
	reverse_proxy 127.0.0.1:9001
}
```

更新 Caddy 配置:

```bash
$ curl localhost:2019/load \
        -X POST \
        -H "Content-Type: text/caddyfile" \
        --data-binary @Caddyfile
```

此时 inlets client 连接命令变为了:

```bash
$ inlets client --url="wss://example.com:9444" --token=xxx --upstream="http://localhost:1313"
```

url 参数变成了 wss, 并且使用代理后的端口号. 外部访问直接访问 `https://example.com:9443`, 两段流量加密完成.

## 写在最后

不得不说有时候提效工具就是那么朴实无华, 但是这种内网穿透软件用户大多时候其实是程序员, 所以中心化服务甚至无脑的使用方式其实是没那么必要的, 因为程序员需要的是更高的掌控力.

本人关注 inlets 这个项目比较早, 使用时也感觉很方便, 没想到后面被 `Cloud Native` 加持了下这么火了, 还推出了 pro 收费服务. 可以感慨一方面 `Cloud Native` 这个概念对项目加持确实挺大,
另一方面是真正能够解决痛点的软件才是好软件.
