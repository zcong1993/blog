---
title: 使用 VictoriaMetrics 替换 Prometheus
date: 2021-08-23T15:33:00+08:00
cover: /cover.jpeg
description: 本文讲述笔者将生产环境监控服务从 Prometheus 迁移到了 VictoriaMetrics, 并简单介绍其架构原理.
categories:
  - Devops
  - Monitoring
  - K8S
tags:
  - Devops
  - Monitoring
  - K8S
keywords:
  - Devops
  - Monitoring
  - VictoriaMetrics
  - Prometheus
  - K8s
draft: false
---

[Prometheus](https://prometheus.io) 早已成为服务监控标准, 而监控也是集群可观测性中的重要一环, 也是比较容易落地的一环. Prometheus + Grafana 已经是最为流行的监控方案.

<!--more-->

## Prometheus 没有解决的问题

Prometheus 服务本身只是单纯的指标抓取, 存储, 查询的单机服务, 依然有下面几点没解决的问题:

1. 不支持高可用部署
1. 没法横向扩容
1. 数据采用本地化存储
1. 不支持多租户

对于大多数人来说这几点都不是问题, 因为没有那么大的服务规模但是仍有需求. 为了解决这些问题, 社区衍生出了两大 CNCF 项目 [cortex](https://cortexmetrics.io) 和 [thanos](https://thanos.io).

本文要说的 VictoriaMetrics (后面简称为 vm) 在上面基础上还优化了 tsdb 存储性能, 以及监控服务本身资源消耗.

## 部署 VictoriaMetrics

k8s 现在已是非常普及, 所以本文介绍 k8s 集群如何部署. 对于 k8s 部署此类服务首选 helm, vm 官方支持三种版本: 高可用, 集群版, 单节点版. 官方建议每秒 100w 数据量以下使用单节点版本, 单节点版本也是最好维护的.

> It is recommended using single-node version instead of cluster version for ingestion rates lower than a million of data points per second. Single-node version scales perfectly with the number of CPU cores, RAM and available storage space. Single-node version is easier to configure and operate comparing to cluster version, so think twice before sticking to cluster version.

### 单节点版

一般小公司选择单节点就行了, 对应的 helm 文件为 [VictoriaMetrics/helm-charts/victoria-metrics-single](https://github.com/VictoriaMetrics/helm-charts/tree/master/charts/victoria-metrics-single)

部署的时候注意设置 `scrape.enabled` 为 true, 这样就会自动根据注解 discovery k8s 的 service pod, 和 prometheus 一样了.

### 集群版

对应 helm 文件 [VictoriaMetrics/helm-charts/victoria-metrics-cluster](https://github.com/VictoriaMetrics/helm-charts/tree/master/charts/victoria-metrics-cluster).

集群版分离了几个服务, vmselect, vmstorage, vminsert

### 高可用

高可用版本在集群版本基础上, 组件设置为多个 `replica`, 并且设置了 `replicationFactor` 多副本保证数据安全 [replication-and-data-safety](https://docs.victoriametrics.com/Cluster-VictoriaMetrics.html#replication-and-data-safety).

## 数据迁移

官方工具 `vmctl` 提供各种类型的数据迁移, 文档可见 [vmctl.html](https://docs.victoriametrics.com/vmctl.html).

对于 Prometheus 数据, 首先要保存一个快照, 操作课参考文档 [taking-snapshots-of-prometheus-data](https://www.robustperception.io/taking-snapshots-of-prometheus-data).

如果是通过 k8s 部署, 迁移操作最好使用 pod 完成, 因为迁移操作需要访问 vm 服务, 如果不在集群内部执行迁移操作可能额外需要将 vm 服务暴露出去使得 vmctl 可以访问.

## 架构

vm 分为两个版本单节点(single-node)和集群版(cluster). 单节点版本 all-in-one 对应代码分支为 [master](https://github.com/VictoriaMetrics/VictoriaMetrics/tree/master) 不做说明.

集群版代码对应分支 [cluster](https://github.com/VictoriaMetrics/VictoriaMetrics/tree/cluster), 架构文档 [architecture-overview](https://docs.victoriametrics.com/Cluster-VictoriaMetrics.html#architecture-overview).

![architecture](/vm/architecture.png)

根据架构图可以看出:

- vmstorage 三个服务中唯一有状态的, 存储指标, 响应指标查询结果
- vminsert 无状态, 通过一致性哈希挑选 storage 节点存储接收到的指标
- vmselect 无状态, 聚合查询到的 storage 多个节点的数据响应前端查询请求

唯一有状态的组件是 `vmstorage` 并且只是非常简单的通过一致性哈希分片存储, 节点之间不会有交互.

> vmstorage nodes don't know about each other, don't communicate with each other and don't share any data

源码中搜索一致性哈希库使用 [app/vminsert/netstorage/insert_ctx.go#L158](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/38065bec7b1f7d5880f9e0080093cdee6778013b/app/vminsert/netstorage/insert_ctx.go#L158), 可以查到 insert 使用一致性哈希挑选存储服务节点, 因此我们猜测 vmselect 接到查询请求时, 会像所有存储节点发起查询请求, 由于存储会有索引, 所以发送至不存在数据的存储节点也会很快响应.

## 迁移后效果

以我们生产环境半个月数据为例:

- 存储: 6.5G -> 3.0G
- 内存: 4G -> 0.57G
- grafana 图表页面响应速度也有明显提升

## 相关资源

- [https://github.com/VictoriaMetrics/VictoriaMetrics](https://github.com/VictoriaMetrics/VictoriaMetrics)
- [https://docs.victoriametrics.com/guides/k8s-monitoring-via-vm-single.html](https://docs.victoriametrics.com/guides/k8s-monitoring-via-vm-single.html)
- [https://cortexmetrics.io](https://cortexmetrics.io)
- [https://thanos.io](https://thanos.io)
