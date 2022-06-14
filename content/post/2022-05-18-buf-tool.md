---
title: 现代化的 Protobuf 构建工具 buf
date: 2022-05-18T16:06:15+08:00
cover: /buf-cover.jpeg
description: 本文介绍 Protobuf 构建工具 buf 的使用.
categories:
  - gRPC
tags:
  - gRPC
keywords: ['gRPC', 'buf']
draft: false
js:
  - js/prism-protobuf.min.js
---

虽然 Protobuf 已经是使用非常广泛的 IDL(interface description language), 但是对它熟悉的人并没有那么多. 因为它在序列化层面上比 JSON 难很多, 并且还有很多复杂的工具链. 本文介绍一下现代化的 Protobuf 构建工具 `buf`.

<!--more-->

## buf 亮点

1. 为 protobuf 提供依赖管理
2. 使用 yaml 配置简化代码生成命令
3. 提供 lint 静态检查工具
4. 提供 breaking change 静态检查工具
5. 提供 format 格式化工具
6. 自己实现 compiler 取代 protoc

首先说明, protobuf 语言和工具链相关门槛是比较高的, 系统性资料也比较少. 下面通过 protoc 插件机制了解一下门槛.

## protoc 代码生成插件机制

由于 Protobuf 是跨语言的, 所以在使用的时候需要为目标语言生成代码, 这些生成代码的工具就是 protoc(Protocol Compiler) 的插件. 用一句话概括: 插件就是一个命令行工具, 负责根据标准输入读取的 `CodeGeneratorRequest` 消息生成目标代码, 并且序列化成 `CodeGeneratorResponse` 格式写入标准输出(两种消息类型都是 protobuf 消息类型).

插件可执行文件需要命名成 `protoc-gen-$NAME` 的形式, 并且需要放在 PATH 里直接可以调用, 会在命令中有 `--${NAME}_out` 参数时被调用. `--${NAME}_out` 参数控制传递给**插件的参数**和**生成文件输出目录**, 并且是以 `${OPTION},${OPTION}:${OUT_PATH}` 的形式, 后续又出现了一个新的参数 `--${NAME}_opt` 专门来负责参数传递, 区分开了两个功能. 也就是 `--${NAME}_out=${OPTION},${OPTION}:${OUT_PATH}` 等于 `--${NAME}_out=${OUT_PATH} --${NAME}_opt=${OPTION},${OPTION}` 这种新形式.

举个简单的例子:

```sh
protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    ./pb/origin-hello.proto
```

上面的命令使用了 `protoc-gen-go` 和 `protoc-gen-go-grpc` 两个插件, 传递给 `protoc-gen-go` 的参数为 `paths=source_relative`, 传递给 `protoc-gen-go-grpc` 参数也是 `paths=source_relative`.

## buf 功能

### 依赖管理

我们知道 `模块依赖` 是编程语言中很常见的代码共享机制, 很多语言都有自己的包管理工具, 例如 NodeJS 的 npm. 众所周知 pb 也支持文件引用, 但是使用方式确是十分原始 -- 复制粘贴代码/文件. 这种方式非常容易造成不同步.

