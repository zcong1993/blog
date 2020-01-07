---
title: 'Ts typings 包版本冲突问题'
date: 2020-01-06T19:44:35+08:00
categories:
  - NodeJS
  - TypeScript
tags:
  - NodeJS
  - TypeScript
  - Npm
draft: false
---

对于 Node 开发者来说, 早已习惯成千上万的项目依赖, 但是过多的依赖会导致依赖变成网状而且会带来 `版本冲突`, 虽然 npm 会帮助我们处理这些问题, 但是如果是 typings 包冲突的话, 编译基本就会报错了, 我们来看看为什么吧.

<!--more-->

## 问题描述

笔者在使用 NestJS 时, 使用了两个库 `class-validator` 和 `sequelize-typescript`, 这两个库都间接依赖了 `@types/validator` 这个库, 于是引发了编译报错:

![npm handle deps](/2020-01-06-ts-typings-packages-conflict/ts_error.png)

如 [https://github.com/typestack/class-validator/issues/468](https://github.com/typestack/class-validator/issues/468) 描述的那样.

## npm 如何处理依赖版本冲突

远古时代的 npm (v3 以前), 会以嵌套的方式处理依赖, 也就是 A -> B (A 包依赖 B 包) 的话, B 会装在 A 包里面的 `node_modules` 之中. 这样带来的问题显而易见, 就是太容易冗余, 如果有一个包被依赖了 5 次, `node_modules` 里面就会存在 5 份. 所以 v3 之后的版本将依赖包扁平化了.

如下图:

![npm handle deps](/2020-01-06-ts-typings-packages-conflict/npm_1.png)

那么如果同时依赖相同包的不同版本怎么办呢? 比如, A -> B@1.0.0 同时 C -> B@2.0.0, 并且 AC 被我们在同一个项目中依赖, 这样就会带来版本冲突.

对于老版本的 npm 来说这不是问题, 因为所有包的依赖包都是在各自包的 `node_modules` 里面的, 互相隔离.

新版的 npm 做了扁平化处理, 当安装 C 包时, 由于我们已经安装了 B@1.0.0, 所以 B@2.0.0 不能装在顶层, 所以它会被放在 C 包的 `node_modules` 里面.

如下图:

![npm handle deps conflict](/2020-01-06-ts-typings-packages-conflict/npm_2.png)

在项目中也可以用命令查看 `npm ls @types/validator` :

![npm deps tree](/2020-01-06-ts-typings-packages-conflict/npm_deps_tree.png)

## 解决办法

上面回顾了 npm 处理依赖包的方式, typings 依赖包也算 npm 包, 所以也遵循上述规则.

所以应该是 ts 处理依赖的时候找的不对, 查看[ts 官方文档](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html#types-typeroots-and-types)看到了这些信息:

![ts_types_root](/2020-01-06-ts-typings-packages-conflict/ts_types_root.png)

可以看到默认值只是包含了当前目录, 父目录... 向上一直到项目 root 目录的 `node_modules/@types/` 目录, 发生冲突的包却有一部分安装在了 `node_modules/class-validator/node_modules/@types/` 目录下, 所以我们应该在该配置中加入类似的目录:

```json
{
  "compilerOptions": {
    "typeRoots": ["./node_modules/*/node_modules/@types/"]
    ...
  }
  ...
}
```

于是, 问题解决了.
