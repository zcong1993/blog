---
title: '测试环境 K8S 如何部署数据库'
date: 2020-01-30T23:53:10+08:00
categories:
  - K8S
tags:
  - K8S
draft: false
---

之前文章中也提到，k8s 已经越来越普及，已经变得接近傻瓜式了，无论是生产环境或是开发环境配合别的系统做 CI/CD，相信大家或多或少也都用到了一些。那么，如果让你在测试环境搭建一个数据库，你们怎么做呢？

<!--more-->

## 问题梳理

系统中最复杂的便是 `有状态` 的应用, k8s 中也是相同的，所以 k8s 中关于状态的 `数据卷` 部分使用起来会相对复杂很多。

在使用 `docker` 部署数据库应用时，会使用挂载的数据卷作为数据库数据目录，相当于映射一个本地目录进去。那么这个问题放在 k8s 中其实也是这个数据目录如何持久化的问题，由于测试环境往往是自己搭建的 k8s，无法依赖云服务的 pv 相关傻瓜式服务，所以使得这个问题稍显复杂。

解决这个问题前，我们先看看 k8s 文档中的 pv 类型 [types-of-persistent-volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#types-of-persistent-volumes)，看到各式各样的基本都是各大云平台的适配类型，所以可供我们选择的至于一种 `HostPath` (Single node testing only – local storage is not supported in any way and WILL NOT WORK in a multi-node cluster)。 文档中还很贴心的提醒我们仅可用于测试，并且在多节点中不可用，问题的关键就是如何使其可用。

## 解决思路

`HostPath` 这种类型的数据卷，其实就是使用宿主节点上的某个文件夹作为数据卷映射，类似于直接使用 docker 中的 `-v`，那么为什么在多节点时不可用呢？想一想其实很简单，应用有可能被 k8s 调度到不同的节点，然而文件夹数据卷在节点之间是不会同步的，所以发生调度时，数据会出问题。

所以解决的思路也就是干预 k8s 的调度策略，**注意：此方式不符合云原生理念，且不是高可用，仅供测试使用!** 我们将有状态的容器限制在某个固定节点上，就可以保证容器卷始终是这个节点的相应目录，所以就不会出问题。

## 如何操作

其实在 k8s 上部署比较热门的通用应用最简单稳定的方式就是使用 [helm](https://helm.sh/)，k8s 的包管理器，我们使用 `mongodb` 为例。

由于我们要魔改很多东西，所以我们下载下来：

```bash
helm fetch stable/mongodb --untar --untardir .
```

然后开始根据我们自己情况修改 `values.yaml`，我们的目标是限制容器调度，最简单的操作就是使用 `nodeSelector`，它默认为空值，我们设置为：

```yaml
nodeSelector:
  disktype: persistent
```

也就是将应用调度到具有 `disktype=persistent` label 的节点上，所以我们选择一个节点，打上 label：

```bash
kubectl label nodes $your_node_name disktype=persistent
```

还需注意的是，为了安全，k8s 建议我们不使用 root 用户运行程序，所以官方的 chart 基本都会有这个配置 `securityContext.enabled` 它会指定 `fsGroup` 和 `runAsUser`，某些默认镜像默认使用非 root 用户, 所以我们得手动 `chown -R 1001:100 $your_folder` 相应的文件夹了，不然会出现权限不足的情况。

生成部署配置：

```bash
helm template mongodb . > mongodb.yaml
```

最后魔改生成的 `mongodb.yaml`：

删除 PersistentVolumeClaim，因为我们使用 hostPath， 并修改 volumes 为：

```yaml
volumes:
  - name: data
    hostPath:
      path: /mnt/data/test
      type: DirectoryOrCreate
```

最终生成的部署文件为：

```yaml
---
# Source: mongodb/templates/svc-standalone.yaml
apiVersion: v1
kind: Service
metadata:
  name: mongodb-test
  labels:
    app: mongodb
    chart: mongodb-7.8.1
    release: 'mongodb-test'
    heritage: 'Helm'
spec:
  type: NodePort
  ports:
    - name: mongodb
      port: 27017
      targetPort: mongodb
      nodePort: 30018
  selector:
    app: mongodb
    release: 'mongodb-test'
---
# Source: mongodb/templates/deployment-standalone.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb-test
  labels:
    app: mongodb
    chart: mongodb-7.8.1
    release: 'mongodb-test'
    heritage: 'Helm'
spec:
  strategy:
    type: RollingUpdate
  selector:
    matchLabels:
      app: mongodb
      release: 'mongodb-test'
  template:
    metadata:
      labels:
        app: mongodb
        release: 'mongodb-test'
        chart: mongodb-7.8.1
    spec:
      nodeSelector:
        disktype: persistent
      containers:
        - name: mongodb-test
          image: docker.io/bitnami/mongodb:4.2.2-debian-10-r0
          imagePullPolicy: 'IfNotPresent'
          env:
            - name: MONGODB_SYSTEM_LOG_VERBOSITY
              value: '0'
            - name: MONGODB_DISABLE_SYSTEM_LOG
              value: 'no'
            - name: MONGODB_ENABLE_IPV6
              value: 'no'
            - name: MONGODB_ENABLE_DIRECTORY_PER_DB
              value: 'no'
          ports:
            - name: mongodb
              containerPort: 27017
          livenessProbe:
            exec:
              command:
                - mongo
                - --eval
                - "db.adminCommand('ping')"
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            successThreshold: 1
            failureThreshold: 6
          readinessProbe:
            exec:
              command:
                - mongo
                - --eval
                - "db.adminCommand('ping')"
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
            successThreshold: 1
            failureThreshold: 6
          volumeMounts:
            - name: data
              mountPath: /bitnami/mongodb
          resources: {}
      volumes:
        - name: data
          hostPath:
            path: /mnt/data/test
            type: DirectoryOrCreate
```

部署测试，插入数据，重启会发现不会丢失数据。

## 总结

本文可以算作 `proof of concept`，测试环境数据库的搭建有很多种方式，基本使用 docker 就能解决大多问题，当然也可以追求部署在 k8s 系统内，有助于我们学习 k8s 相关知识。此类问题思路均是如此，将有状态的应用集中部署，数据卷也集中起来，这样测试环境备份，只备份这部分就可以了，也算能够节约点开支吧。
