---
title: '浅谈 k8s pod 亲和性配置'
date: 2020-07-13T00:52:46+08:00
categories:
  - K8S
tags:
  - K8S
draft: true
---

kubernetes 的出现极大得简化了我们编排分配应用的负担，但是默认条件下，k8s 只能够帮我们做资源上的调度协调。那么如何让 k8s 更 “懂” 我们，能够在满足我们某些特殊需求的前提下进行资源上的自动调度呢？

<!--more-->

## 为什么需要

什么时候需要控制 pod 节点分配呢？想想下面几种场景：

1. 机器学习相关应用希望调度到有 GPU 硬件的机器上
2. 数据库应用需要调度到有 SSD 的机器上
3. 希望 gateway 服务尽量和 service 服务放在一起

## 干预 pod 调度的方式

### nodeName

`nodeName` 是最直接最基本的方式。它是 PodSpec 的一个字段，如果指定了，则 k8s 会直接将该 pod 调度到该节点，但是限制也很明显：节点不存在或者该节点资源不足的时候会调度失败。

所以一般不会使用这种方式。因为这样调度相当与将该 pod 置与单点节点上面，并且云厂商的节点名称不总是稳定的。

### nodeSelector

`nodeSelector` 是比较简单的节点约束设置，即将 pod 调度到包含制定 label 的 node 上面。它也是 PodSpec 的一个字段。符合条件的 node 可以为多个，所以 k8s 会在符合条件的 node 之间保证资源上的自动协调。之前文章 [测试环境 K8S 如何部署数据库](/post/2020-01-30-k8s-deploy-stateful-app) 使用的就是这种方式。

假如我们需要将机器学习应用调度到 GPU 机器上，我们仅需要两步：

#### 给节点打标

需要为 GPU 节点打标，执行 `kubectl label nodes <node-name> <label-key>=<label-value>`，例如我们可以这样 `kubectl label nodes node-01 gpu=true`。

可以通过命令 `kubectl get nodes --show-labels` 和 `kubectl describe node <node-name>` 查看打标是否成功。

#### 添加 nodeSelector 字段到 pod 配置中

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: machine-learning-app
spec:
  containers:
    - name: machine-learning-app
      image: machine-learning-app
      imagePullPolicy: IfNotPresent
  nodeSelector:
    gpu: true
```

这种方式我们可以解决上面问题里的前两个。

![wxmp](/wxmp_tiny.png)
