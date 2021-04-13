---
title: '使用 Github Actions 做一个免费的 Task Runner'
date: 2019-09-15T21:43:52+08:00
categories:
  - CI
  - Github
tags:
  - CI
  - Github
draft: false
---

有时候我们需要周期性的执行一些脚本，有时候需要在有必要的时候通过触发执行一些脚本。我们有点追求，需要知道任务执行的时间，执行的状态，执行的日志。这么一整套其实是个挺复杂的需求，那么有没有现成的，优雅的解决方案呢？答案是有！那就是 `Github Actions`！

<!--more-->

## 为什么不是 crontab

- 需要有自己的服务器（这对于开发人员都是基础设施，应该人人都有，可是这里面真正的成本是迁移成本）
- 执行状态，日志需要进入服务器才能查看
- 修改比较麻烦

## Github Actions 是什么

`Github Actions` 是一个基于 GitHub 事件的 `CI/CD pipeline`，在微软收购 GitHub 之前，大家基本都是用的 `CircleCI` 或者 `TravisCI` 之类的，收购之后，由于微软自家平台本来就有 `Azure pipeline` 服务，所以就诞生了 `Github Actions`，其实相当于 `Azure pipeline` 的定制版本。

说了这么多，`Github Actions` 有什么相比别的有什么亮点呢？其实最大的亮点就是支持 `Schedule` 任务，也就是你可以通过 crontab 的方式执行任务。

## 如何使用

首先，你要具备测试资格（现在不知道还在不在 beta 阶段）。

### 配置

最核心的一点，其实就是在你的项目里面建一个 `.github/workflows` 文件夹，然后在里面新建一个（也支持多个） `{name}.yml` 文件作为配置文件。

```yml
# cron.yml
name: Cron CI

on:
  schedule:
    - cron: '0 * * * *' # 触发配置，每小时执行一次

jobs:
  build:
    runs-on: ubuntu-latest # 选择执行环境
    steps:
      - name: test # 执行相应指令
        run: echo done!
```

这个运行环境其实里面预装了好多基础软件和工具，基本的 `node`，`python`，`golang` 等都已经装好了, 可以在 [这里](https://help.github.com/en/articles/software-in-virtual-environments-for-github-actions) 查看。

可以选择使用自己熟悉的高级语言来写脚本，这样每次执行之前，我们需要把自己的 repo checkout 下来，所以需要加一点配置：

```yml
#...
steps:
  - uses: actions/checkout@v1 # checkout 代码
  - name: run script # 执行脚本
    run: node test.js
#...
```

**注意**：由于执行器启动需要时间，所以只能保证在配置的时间点，执行器开始启动，而不是开始执行脚本。

### 安全

执行脚本可能需要一些敏感的配置，`Github Actions` 支持配置 `secrets`，具体文档在 [这里](https://help.github.com/en/articles/virtual-environments-for-github-actions#creating-and-using-secrets-encrypted-variables)。

### 高阶玩法

如果需要在不同时候触发不同脚本，难道我们需要创建多个 repo ?

不，我们不需要，这样太过愚蠢。

其实我们可以读取本次触发的事件信息，`GITHUB_EVENT_PATH` 这个环境变量就是文件路径，例如：`/github/workflow/event.json`，这里面可以拿到更多东西。

例如，可以拿到提交信息之类的有用信息，接着就可以发挥了，比如在提交信息中配置关键字，通过不同关键字，执行不同脚本。

```json
...
"id": "4b970e8b88b70f344e99e546f79a11252fc5e625",
"message": "test env",
"modified": [
  ".github/workflows/push.yml"
],
...
```

## 总结

这样我们就拥有了一个免费的，功能齐全的 `Task Runner`。

![show](/github-actions/show.png)
