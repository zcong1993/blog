---
title: Sync Github Fork
date: 2020-07-28T15:48:55+08:00
categories:
  - Git
  - Github
  - CI
tags:
  - Git
  - Github
  - Github Actions
draft: false
description: Github Fork 是一个很常见的操作, 常用来做自己的定制化开发, 或者做修改之后提交(pr)回上游仓库. 假如我们希望自己的 fork 版本同步更新上游的新功能和 bug fix. 那么怎么做呢?
---

[Github Fork](https://docs.github.com/en/github/collaborating-with-issues-and-pull-requests/about-forks) 是一个很常见的操作, 常用来做自己的定制化开发, 或者做修改之后提交(pr)回上游仓库.

然而, 有时候我们经常需要自己的 fork 版本和上游更新保持一致. 例如最近很火的这个项目 [anuraghazra/github-readme-stats](https://github.com/anuraghazra/github-readme-stats), 我们需要部署自己的服务, 这时就希望我们的 fork 版本同步更新上游的新功能和 bug fix. 那么怎么做呢?

<!--more-->

## 手动同步 fork

手动同步一般需要 4 步.

```bash
# 0. 进入项目文件夹, 并切到相应分支
# 1. add upstream
$ git remote add upstream https://github.com/anuraghazra/github-readme-stats.git
# 2. 拉取上游代码
$ git fetch upstream
# 3. 合并到本地分支, 例如 master
$ git merge upstream/master
# 4. push 更改
$ git push
```

虽然第一步只需要完成一次, 但是重复做还是比较麻烦的, 而且不知道上游何时会更改. 那么有没有更好的方法呢? 答案是有!

## 使用 Github Actions

[Github Actions](https://github.com/features/actions) 是 github 的一项功能, 可以帮我们做一些程序化的 CI/CD 的事情, 并且完全免费. 这样我们就可以解放双手了, 更多 Github Actions 相关介绍可以去看官方文档.

使用它来做 fork 同步也很简单, 只需创建个配置文件 `.github/workflows/sync.yml`:

```yaml
# .github/workflows/sync.yml
name: Sync Fork

on:
  push: # push 时触发, 主要是为了测试配置有没有问题
  schedule:
    - cron: '0 * * * *' # 每小时 0分触发, 对于一些更新不那么频繁的项目可以设置为每天一次, 低碳一点
jobs:
  repo-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: TG908/fork-sync@v1.1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }} # 这个 token action 会默认配置, 这里只需这样写就行
          owner: anuraghazra # fork 上游项目 owner
          head: master # fork 上游项目需要同步的分支
          base: master # 需要同步到本项目的目标分支
```

配置好以后, 如果上游项目更新的话, 我们的 action 会在触发时帮我们更新代码, 会创建 pr 并且会自动 merge. 而且我们这个项目配置了 [vercel](https://vercel.com) 自动构建部署, 也就是上游更新, 我们在一小时内会同步更新并且部署, 是不是很 cool.

效果如下:

![sync fork](/sync-fork.png)

更多参数请查看 [https://github.com/marketplace/actions/fork-sync](https://github.com/marketplace/actions/fork-sync).

![wxmp](/wxmp_tiny.png)
