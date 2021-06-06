---
title: 使用 esbuild 加速 ts 构建
date: 2021-06-06T23:40:17+08:00
cover: /0ZrHIetgrHeIa33IktkcsBscOVBts7VzEuEKmhsQ.jpeg
description: 使用 esbuild 取代 tsc 加速 ts 构建
categories:
  - TypeScript
tags:
  - TypeScript
draft: false
---

## 背景

随着 ts 的流行, 拥有类型系统的语言确实适合大规模的项目维护. 2021 年的今天, 后端 nodejs 项目肯定也是首选 ts.

然而随着项目规模越来越大, 代码行数越来越大, ts 的构建速度变得越来越慢了. 我们开发环境代码使用 `eggjs` 框架, 提交会触发 `jenkins` 构建 `docker` 镜像然后部署 `k8s`, 仅仅在 tsc 构建这一步会消耗调 **60 秒** 左右的时间, 也就是说从提交代码到改动生效大概需要两分钟时间, 而一般时间消耗在了 tsc 构建这一步. 最主要是这一步是没有办法在 docker 构建层面优化, 安装依赖之类的在依赖不变时可以重用 docker 缓存, 所以大多数情况下不会是瓶颈. 因此我开始寻找优化这一步的方法.

## esbuild

[esbuild](https://github.com/evanw/esbuild) 是一个使用 Go 编写的 JavaScript 打包器, 比 js 编写的打包器快 10-100 倍. 著名现代化前端脚手架 [vite](https://cn.vitejs.dev/guide/why.html#slow-server-start) 项目也使用了 esbuild 加快构建速度. 因此我们选择 esbuild 来优化构建.

## 如何使用

已有项目使用 tsc 构建的命令为 `tsc -p tsconfig.json`, 由于我们后端项目不像前端库那样会有一个入口文件, 后端项目的源码往往是很分散的, 特别是 egg 这种拥有自己加载器的框架. 所以也就告别了直接使用 esbuild 命令行的方式.

### esbuild js API

查看 esbuild 源码, 可以看到我们需要的核心构建选项为下面几个:

```ts
// https://github.com/evanw/esbuild/blob/236039d30bc0f9cfd8a4d3d36fcce26fc87adfdb/lib/shared/types.ts#L38
export interface BuildOptions extends CommonOptions {
  outdir?: string
  platform?: Platform // 后端肯定为 node
  tsconfig?: string // tsconfig 路径
  entryPoints?: string[] | Record<string, string> // 源文件
  // 下面是 CommonOptions
  sourcemap?: boolean | 'inline' | 'external' | 'both'
  format?: Format // 后端选 cjs
  target?: string | string[] // 和 tsconfig 配置相同
}
```

上面配置除了已经确定的选项外只剩下 `outdir`, `entryPoints`, `sourcemap`, `target`, 逐个分析.

- outdir 输出文件夹, 用户配置
- sourcemap 还是建议开启, 报错堆栈就能看到源码, 后端一般选 inline
- target 可以从 tsconfig.json 读取, 然而看了下[源码](https://github.com/evanw/esbuild/blob/236039d30bc0f9cfd8a4d3d36fcce26fc87adfdb/internal/resolver/tsconfig_json.go#L44), 发现 esbuild 会自动读取 tsconfig.json 中的配置, 所以我们不需要额外处理
- entryPoints 便是我们需要处理的, 要告诉 esbuild 我们需要处理哪些文件

entryPoints 从哪里来呢?

tsc 构建时有 project 这个概念, 所以源文件会通过 tsconfig.json 中的三个选项控制: `files`, `include` 和 `exclude` 控制. 因此我们需要实现从配置获取 entryPoints 这一步. ts 官方文档中介绍了这三个参数, files 永远生效, exclude 仅仅在 include 没定义时生效.

因此我们实现一个函数, 使用 [glob](https://yarnpkg.com/package/fast-glob) 库扫描源文件:

```ts
const scanSourceFiles = (tsconfig: PartialTsConfig): Record<string, string> => {
  const entryPoints: Record<string, string> = {}
  // 默认为项目里所有 ts 文件
  let matchers = ['**/*.ts']
  // 除了 d.ts 和 node_modules 的所有依赖
  const ignores = ['**/*.d.ts', '**/node_modules/**']

  // 处理用户配置 include 和 exclude
  if (tsconfig.include?.length) {
    matchers = tsconfig.include
  } else if (tsconfig.exclude?.length) {
    // exclude only works when include not set
    ignores.push(...tsconfig.exclude)
  }

  const files = sync(matchers, { ignore: ignores })

  // 加上 files 配置
  if (tsconfig.files?.length) {
    files.push(...tsconfig.files)
  }

  files.forEach((f) => {
    // key 为输出文件名, 不包含后缀
    entryPoints[f.replace(/\.ts$/, '')] = f
  })

  return entryPoints
}
```

拿到文件之后, 只需要简单调用下 esbuild 的 `build` 函数就完成了.

稍微加点细节, 允许用户使用 `.esbuildrc.json` 配置文件来更改 build options, 就完成了. 完整代码我写成了 npm 包 [zcong1993/esbuild-tsc](https://github.com/zcong1993/esbuild-tsc).

## 类型校验

由于 esbuild 转换 ts 到 js 对于类型操作仅仅是擦除, 所以完全保证不了类型正确, 这有悖于我们使用 ts 的初衷, 所以需要额外自行校验类型, 使用 `tsc --noEmit`.

## 效果

| tsc       | esbuild-tsc                                  |
| --------- | -------------------------------------------- |
| 60 秒左右 | 30 秒以下(esbuid < 1 秒, tsc --noEmit 30 秒) |

## 其他

esbuild 虽然很快, 但是成熟度还是远远不如 tsc 的, 所以对于生产环境代码构建建议还是使用 tsc, vite 生产代码打包使用 rollup 部分原因也是如此. 我们也仅仅在开发 CI/CD 中使用 esbuild.

另外记得使用最新的 typscript 版本, 一般来说新版本都会优化构建速度.

## 参考资料

- [https://github.com/evanw/esbuild](https://github.com/evanw/esbuild)
- [https://cn.vitejs.dev/guide/why.html#slow-server-start](https://cn.vitejs.dev/guide/why.html#slow-server-start)
- [https://github.com/egoist/esbuild-register](https://github.com/egoist/esbuild-register)
