---
title: 使用 loki 作为 k8s 应用日志收集器(下篇)
date: 2020-08-08T00:40:58+08:00
cover: loki-06.jpeg
description: 上篇文章介绍了日志收集的背景和 loki 的优点, 真正部署的时候基本是一键的(开箱即用部署简单确实是优势)感觉没什么技术含量, 本章将介绍如何使用它来收集容器内日志文件.
categories:
  - K8S
  - log
tags:
  - K8S
  - log
  - loki
draft: false
---

[上篇文章](/post/2020-07-27-use_loki_as_k8s_log_collector) 介绍了日志收集的背景和 loki 的优点, 真正部署的时候基本是一键的感觉没什么技术含量(虽然开箱即用部署简单是优势), 本章将介绍如何使用它来收集容器内日志文件.

<!--more-->

_ps:_ 我们不管使用什么软件, 最好能够入乡随俗, 遵循该生态的一些 `best practice`. 对于 k8s 日志方面, 很重要的一点就是: `推崇使用标准输出打印日志`. 因此本文只是为了通过这个点切入, 讲解 loki 的一些配置, 自己使用时尽量不要使用文件形式.

再次回顾 k8s 日志收集架构:

![logging-with-node-agent](/logging-with-node-agent.png)

想让 promtail pod 收集到我们应用 pod 的日志, 首先要让 promtail 能够读取到日志, 所以我们第一步就是让这些 pod 挂载相同的宿主机 `hostPath` volume.

查看生成出来的 loki promtail 部分 k8s 配置文件, 可以看出 promtail 挂载了宿主机 `/var/log/pods` 目录作为 volume, pod 标准流输出会被存储到这里.

我们选择 `/mnt/log` 作为我们应用日志文件挂载根目录, 这样就可以减少 promtail pod 挂载的 volume 数量:

<!-- prettier-ignore-start -->
```yaml
kind: DaemonSet
metadata:
  name: loki-promtail
  ...
  volumeMounts:
    ...
    - mountPath: /var/log/pods
      name: pods
      readOnly: true
    - mountPath: /mnt/log
      name: custom
      readOnly: true
  ...
  volumes:
    ...
    - hostPath:
        path: /var/log/pods
      name: pods
    - hostPath:
        path: /mnt/log
        type: DirectoryOrCreate # 目录不存在会自动创建
      name: custom
```
<!-- prettier-ignore-end -->

我们应用 pod 也需要挂载这个 hostPath 下的目录作为日志输出目录:

<!-- prettier-ignore-start -->
```yaml
...
volumeMounts:
  - mountPath: /var/log/custom/winston
    name: log
...
volumes:
  - name: log
    hostPath:
        path: /mnt/log/winston
```
<!-- prettier-ignore-end -->

接着就只剩下增加 promtail 配置, 使得我们的日志也能够被收集.

## 方式一 static config 静态配置

挂载了 volume 之后目的很明确, 其实就是要收集 `/mnt/log` 下面的日志文件, 我们简单增加一条静态配置:

<!-- prettier-ignore-start -->
```yaml
- job_name: custom
  pipeline_stages:
  static_configs:
  - labels:
      job: custom
      host: localhost
      __path__: /mnt/log/*/*.log
```
<!-- prettier-ignore-end -->

