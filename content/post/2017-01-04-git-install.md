---
title: Git入门教程1-安装
date: '2017-01-04'
categories:
  - Git
  - Github
  - 总结
  - 入门
draft: false
---

## 安装

---

几乎所有软件在不同平台安装方法都不一样，Linux 有自己的包管理工具，OSX 大多人也依赖 homebrew 进行软管理，Windows 下直接下载软件安装包安装会比较方便。

git 主要使用时主要依赖于命令行工具（虽然也有图形界面软件），不过还是建议使用命令行，等你适用了之后，你会真的觉得命令行方便简洁高效了。

<!--more-->

### Linux
> 以Ubuntu为例

打开 terminal，输入以下命令：
```sh
# update apt-get
$ sudo apt-get update
$ sudo apt-get upgrade
# install git
$ sudo apt-get install git
```
安装完成可使用`$ git -v`查看版本。

## OSX

首先，安装强大的`homebrew`[官网](http://brew.sh/index_zh-cn.html),根据页面提示操作。

接下来就非常简单了。
```sh
$ brew install git
```

就是这么简单。

## Windows

在[官网](https://git-for-windows.github.io/)下载 Git 安装包，是个`.exe`文件，之后大家就明白怎么做了吧。

建议初学者按照默认配置点击一直点击下一步安装，因为 git Windows 版本会提供一个类似 Linux 环境的命令行工具，默认选项安装，会自动帮你注册右键菜单，右键看到`Git bash here`，然后我们就可以右键点击打开 git 为我们提供的命令行工具操作了。

也可以使用`conemu`等 Windows`cmd`增强工具。

---

最后，我们需要配置两个必要的身份标识：
```sh
$ git config --global user.name "your username"
$ git config --global user.email "your email"
```
更多配置见下一篇。

本系列文章使用`Gitbook`编写，并发布在 [http://gitstart.zcong.win](http://gitstart.zcong.win)