buf 为 pb 提供了包管理功能和包仓库(https://buf.build). 官方维护了一些常用的三方包, 例如: `envoyproxy/protoc-gen-validate`.

我们可以在项目 `buf.yaml` 中定义依赖:

```yaml
# buf.yaml
version: v1
deps:
  - buf.build/envoyproxy/protoc-gen-validate
```

使用 `buf mod update` 拉取依赖, 并且会生成 `buf.lock` 文件锁定版本. 更多使用方面细节请查看官方文档.

这一步使得我们不同的项目可以使用现代化的模式依赖三方包, 并且锁定版本. 不过真实业务中大多数时候只会出现很少需要不同业务引用 pb 的情况.

### 优化代码生成工作流

上文可以看到插件机制很复杂, 所以大多数时候大家都是以脚本的方式管理不同语言生成命令.

其实代码生成还有两个细节, 一个是假如有引用需要 `-I` 指定所有 import path, 二是源文件需要维护多语言 `option`.

这里举一个例子(引用最常见的 Well-Known Types):

```protobuf
syntax = "proto3";

package pb;

option go_package = "github.com/zcong1993/grpc-example/pb;pb";
option java_package = "com.zcong1993.example.pb";
option java_multiple_files = true;

import "google/protobuf/timestamp.proto";

message EchoRequest {
    string message = 1;
    google.protobuf.Timestamp ship_date = 2;
}
```

这时候你会发现需要一个这样的构建命令:

```sh
protoc -I. -I/usr/local/include \
    --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    pb/origin-hello.proto
```

会发现需要一个 `-I/usr/local/include` 参数, 这个参数是告诉 protoc pb import 源文件搜索范围, 而且这个 include 需要手动将 protobuf release 中的 include 文件夹 copy 到本地, 因为我们使用的是 protobuf 官方的扩展类型.

回过头查看源文件, 发现有一些 `option` 参数, 这是文件级别的面向不同语言插件的配置. `go_package` 和 `java_package` 控制的是该文件对应的生成代码的包名, 原因是 pb 是支持引用的, 所以生成出的代码需要引用对应的 pb 的生成代码, 所以需要知道包的引用路径. 这是一件重复性很强的工作, 更致命的是: 不同语言的团队可能需要修改对方的文件, 增加自己语言的参数, 因为不同语言可能互相不熟悉, 不知道对方需要什么样的形式.

那么看看 buf 是怎么解决这两个问题的.

对于 import path, 首先 buf 将 `Well-Known Types` 类型的源文件内置了, 不需要额外指定和下载官方的源文件; 二是因为有了包管理机制, buf 会将项目 deps 指定的依赖从远端拉取缓存到本地, 然后将这个目录自动包含.

对于源文件 `option` 参数, buf 提供了 `Managed mode`, 其实就是支持全局配置规则.

```yaml
# buf.gen.yaml
version: v1
managed:
  enabled: true
  java_multiple_files: true
  java_package_prefix: com.zcong1993.example
  go_package_prefix:
    default: github.com/zcong1993/grpc-example/pb
    except:
      - buf.build/googleapis/googleapis
```

`go_package_prefix` 可以指定 go 语言 package 前缀, 后续的会根据 pb 源文件的相对路径拼接. 更多配置参数可以查看文档 [https://docs.buf.build/generate/managed-mode](https://docs.buf.build/generate/managed-mode). 不再需要在 pb 文件中指定这些参数.

最后, buf 使用 yaml 来配置代码生成插件:

```yaml
# buf.gen.yaml
version: v1
plugins:
  - name: go
    out: go
    opt: paths=source_relative
  - name: go-grpc
    out: go
    opt:
      - paths=source_relative
      - require_unimplemented_servers=false
```

这样就相当于上面的配置, 是不是感觉门槛和使用方面体验好了很多.

### lint 工具

静态检查有助于提高代码质量, 和提前发现一些错误.

例如可以统一风格:

```protobuf
// wrong
message Test_Message {
  string fileUrl = 1;
}

// right
message TestMessage {
  string file_url = 1;
}
```

详细的文档可以查看文档 [https://docs.buf.build/lint/rules](https://docs.buf.build/lint/rules), 相当于一份最佳实践. 对于团队而言, 统一代码风格也是非常重要的.

### breaking change 检查

Protobuf 比 JSON 更容易产生不兼容性, 并且很多时候会在不经意间产生不兼容性. 所以需要检测工具来进行检查和约束, 让开发人员意识到自己做的操作会造成什么后果. buf 提供一个非兼容性检查工具, 可以和版本管理中的某个版本进行比对.

例如: 最常见的不兼容就是修改字段类型或者修改字段名称.

```diff
message LoginRequest {
-  string email = 1;
+  int64 email = 1;
  string password = 2;
}
```

使用命令检测可以看到如下错误:

```sh
buf breaking --against ".git#branch=master"
# proto/petstoreapis/petstore/v1/petstore.proto:77:3:Field "1" on message "LoginRequest" changed type from "string" to "int64".
```

### 其他

buf 还有一些其他功能, 例如: format 格式化工具, workspace 本地 mono repo 支持, 自己实现的高性能 protoc 替代等. 受限于篇幅, 并且官方文档写得非常好, 可以去官方文档直接查看.

## 总结

Protobuf 虽然广泛使用, 但是学习门槛还是很高, 一方面是系统性的资料少, 另一方面是没有太多的广泛认可的最佳实践. buf 的出现为 Protobuf 提供了强有力的现代化工具链, 并且文档也可以算作一份最佳实践, 很多地方都会解释为什么这样, 所以强烈推荐大家去学习.

## 参考资料

- [https://docs.buf.build](https://docs.buf.build)
- [https://github.com/protocolbuffers/protobuf](https://github.com/protocolbuffers/protobuf)
- [https://developers.google.com/protocol-buffers](https://developers.google.com/protocol-buffers)
