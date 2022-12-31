---
title: 一种 golang 开发工具管理方式
date: 2022-12-31T16:51:00+08:00
cover: /cover.jpeg
description: 本文介绍用 Taskfile 来管理 golang 开发工具.
categories:
  - Golang
  - devtool
tags:
  - Golang
  - devtool
keywords:
  - Golang
  - devtool
draft: false
---

每个项目或多或少都会依赖一些工具提升开发者的开发体验, 例如: format, lint, git hook 管理等等. 如果你写过 JS, 就能感受到 JS 社区开发工具的丰富. 开发者更倾向于使用开发语言和项目语言相同的开发工具, 这是因为动态语言开发的工具安装使用都依赖该语言的 runtime, 所以开发 go 语言时更多倾向于使用 go 社区流行的工具.

JS 有完善的开发工具管理方案, 因为天然支持 `devDependencies`, 项目依赖的开发工具会声明在 package.json 中并且提交到仓库共享, 因此开发者只需要 `npm install` 就能安装好项目需要的开发工具, 而这个命令基本是所有项目都会运行的, 因为项目基本都会有依赖. 然而 go 语言就没这种成熟方案, 并且 go 语言依赖的开发工具往往都是二进制的, 不能天然作为 mod 让开发者依赖, 官方推荐的管理方式我不是很喜欢 [https://github.com/golang/go/wiki/Modules#how-can-i-track-tool-dependencies-for-a-module](https://github.com/golang/go/wiki/Modules#how-can-i-track-tool-dependencies-for-a-module), 所以分享一个我的方案.

## 需求分析

对于开发工具依赖管理, 有下面几点需求:

1. 开发工具依赖即代码, 能够将配置共享, 并提供一键安装命令和无感知安装使用体验
2. 需要支持和用户全局环境隔离, 允许多版本存在
3. 需要支持锁定版本保证工具在不同环境版本一致

很多项目往往连第一点都做不好, 最多会在 README 中写几行项目依赖哪些开发工具(什么版本), 稍微好一点会给你贴点安装链接, 包括开源明星项目也没几个做得好的. 第二点则是和用户全局环境解耦, 保证项目本身不受用户机器环境影响. 第三点则是和项目依赖一样, 需要锁住版本保证大家工具体验一致.

## 解决方案

我们选择使用 [https://taskfile.dev](https://taskfile.dev) Taskfile 工具来解决. Taskfile 可以简单理解为 `Makefile` 的现代化替代方案. 基本使用方法本文不做赘述.

对于第二点, 处理方式和 JS 一样, 选择将工具安装在项目内, 对于 go 语言可以使用环境变量 `GOBIN=./bin` 来控制 `go install` 命令的最终安装位置. 因此我们可以将工具安装命令设置成 task:

```yaml
setup:goimports:
  cmds: # 安装 goimports 到 ./bin 中
    - GOBIN=`pwd`/bin go install golang.org/x/tools/cmd/goimports@v0.4.0
```

此时使用 `task setup:goimports` 就可以安装 goimports 依赖, 之后使用 `./bin/goimports` 即可, 类似于 JS 直接使用 `./node_modules/.bin/xxx` 来运行工具, 那么我们能否做到对标 JS `npm run xxx -- args` 的不需要用户感知到工具真实路径的方法呢? 答案是: 有, 而且还能做到更好.

`Taskfile` 和 `Makefile` 一样, 也可以指定任务依赖, 所以我们包装一个 `goimports` 命令, 依赖 `setup:goimports`, 这样执行 `task goimports -- args` 时会限制性依赖任务.

```yaml
goimports: # 可以使用 task goimports -- -w . 来运行 goimports -local "project" -w .
  deps:
    - setup:goimports # 依赖命令 setup:goimports 会优先执行
  cmds:
    - ./bin/goimports -local "project" {{.CLI_ARGS}} # {{.CLI_ARGS}} 代表将用户指定的额外指令信息放在 -- 后面传递
```

这样虽然做到了无感知, 甚至不需要主动运行依赖安装命令, 但是执行时每次都会安装依赖, 这明显非常浪费且不合理. 解决这个问题就要依赖 `Taskfile` 的 `status` 配置特性, `status` 可以设置一些命令, 如果命令执行成功(exit 0) `Taskfile` 会认为这个命令不需要执行从而避免一些无意义的重复工作, 所以我们可以在 status 中检查文件 `./bin/goimports` 是否存在:

```yaml
setup:goimports:
  cmds: # 安装 goimports 到 ./bin 中
    - GOBIN=`pwd`/bin go install golang.org/x/tools/cmd/goimports@v0.4.0
  status: # 避免重复安装
    - test -f ./bin/goimports
```

对于第三个目标, 上述的方式明显做不到锁定版本. 因为前置检查只判断文件是否存在, 没有判断版本是否符合预期. 我们继续把目光放在 `status` 配置上, 假如工具支持 `--version` 命令, 我们可以在 status 命令中调用 version 命令, 判断输出版本是否符合预期, 以 `golangci-lint` 为例:

```yaml
setup:golangci-lint:
  cmds:
    - >-
      curl -SL
      https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh
      | sh -s v1.50.1
  status:
    - test -f ./bin/golangci-lint # 检查二进制文件是否存在
    - ./bin/golangci-lint --version | grep -q " 1.50.1 " # 检查是否是 1.50.1 版本
```

现实往往都很骨感, 很多工具并没有提供显示版本命令, 就连 `goimports` 这个官方工具也一样. 那么该如何解决呢?

如果你对 CICD 工具配置熟悉的话, 会知道为了优化依赖安装效率, 会对项目的依赖作缓存, 那么如何判断缓存是否失效呢? 缓存就是项目依赖的集合, 因此问题就转化为依赖 lock 文件是否改变, 所以基本都会使用 `checksum(lockfile)` 作为缓存 key. 回到当前问题, 我们是否可以在配置文件改变后让所有依赖工具本地缓存失效呢? 正好 `Taskfile` 的 `sources` 配置支持这个场景, 也就是会对 `sources` 配置的文件取指纹, 如果指纹没变则不执行, 所以我们把 `Taskfile.yaml` 配置文件本身作为 `sources` 就可以实现锁版本功能, 此功能还可以和 `status` 一起使用:

```yaml
setup:goimports:
  cmds: # 安装 goimports 到 ./bin 中
    - GOBIN=`pwd`/bin go install golang.org/x/tools/cmd/goimports@v0.4.0
  status: # 避免重复安装
    - test -f ./bin/goimports
  sources: # 前置检查, task 会缓存 sources 文件的 checksum, 发生变化时才会执行
    - Taskfile.yaml
```

上面三个问题都解决了, 但 JS 依赖安装时可以指定 `postinstall` 命令来帮我们初始化某些功能, 例如: 设置 git hooks. 所以还是建议额外给用户提供一个 `all in one` 的初始化命令:

```yaml
setup:
  deps: # 可以将所有依赖安装到位
    - setup:goimports
    - setup:golangci-lint
  cmds: # 初始化 git hooks
    - go install github.com/evilmartians/lefthook@latest
    - lefthook install
```

## 总结

最后再聊一点项目规范化相关的点, 规范化最好通过工具自动化保证否则是保证不了的. 虽然 JS 官方 format/lint 什么都没有, 社区有很多成熟解决方案使得 JS 项目代码风格非常容易统一, 然而 go 语言虽然官方有 format/imports 工具, 但众多项目连自动格式化都做不到. 还有一点是很多人对于项目统一工具没有概念, 总觉得自己的 ide 自带了这些功能, 可以思考下面几个问题: ide 的配置谁来保证大家统一? 不使用这个 ide 的人怎么办? 最终 CI 验证这些规范的配置从哪里来?
