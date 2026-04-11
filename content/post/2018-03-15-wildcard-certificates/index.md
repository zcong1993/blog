---
title: Let’s Encrypt 通配符证书
date: '2018-03-15'
categories:
  - https
tags:
  - https
  - cert
draft: false
---

[Let’s Encrypt](https://letsencrypt.org/) 非常良心地为我们提供免费的 CA 证书, 最近终于支持通配符子域名证书了, 也就是说 `*.example.com` 可以共用一个证书了.

<!--more-->

## 使用 [certbot](https://certbot.eff.org/) 生成证书

`certbot` 是我们的老朋友, 也是`Let’s Encrypt`官方最推荐的工具, 所以在`Let’s Encrypt` 支持通配符证书就赶紧支持这一操作, 但是因为现在还是早期, 所以还是开发版本, 并没有稳定的 release 版本. 我们使用它的 `V0.22.0` 版本尝尝鲜.

`V0.22.0` 开始才支持新特性, 目前只能通过源码使用.

```sh
$ git clone https://github.com/certbot/certbot
$ cd certbot
$ git checkout v0.22.0
$ sudo ./certbot-auto --os-packages-only
$ ./tools/venv.sh
$ source venv/bin/activate
```

首先, 常规操作, 将使用的服务器 `ip` 添加到域名 `congz.me` 的 `A` 记录;

```sh
$ ./certbot-auto certonly -d congz.me -d *.congz.me --manual --preferred-challenges dns-01 --server https://acme-v02.api.letsencrypt.org/directoryConnection
```

通配符域名验证方式我不确定是否只支持 `manual` 方式, 我只知道 `webroot` 方式不支持.

所以我们会收到下面提示:

```
Please deploy a DNS TXT record under the name
_acme-challenge.congz.me with the following value:

uz2pVaAxBu4r_Cf74BNbcQianRUDAFKfpgHjlkqBW-o

Before continuing, verify the record is deployed.
```

我们需要在域名 `congz.me` 添加一条 `TXT` 记录, 名称为 `_acme-challenge` 记录值为上面的 `value`, 也就是 `uz2pVaAxBu4r_Cf74BNbcQianRUDAFKfpgHjlkqBW-o`.

添加完成可以在 [https://mxtoolbox.com/SuperTool.aspx](https://mxtoolbox.com/SuperTool.aspx) 查看, 如果值和此值相同的时候, 返回命令行按回车.

然后会让你继续重复操作一次.

注意, 更新 dns 记录同步需要时间, 由于是分布式的, 所以要耐心等待, 不然会出现查询记录随机是新的值或者旧的值, 会导致我们的操作失败, 因此需要在查询网站多查询几次, 至少四五次重复操作都是新值的时候再按回车.

基本这样就成功了.

本教程成功的网站 [https://test.congz.me/](https://test.congz.me/).
