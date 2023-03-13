---
title: 在 k8s 中使用 gRPC Go 服务发现
date: 2021-03-15T16:51:07+08:00
cover: /grpc-lb-k8s/cover.jpg
description: k8s 已经成为云时代云平台的一等公民, 本文介绍下如何在 k8s 中使用 grpc 服务发现.
categories:
  - gRPC
  - RPC
  - Golang
  - K8S
tags:
  - gRPC
  - RPC
  - Golang
  - K8S
draft: false
---

k8s 已经成为云时代云平台的一等公民, 本文介绍下如何在 k8s 中使用 grpc 服务发现. 如果没看上篇文章, 请先查看上篇文章 [gRPC Go 服务发现与负载均衡](/post/2021-03-06-grpc-go-discovery-lb).

<!--more-->

如果在 k8s 中使用 HTTP 作为服务间调用, 那么我们直接使用 `http://serviceName:port` 就可以请求, service 自身会帮我们做好负载均衡. 但是上篇文章也分析过 grpc 是长连接, 直接使用 service 相当于基于连接的负载均衡, 所以要寻找别的途径.

## 内置 resolver

grpc 内置三种 resolver: `passthrough`, `manual` 和 `dns`, 下文分别从这三种分析.

### passthrough 模式

[passthrough.go](https://github.com/grpc/grpc-go/blob/21976fa3e3/resolver/passthrough/passthrough.go) 是 grpc 全局默认 resolver, 也就是我们传递的地址没有 scheme 时便会使用 passthrough 模式.

此模式和名字一样简单, 就是直接穿过, 在 resolve 阶段什么都不做, 直接将我们的地址作为 addrs 传给底层连接, 也就是真正 `Dial` 时才处理地址解析之类的事情.

使用 `serviceName:port` 作为地址连接时, serviceName 会被解析到对应的 service ip, 然后连接时会负载均衡到某一个 pod. 因此根本做不到服务发现和负载均衡.

当连接的 pod 退出时, 连接会断掉触发 grpc 重连, 再通过 serviceName 连接时, 连接到的也会是健康的 pod.

### manual 模式

[manual.go](https://github.com/grpc/grpc-go/blob/21976fa3e3/resolver/manual/manual.go) 是纯手动管理, 主要暴露两个方法: `r.InitialState(s resolver.State)` 和 `r.UpdateState(s resolver.State)`. 明显不适合 k8s, 因为 pod 重启或者 node 重启或者扩容缩容时 pod 的 ip 都会发生改变.

### dns 模式

[dns_resolver.go](https://github.com/grpc/grpc-go/blob/21976fa3e38a266811384409bc8b25437cc1ff1d/resolver/dns/dns_resolver.go) dns 模式会在 resolve 阶段通过 `dns lookup` 将 host 解析成 ip, 作为 addrs 传入底层连接.

连接地址传入 `dns:///serviceName:port` 时, serviceName 会通过 dns 解析, 传入底层连接地址会变成 `['x.x.x.x:port']`. 但是直接使用 serviceName 时, 解析出的 ip 是 service 的 ip, 然后底层 Dial 时, 也通过 service 和一个 pod 建立连接, 还是做不到服务发现和负载均衡.

#### k8s headless service

当我们不想使用 k8s 自己的负载均衡时, k8s 提供了一种特殊的 service: [Headless Services](https://kubernetes.io/zh/docs/concepts/services-networking/service/#headless-services). `dns lookup` headless service 时, 会直接返回所有符合条件的 pod ip A 记录.

下面做一个简单测试:

```yml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: server-deployment
  labels:
    app: server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: server
  template:
    metadata:
      labels:
        app: server
    spec:
      containers:
        - name: server
          image: zcong/grpc-example:dns
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: headless-grpc-server
spec:
  clusterIP: None # spec.clusterIP 设置为 None, 表示这是一个 headless service
  selector:
    app: server
  ports:
    - protocol: TCP
      port: 8080
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: grpc-server
spec:
  selector:
    app: server
  ports:
    - protocol: TCP
      port: 8080
      targetPort: 8080
```

[cmd/dns/k8s.yml](https://github.com/zcong1993/grpc-example/blob/d08b33fc99/cmd/dns/k8s.yml)

首先部署一个 demo 服务, 接着我们测试一下 dns, 看看区别, 运行:

```bash
$ kubectl run --rm dnsutil -it --image-pull-policy='IfNotPresent' --image zcong/dnsutils:1.1 sh
# 普通 service
$ nslookup grpc-server
# Server:		10.152.183.10
# Address:	10.152.183.10#53

# Name:	grpc-server.default.svc.cluster.local
# Address: 10.152.183.224

# headless service
$ nslookup headless-grpc-server
# Server:		10.152.183.10
# Address:	10.152.183.10#53

# Name:	headless-grpc-server.default.svc.cluster.local
# Address: 10.1.139.17
# Name:	headless-grpc-server.default.svc.cluster.local
# Address: 10.1.139.10
```

可以看到解析出来的结果确实是: 普通 service 解析出 service ip, headless 解析出所有 pod 的 ip.

接着测试负载均衡:

```bash
# 运行一个 grpc 测试容器, 作为 client 连接服务端
$ kubectl run --rm grpc-test -it --image-pull-policy='IfNotPresent' --image zcong/grpc-example:dns sh
# 启动 client, 每秒发送一个请求, 服务端将请求返回
$ client -server headless-grpc-server:8080
```

查看服务端日志:

```bash
# 使用 stern 聚合 server-deployment 所有 pod 的日志
$ stern server -t -s 1s
```

**注:** stern 安装查看项目官方 repo [stern/stern](https://github.com/stern/stern).

![log1.png](/grpc-lb-k8s/log1.png)

可以看到服务端确实交替收到请求, 也就是达到了服务发现和负载均衡效果.

那么结束了吗?

其实还没有, 当我们在 client 一直连接的情况下 kill 一个 pod 触发重启, ip 发生变化时, 会发现新出现的 pod 不会收到任何请求.

![log2.png](/grpc-lb-k8s/log2.png)

断开 client 重新连接时, 又会正常.

出现这种状况的原因是 grpc dns 解析会缓存解析结果, resolve 阶段之后每 30 分钟才会刷新一次, pod 下线时, grpc 会剔除掉不健康的地址, 但是新地址必须要在刷新之后或者重新连接时才能解析到. 细节查看 [grpc/grpc/issues/12295](https://github.com/grpc/grpc/issues/12295), 并且官方不认为这是个问题.

#### 解决方案

有人提出了一个比较奇怪的方案, 通过设置 server 端 `MaxConnectionAge` 来定时 `踢掉` client 连接. 细节查看 [grpc/keepalive#ServerParameters](https://pkg.go.dev/google.golang.org/grpc/keepalive#ServerParameters).

更改 k8s 文件, 启用服务端参数:

```yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: server-deployment
  labels:
    app: server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: server
  template:
    metadata:
      labels:
        app: server
    spec:
      containers:
        - name: server
          image: zcong/grpc-example:dns
          imagePullPolicy: IfNotPresent
          command:
            - server
            - -maxConnectionAge
          ports:
            - containerPort: 8080
```

[cmd/dns/k8s2.yml](https://github.com/zcong1993/grpc-example/blob/d08b33fc99/cmd/dns/k8s2.yml)

![log3.png](/grpc-lb-k8s/log3.png)

发现经过一段时间(maxConnectionAge 设置的是 30s), grpc client 确实 '发现' 了新 pod. 但是这种只是种 `trick`, 谁会想到 server 端的 `maxConnectionAge` 参数竟然是为了帮助 client 端发现新服务. 微软的 [https://dapr.io](https://dapr.io) 项目就是使用这种方式解决 k8s 服务发现和证书过期的问题.

## 使用 k8s api 实现 resolver

k8s 向外暴露了集群信息 API, 使用 [Endpoints read API](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#-strong-read-operations-endpoints-v1-core-strong-) 得到 service 对应所有 pod ip, 并且可以通过 `watch` API 得到变化事件, 实现原理几乎和 `etcd resolver` 差不多.

可以参考 [sercand/kuberesolver](https://github.com/sercand/kuberesolver) 项目.

## 使用 etcd resolver

完全抛弃 k8s 相关组件, 实现参考上篇文章.

## 总结

除去不符合要求的集中方式, 对比下几种方式优缺点:

|          方式          |                     优点                      |                                 缺点                                 |
| :--------------------: | :-------------------------------------------: | :------------------------------------------------------------------: |
| dns (maxConnectionAge) | 使用方便, 只需增加参数和使用 headless service | 手段 trick, 并且需要定时断开底层连接, 需要权衡 maxConnectionAge 参数 |
|        k8s api         |                 实时, 无依赖                  |          需要配置 ServiceAccount 权限, 仅能在 k8s 内部使用           |
|          etcd          |         实时, 部署环境不限于 k8s 内部         |                        需要额外维护 etcd 服务                        |

个人建议使用 `etcd` 方式.

示例项目代码 [zcong1993/grpc-example](https://github.com/zcong1993/grpc-example).
