---
title: 使用 loki 作为 k8s 应用日志收集器(上篇)
date: 2020-08-03T00:39:39+08:00
categories:
  - K8S
  - 日志
  - loki
tags:
  - K8S
  - 日志
  - loki
draft: false
---

应用日志是我们的好朋友, 不仅在排查错误时必不可少而且还有助于我们了解应用运行状态. 虽然现在到了 K8S 的时代, 但是它并没有提供一个开箱即用的日志解决方案, 那么我们该怎么做呢?

<!--more-->

## 为什么需要日志收集器

刀耕火种的时代, 日志基本会被通过文件记录在运行应用的宿主机上面, 所以查看日志就是登陆该宿主机, 然后查看相应的文件. 这种方式非常不方便, 首先需要频繁登陆服务器, 其次有时候应用不止部署一个实例, 假如我们拥有十个实例运行在十台机器上, 那么这种方式将会变成噩梦.

为了解决这些痛点, 后面出现了中心化日志平台, 比如大名鼎鼎的 [ELK](https://www.elastic.co/cn/what-is/elk-stack), 后面继续发展出了 EFK(Elasticsearch + Fluented + Kibana). 基本架构都是应用节点会有 agent 收集日志, 传输到集中化的服务存储和索引, 最后可以通过图形化界面统一查询.

## 容器化应用日志处理

一般来说应用日志可以分为三大类:

1. 标准输出和标准错误流(std)
2. 写入本地文件
3. 写入某种存储(数据库等)

分别分析下这三种, 第一种肯定不会使用, 因为没有持久化; 第二种非常常见, 例如 nginx 服务之类的都会将日志写入本地文件, 此种方式弊端就是需要日志收集器来收集聚合多副本应用的日志; 第三种也有很多限制, 例如一般存储对于应用来说都是远程的, 此种方式需要解决性能问题(例如批写入), 后面还要自己实现数据查询问题.

容器化时代最普遍也最推荐的方式是第一种, 原因主要有这几点:

1. pod 退出时如果日志文件没有使用挂载 volume 会丢失
2. docker runtime 会帮我们收集容器标准输出到宿主机文件中
3. 日志文件 rotate 不需要我们自己做

这种方式的优点是, 日志具有了独立的存储和生命周期，与节点、pod 或容器的生命周期相独立, 可以避免 pod 重启或节点重启导致日志文件丢失.

所以对于容器化应用日志收集就可以转化为 应用日志输出到标准输出 -> 日志收集器收集 docker 保存的应用日志文件.

k8s 集群日志收集架构往往是这样的:

![logging-with-node-agent](/logging-with-node-agent.png)

其实就是应用 pod 输出日志到标准输出, 容器运行时帮我们持久化到本地文件, 并处理 rotate, 然后我们在节点上运行一个 log agent, 将日志发送到中心化日志收集服务后台.

有人会说, 记录日志文件时我们可以将不同级别日志记录不同文件, 那么标准输出怎么做呢?

一般推荐使用两种格式: [logfmt](https://brandur.org/logfmt) 和 `json` 格式, 并且要有 `level` 和 `timestamp` 字段. logfmt 格式是键值形式 `level=debug ts=2020-08-02T15:12:53.456Z caller=manager.go:116 msg="no file"`, 这种格式在 go 语言知名项目中均有大范围应用, 例如: prometheus 和 grafana. 有了这两个字段, 日志收集器便可以轻松处理了, 就可以达到相同目的了.

_ps:_ 我们最好能够统一我们业务应用的日志格式, 使用社区认可的广泛使用的格式, 日志 parser 基本都可以开箱即用, 省心省事.

## loki 是什么

[loki](https://github.com/grafana/loki) 官方是这么介绍自己的: Loki 是一个 `可水平扩展`, `高可用`, `多租户` 的日志聚合收集系统, 并且追求高性能和易于部署.

对比一下它和别的日志收集系统:

- 由于它不创建全文索引, 而且只存储压缩后的非结构化日志和元信息索引, 所以很轻量级易于部署
- 索引和分组与 Prometheus 使用相同的 label
- 非常适合收集 k8s pod 日志信息, 类似 pod labels 这些元信息都是自动收集并添加索引的
- 直接可以对接 Grafana 作为日志查询界面

相对于 ELK 需要的资源更少, 并且更易于部署.

loki 组件也基本分为三个:

- `promtail` 日志收集 agent, 收集日志并发送给 loki
- `loki` 核心服务, 存储日志和索引, 并提供查询服务
- `Grafana` 日志查询界面

可以看到, 组件和 ELK 基本一样, 并且符合 k8s 的日志收集架构.

## loki 如何部署

根据上面的组件架构, 可以看出 `promtail` 需要运行在所有运行应用容器的节点, 所以会是 `DaemonSet`, `loki` 作为核心服务, 带有持久化存储而且支持横向扩展, 所以应该是 `StatefulSet`, `Grafana` 是比较基本的独立应用, 可以复用已部署的.

最简单的方式还是使用 `helm`, loki 官方已经提供了生产可用的 chart.

```bash
# 增加源并更新
$ helm repo add loki https://grafana.github.io/loki/charts
$ helm repo update
# 拉取 chart
$ helm fetch loki/loki-stack --untar --untardir .
$ cd loki-stack
# 将 values.yaml 中的 grafana.enable 改成 true, 因为我们需要部署 grafana
# 生成 k8s 配置
$ helm template loki . > loki.yaml
# 部署
$ kubectl apply -f loki.yaml
```

_ps:_ 我个人喜欢在本地生成出部署文件, 手动部署, 这样可以学习生成出来的配置文件, 并且手动做某些更改时会更方便.

等待 pod 启动完成后我们就可以看到进入 grafana 查看了:

```bash
# 输出 grafana 登录密码
$ kubectl get secret --namespace default loki-grafana -o jsonpath="{.data.admin-password}" | base64 --decode ; echo
# port forward 让我们能够访问 grafana service
$ kubectl port-forward --namespace default service/loki-grafana 3000:80
```

接着打开 http://localhost:3000 进入 grafana 界面(用户名使用 admin), 点击 Explore 并且选择 label 就可以查看日志了.

![loki grafana](/loki-01.png)

### 部署应用测试日志收集

这里我写了一个简单的 NodeJS 程序, 每一秒钟会打印一条 `logfmt` 格式的日志, 并且随机 level.

<!-- prettier-ignore-start -->
{{< code language="yaml" title="test-pod.yaml" id="1" expand="Show" collapse="Hide" isCollapsed="false" >}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: log-test-deployment
  labels:
    app: log-test
spec:
  replicas: 2
  selector:
    matchLabels:
      app: log-test
  template:
    metadata:
      labels:
        app: log-test
    spec:
      containers:
        - name: log-test
          image: zcong/node-log:latest
          imagePullPolicy: IfNotPresent
{{< /code >}}
<!-- prettier-ignore-end -->

部署好了之后, 就可以在 grafana 中看到了:

![loki 02](/loki-02.png)

`{app="log-test"} |= "error"` 相当于 `grep` 命令, 供我们筛选日志, 更多操作符请查看文档 [LogQL](https://github.com/grafana/loki/blob/master/docs/sources/logql/_index.md).

## 后记

本文介绍了 `loki` 并且介绍了如何快速部署它, 可以看到真的是傻瓜式部署, 对于开发测试环境来说, 性价比非常高得提升了查看日志效率. 笔者测试环境已经用上了 loki(loki 稳定之前尝试过 EFK, 但是 es 对于简陋的测试服务器来说压力有点大...并且 EFK 没法做到开箱即用).

下一篇文章将会写一下对于 loki 的个性化配置, 通过探索如何使用 loki 收集应用内日志文件, 来加深对 loki 和 k8s 日志系统的理解.

![wxmp](/wxmp_tiny.png)
