---
title: yarn config
date: '2017-01-17'
categories:
  - GFW
  - Yarn
  - NodeJS
  - NPM
draft: false
---

> GFW内开发的生存之道，不但要攻克代码难题还要和我们的保护伞作斗争，真是累。

cnpm
---

这里肯定得感激淘宝为我们带来的国内[npm镜像站](https://npm.taobao.org/)，好多人为了方便直接使用`cnpm`，但是`cnpm`和`npm` 处理依赖的方式不一样，所以使用`cnpm`的项目中的`node_modules`文件夹下回有一个额外的`.bin`目录，所以会有很多额外的开销，也会使得有些`IDE`打开项目时非常卡。所以，我已经放弃使用`cnpm`了， 当然`yarn`的出现也是非常大的原因。

<!--more-->

yarn
---

yarn 是 Facebook 做的包管理工具，理念就是快！我是从它刚出来就开始使用的。但是想说的是它再快在 GFW 下也没办法，所以我们可以让 yarn 使用淘宝镜像源。
```sh
$ yarn config set registry https://registry.npm.taobao.org
```
这样就能应付一般的项目了，确实快了很多。

但是，凡事都有但是，在[淘宝开源镜像站](https://npm.taobao.org/mirrors)，可以看到有很多东西，比如`phantomjs`, `node-sass`， `fsevents`。。。

如果你使用过上面的 3 个，你应该体会到了，安装是有多难了吧，因为这些项目安装会安装二进制的安装包，这些基本放在 github 上托管，所以基本都会下载不下来。

.yarnrc .npmrc
---

这些包都可以在升级时更改镜像源，或者从本地安装，比如：
```sh
# 安装node-sass
$ SASS_BINARY_SITE=http://npm.taobao.org/mirrors/node-sass npm install node-sass
```
这样比较麻烦，我们应该把他们配置到全局。

`.yarnrc .npmrc` 分别是`yarn runtime config` `npm runtime config` 一般存放在我们的个人根目录下，查看一下可以发现存放了一些个人配置，比如`init -y` 时的一些默认值。但是需要注意的是`yarn`不会使用`.yarnrc`中的镜像源相关配置， 而是使用`.npmrc`中的配置，所以我们需要把上面的配置放在`.npmrc`中。

```
sass_binary_site=https://npm.taobao.org/mirrors/node-sass
phantomjs_cdnurl=http://cdn.npm.taobao.org/dist/phantomjs
disturl=https://npm.taobao.org/dist
registry=https://registry.npm.taobao.org/
chromedriver_cdnurl=http://cdn.npm.taobao.org/dist/chromedriver
operadriver_cdnurl=http://cdn.npm.taobao.org/dist/operadriver
fse_binary_host_mirror=https://npm.taobao.org/mirrors/fsevents
electron_mirror=http://cdn.npm.taobao.org/dist/electron/
```

这些常用配置建议加入`.npmrc`中，或者使用命令配置也行。

更多介绍请查看: [https://sebastianblade.com/the-truly-way-to-install-upgrade-npm-dependency-in-china/](https://sebastianblade.com/the-truly-way-to-install-upgrade-npm-dependency-in-china/)
