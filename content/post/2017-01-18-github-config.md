---
title: Git入门教程8-github基本配置
date: '2017-01-18'
categories:
  - Git
  - Github
  - 总结
  - 入门
draft: false
---

## 基本配置

---

`github`账号注册流程非常简单，仅需要电子邮件验证就可以了。我们默认各位已经注册好账号了。

使用`github`我们不仅可以将自己的代码同步带云端进行版本控制，还可以在这个庞大的开源社区分享代码，也可以学习别人分享的开源代码，还可以和别人协作共同进行项目开发。

`github`放置公开的开源代码是免费的，你如果想要创建私密的项目，需要付费。

理论上，你拥有账号就可以使用了，但是让你更方便快捷的使用它，还是建议你做以下两点优化。

<!--more-->

### 设置 ssh key

我们使用`github`将自己的项目代码更改 push 到服务器时，需要验证身份。github 支持两种协议，分别是`https`和`ssh`。所以每个项目均有这两种协议的地址，https 协议 push 时需要输入用户名和密码进行身份认证，ssh 则是通过私钥和公钥的方式进行身份验证，更加安全方便快捷。所以我建议在自己常用的电脑配置`ssh key`。

首先，生成`ssh key`：

```sh
# windows 需要在gitbash环境下
$ ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
# 然后一路回车
```
然后，我们个人目录中的`$HOME/.ssh/`目录下会多出两个文件`id_rsa`,`id_rsa.pub`，这就是私钥和公钥，我们需要将公钥配置到 github 的个人账户中：

点击`账户>Settings>SSH and GPG keys>New SSH key`,将`id_rsa.pub`中的内容复制到这里。

这样 ssh 配置就成功了，之后我们使用 ssh 协议管理自己项目时就不用手动输入账号和密码验证身份了。但是这只对 ssh 协议有效。

### 设置https代理

由于 github 的代码基本都是存放在亚马逊云上面，所以在国内 GFW 下，速度你懂的。当我们想要查看别人代码时，会导致`git clone`速度非常慢，有时可能只有 1k/s-2k/s。

设置 ssh 代理非常麻烦，所以我们仅仅设置 http 代理，所以 clone 别人项目时，我建议你选择 https 链接，当然你也可以下载 zip 包，然后解压，个人觉得这样很麻烦。

```sh
$ git config --global http.proxy socks5://127.0.0.1:1080
$ git config --global https.proxy socks5://127.0.0.1:1080
```
此时我们使用`https`协议就会经过`shadowsocks`等`socks5`代理了。

---

注意：本文只说明如何使用，需要探究具体原理请自行 Google，设置代理，请确保电脑已配置好代理工具，且在使用 git 时需要保证代理正常运行。


本系列文章使用`Gitbook`编写，并发布在 [http://gitstart.zcong.win](http://gitstart.zcong.win)
