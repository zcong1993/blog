---
title: circleci 系列1 - 起步
date: '2018-01-21'
categories:
  - Circleci
  - CI
  - 经验
draft: false
---

> ci 工具的使用会极大得减少开发者的测试发布负担, 减少错误定位消耗的时间.

### [circleci](https://circleci.com)

我的 github 代码基本都是使用 `circleci`, 之前是 1.0 版本, 但是从它 2.0 测试版本发布我就一直使用 2.0. 建议大家使用 2.0, 因为 2.0 优化了很多东西, 支持 docker 镜像, 配置更加清晰简介, 速度快了好几倍, 是至今我见到的免费 ci 最好用的一个.

<!--more-->

### 快速开始

> 举个简单的例子, node 项目每次提交代码自动执行测试

circleci 需要你在项目中包含一个 `circle.yml` 配置文件, 上面的需求可以这样定义:

```yaml
# 使用 2.0 版本
version: 2
# 定义任务
jobs:
  # 任务名称
  test:
    # 工作目录
    working_directory: ~/github/repo
    # docker 配置
    docker:
      # 选择镜像
      - image: circleci/node:8.9.4
    # 执行步骤
    steps:
      # 拉取 github 代码, 内置命令
      - checkout
      # 定义命令, 安装依赖包
      - run:
          name: install dependences
          command: yarn
      # 定义命令, 执行我们的测试
      - run:
          name: run test
          command: yarn test
```

非常清晰直观, 首先拉取我们定义的 docker 镜像作为运行容器, 然后拉取 github 代码, 之后安装依赖, 然后运行测试, 这些命令执行如果退出状态吗为 0 就证明成功了, 否则失败, 失败我们会收到邮件提醒.

### 缓存

写过 node 项目的人基本都知道 `node_modules` 的威力, 尽管 circleci 的服务器在国外而且网络很好, 但是还是没必要在可以使用缓存节约时间的情况下浪费那些时间.

所以我们需要为上面配置的`steps`增加缓存配置:

```yaml
# ...
steps:
  - checkout
  # 如果有缓存, 先取出缓存再运行安装依赖命令
  - restore_cache:
      # 标识键
      key: dependency-cache-{{ checksum "package.json" }}
  - run:
    name: install dependences
    command: yarn
  # 安装依赖包之后缓存 node_modules 文件夹
  - save_cache:
      # 缓存路径
      paths:
        - node_modules
      # 标识键, 改变时更新缓存
      key: dependency-cache-{{ checksum "package.json" }}
  - run:
    name: run test
    command: yarn test
```

于是我们增加了两个步骤, 安装依赖之前取出缓存, 安装依赖之后更新缓存. 这里主要注意的是 `key`, 这个值控制着改不改使用缓存, `{{ checksum "package.json" }}` 这部分的意思是该文件的哈希值, 也就是文件改变就丢弃缓存, 不变就一直使用, 所以我们使用`yarn`或者`npm5`最好使用`lockfile`作为标识, 也就是`yarn.lock`或者`package.lock`, 保证镜像源之类的更新不会受到缓存的影响.

这样我们的 `circleci` 执行任务时间就省了不少.

_注意:_ 缓存的 `save` 和 `restore` 其实是上传下载同步到 circleci 自己的服务器上, 走的是`https`, 所以应该有一部分人为了节约`docker`镜像拉取时间, 而使用相应镜像的 `alpine` 版本, 确实 `alpine` 版本的镜像会小很多, 但是此版本默认都不会安装 `ca-certificates` 这将导致发送 `https` 请求收到影响, 会使得缓存拉取和上传都不正常, 所以如果要做这方面的优化最好自己构建安装了`ca-certificates` 的 docker 镜像.

例子请看 [https://github.com/zcong1993/circleci-samples/tree/master/demos/start](https://github.com/zcong1993/circleci-samples/tree/master/demos/start)
