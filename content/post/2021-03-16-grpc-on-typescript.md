---
title: 在 Typescript 中使用 gRPC
date: 2021-03-16T15:32:21+08:00
cover: /cover.jpeg
description: gRPC 是一个高性能, 支持多种语言的 RPC 框架, 官方已经支持了 NodeJS 语言. 而 Typescript 作为 JavaScript 的超集, 可以提高 js 代码的可维护性, 并且代码提示很不错, 已在 js 市场占据了很大份额. 本文简单介绍下 gRPC 在 Typescript 中如何使用.
categories:
  - gRPC
  - NodeJS
  - TypeScript
tags:
  - gRPC
  - NodeJS
  - TypeScript
draft: true
---

gRPC 是一个高性能, 支持多种语言的 RPC 框架, 官方已经支持了 NodeJS 语言. 而 Typescript 作为 JavaScript 的超集, 可以提高 js 代码的可维护性, 并且代码提示很不错, 已在 js 市场占据了很大份额. 本文简单介绍下 gRPC 在 Typescript 中如何使用.

<!--more-->

## 官方库选择

早年 grpc 官方 NodeJS client 是基于 c++ 的原生 addon (npm package: [grpc](https://yarnpkg.com/package/grpc)), 随着纯 js 版本([@grpc/grpc-js](https://yarnpkg.com/package/@grpc/grpc-js))的成熟, 官方弃用了 native 版本, 所以没什么必要做选择了, 选择纯 js 版本就够了.

## 代码生成工具选择

一般静态语言使用 grpc 时, 需要先使用 `protoc` 配合各种语言自身的代码生成插件根据 `proto` 文件生成出对应语言的 `message` 类型, `grpc server` 端需要实现的 interface, `grpc client` 代码.

js 这种动态语言官方提供了动态生成工具 [@grpc/proto-loader](https://www.npmjs.com/package/@grpc/proto-loader), 也就是不需要我们显式生成代码, 但是缺点很明显: 没有任何类型. 由于本文考虑的是 ts 生态, 所以不考虑此种方式.