_ps:_ promtail 配置通过 loki-promtail 这个 ConfigMap 修改. 修改后文件放在了这里 [loki-tail-file.yaml](https://gist.githubusercontent.com/zcong1993/2ed197b97a3286dd958e4c8cfd81e5ea/raw/8604910e8b6f56ff3ad13204db133420ffe01c8e/loki-tail-file.yaml).

可以使用下面这个测试应用测试下, 测试应用还是上一章的应用, 不过这次是输出日志到文件中.

<!-- prettier-ignore-start -->
```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: winston
  name: winston
  namespace: default
spec:
  progressDeadlineSeconds: 600
  replicas: 1
  revisionHistoryLimit: 10
  selector:
    matchLabels:
      app: winston
  strategy:
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 25%
    type: RollingUpdate
  template:
    metadata:
      annotations:
        loki.io/logfile: '/mnt/log/winston/*.log'
      labels:
        app: winston
    spec:
      containers:
        - image: zcong/node-log:latest
          imagePullPolicy: IfNotPresent
          name: winston
          env:
            - name: FILE
              value: 'true'
          resources:
            requests:
              cpu: 250m
              memory: 100Mi
          terminationMessagePath: /dev/termination-log
          terminationMessagePolicy: File
          volumeMounts:
            - mountPath: /var/log/winston
              name: log
      dnsPolicy: ClusterFirst
      restartPolicy: Always
      schedulerName: default-scheduler
      securityContext: {}
      terminationGracePeriodSeconds: 30
      volumes:
        - name: log
          hostPath:
              path: /mnt/log/winston
```
<!-- prettier-ignore-end -->

![loki 04](/loki-04.png)

可以看到日志可以被收集到了, 但是看图也可以看出问题了, 就是我们的 label 是静态的, 没有 pod 信息, 基本只能通过 `filename` 做筛选, 查看日志. 使用起来很不方便, 所以我推荐下面介绍的这种方式, 也就是默认配置的方式: [kubernetes-discovery](https://github.com/grafana/loki/blob/master/docs/sources/clients/promtail/scraping.md#kubernetes-discovery).

## 方式二 kubernetes-discovery

说到 `kubernetes-discovery` 就要了解一下 [Relabel](https://github.com/grafana/loki/blob/master/docs/sources/clients/promtail/scraping.md#relabeling). 简单概括下, 就是使用 k8s node, pod, service 的一些 label 或者 annotation 信息, 来生成 promtail 配置信息.

可以参考 helm 生成出来的配置文件, 我们重点看这几个:

<!-- prettier-ignore-start -->
```yaml
- job_name: kubernetes-pods-name
  pipeline_stages:
    - docker: {}
  kubernetes_sd_configs:
  - role: pod
  relabel_configs:
  - source_labels:
    - __meta_kubernetes_pod_label_name
    target_label: __service__
  - action: drop
    regex: ''
    source_labels:
    - __service__
  ...
  - replacement: /var/log/pods/*$1/*.log
    separator: /
    source_labels:
    - __meta_kubernetes_pod_uid
    - __meta_kubernetes_pod_container_name
    target_label: __path__
```
<!-- prettier-ignore-end -->

重点关注 `action: drop` 和 `target_label: __path__` 这两部分, 上面 action: drop 表示, 如果目标 pod 没有 `__service__` 这个 label 就不收集这个 pod 的日志, 而 `__service__` 其实就是 `__meta_kubernetes_pod_label_name` 最终就是 pod config 里面的 `metadata.labels.name` 的值; 而 `target_label: __path__` 这个是告诉 promtail 这个 pod 对应的日志文件路径, 最终路径为 `/var/log/pods/*<pod_uid>/<container_name>/*.log`. 这样我们就可以动态配置 promtail 了.

对于我们要收集文件的 pod 我们可以配置一个 annotation, 例如: `loki.io/logfile: '/mnt/log/winston/*.log'`, 它有两个使命:

- 告诉 promtail 该收集哪些日志文件
- 忽略掉没有这条 annotation 的 pod

所以我们可以这样配置:

<!-- prettier-ignore-start -->
```yaml
- job_name: kubernetes-pods-custom
  pipeline_stages:
  kubernetes_sd_configs:
  - role: pod
    relabel_configs:
  # 忽略掉没有 loki.io/logfile annotation 的 pod
  - action: drop
    regex: ''
    source_labels:
    - __meta_kubernetes_pod_annotation_loki_io_logfile
      ...
  # 直接使用 loki.io/logfile annotation 的值作为改 pod 日志文件路径
  - action: replace
    regex: (.+)
    source_labels:
    - __meta_kubernetes_pod_annotation_loki_io_logfile
    target_label: __path__
```
<!-- prettier-ignore-end -->

完整配置文件放在这里 [loki2.yaml](https://gist.githubusercontent.com/zcong1993/2ed197b97a3286dd958e4c8cfd81e5ea/raw/2c8504b5f1e3aecf9c874c637be1d5c774c936a3/loki2.yaml).

![loki 05](/loki-05.png)

可以看到我们可以像之前的方式筛选日志了, 做到了和默认配置一样.

## 总结

本文通过如何使用 loki 收集文件类型日志, 简单介绍了 loki 的两种配置方式, 着重介绍了第二种方式. 熟悉 prometheus 的同学肯定发现了: loki 使用了和 prometheus 相同的 relabel 机制, 非常灵活强大, 后面有机会可以单独来写写.

![wxmp](/wxmp_tiny.png)
