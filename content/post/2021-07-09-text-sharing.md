---
title: 写了个简单的多设备文本分享工具
date: 2021-07-09T15:18:30+08:00
cover: /text-share/cover.jpeg
description: 介绍多设备文本分享工具 text-share.
categories:
  - Tool
  - 前端
tags:
  - Tool
  - 前端
draft: false
---

多设备共享, 发送文本这个难题困扰我很久了, 一直找不到简单, 单纯, 安全, 好用的工具. 所以我就自己写了个简单的小工具.

<!--more-->

## 问题痛点

先介绍下我自己在家重度使用的几个电子设备:

- MacBook Pro 写代码, 学习 (不喜欢 PC 微信)
- Windows 台式机 玩游戏, 不翻墙 (流氓软件等安全原因)
- iOS 主力手机
- Android 小米 6 看视频 (单纯刷 b 站)

常见场景:

- 小米手机 b 站刷到评论区 steam 游戏推荐, 想把链接发到 Windows 电脑直接购买
- 手机翻墙查到的一些资料攻略发送到 Windows 电脑
- MacBook 查到的一些信息希望分享给微信好友
- 一些翻墙订阅配置链接多设备分享 (有些不支持扫码)

尝试过的方案:

- 苹果设备共享剪贴板 时好时坏, 并且只支持苹果设备
- 二维码 只能 PC -> 手机单向, 并且不装二维码扫描软件情况下效率低, 用微信扫屏蔽网址太多了没法用
- 石墨之类的文档软件 太"重"了, 它提供的功能太多了
- 多台设备登录社交软件发送给自己 最多两台设备, 不支持两台同类设备

## text share 工具

`text share` 思路很简单, 就是一个网页, 你可以增加, 复制, 删除文本.

![text-share](/text-share/show.png)

### 如何保证安全

text share 借鉴了 `GitHub Gist` 的思路. 私有 gist 其实并不是真正意义上私有的, 链接都是可以直接点开的, 因此取决于你会不会把链接分享出去. 所以 text share 也有这样一个你可以指定的 id, 不分享出去的话相当于私有的, 也就是 **进入这个页面的人都会被当做所有者** 具有所有权限.

而且分享一般都是短时效性的, 所以可以随手清理掉无用的文本.

这样设计极大简化了实现难度.

## show me the code

源码地址: [https://github.com/zcong1993/text-share](https://github.com/zcong1993/text-share)

### 技术栈选择

- [fauna db](https://fauna.com) 提供 HTTP API 的 NoSQL 存储
- [Next.js](https://nextjs.org) react 全栈框架
- [Vercel](https://vercel.com) 免费前端代码托管平台

Next.js 项目可以直接托管到 Vercel 平台, 并且后端接口部分会转化成 `Serverless Function` 部署, 好用而且免费. 这一点看来 Next.js 确实适合快速开发一些简单的业余项目.

### 部署你自己的实例

参考文档 [https://github.com/zcong1993/text-share#deploy-your-own](https://github.com/zcong1993/text-share#deploy-your-own).
