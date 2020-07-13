---
title: '浅谈 k8s pod 亲和性配置'
date: 2020-07-13T00:52:46+08:00
categories:
  - K8S
tags:
  - K8S
draft: false
---

kubernetes 的出现极大地简化了我们编排分配应用的负担，但是默认条件下，k8s 只能够帮我们做资源上的调度协调。那么如何让 k8s 更 “懂” 我们，能够在满足我们某些特殊需求的前提下进行资源上的自动调度呢？

<!--more-->

## 为什么需要

什么时候需要控制 pod 节点分配呢？想想下面几种场景：

1. 机器学习相关应用希望调度到有 GPU 硬件的机器上
2. 数据库应用需要调度到有 SSD 的机器上
3. 希望 gateway 服务尽量和 service 服务放在一起(服务间有大量通信)

## 干预 pod 调度的方式

### nodeName

`nodeName` 是最直接最基本的方式。它是 PodSpec 的一个字段，如果指定了，则 k8s 会直接将该 pod 调度到该节点，但是限制也很明显：节点不存在或者该节点资源不足的时候会调度失败。

所以一般不会使用这种方式。因为这样调度相当于将该 pod 置于单点节点上面，并且云厂商的节点名称不总是稳定的。

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

### 亲和性与反亲和性

虽然上面两种方式已经可以帮助我们解决很多问题, 但是还是有很明显的不足:

1. 都是必须满足的要求, 没有符合要求的 node 时, pod 会调度失败
2. nodeSelector 标签间关系只能是 AND, 即所有 label 必须同时满足

所以 k8s 提供了更加强大的亲和与反亲和配置.

亲和性与反亲和性分为两种: `节点亲和性` 和 `pod 亲和与反亲和`.

#### 节点亲和性

顾名思义 `节点亲和性` 相当于加强版的 `nodeSelector`, 控制 pod 与 node 之间的亲和关系. k8s 目前支持的节点亲和有两种 `requiredDuringSchedulingIgnoredDuringExecution` 和 `preferredDuringSchedulingIgnoredDuringExecution`, 前者指条件 _必须_ 满足, 而后者指 _尽量_ 满足(不保证总是满足). 而 IgnoredDuringExecution 的意思是节点标签发生变化时, 并不会驱逐不符合条件的 pod.

节点的亲和性通过 PodSpec 的 `affinity` 字段下的 `nodeAffinity` 字段进行指定. 操作符支持 `In`, `NotIn`, `Exists`, `DoesNotExist`, `Gt`, `Lt`. 反亲和性通过 `NotIn` 和 `DoesNotExist` 实现.

我们用这种方式实现上面 nodeSelector 中的例子:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: machine-learning-app
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: gpu
                operator: In
                values:
                  - true
  containers:
    - name: machine-learning-app
      image: machine-learning-app
      imagePullPolicy: IfNotPresent
```

如果同时指定了 `nodeAffinity` 和 `nodeSelector`, 则 _必须同时满足_ 两个条件的 node 才是可调度的 (AND 关系).
如果指定了多个 `nodeSelectorTerms`, 则 _满足任意一个_ `nodeSelectorTerms` 的 node 均是可调度的 (OR 关系).
如果指定了多个 `matchExpressions`, 则 _必须同时满足_ 所有 `matchExpressions` 条件的 node 才是可调度的 (AND 关系).

`preferredDuringSchedulingIgnoredDuringExecution` 中的 `weight` 字段则是计算权重, 多个条件权重加起来, 分数最高的 node 被调度的优先级最高.

更多配置细节可查看 [节点亲和设计文档](https://github.com/kubernetes/community/blob/master/contributors/design-proposals/scheduling/nodeaffinity.md).

#### pod 亲和与反亲和

`pod 亲和与反亲和` 主要是根据已经在(X)节点上运行的 pod 标签来约束当前 pod 是否调度到该类节点. 为什么是该类节点呢? 因为 X 表示的是一个拓扑域, 例如: 我们可以控制两个 pod 运行在同一个 node 上, 也可以控制两个 pod 运行在不同的 region 上面, `topologyKey` 就是来控制这个的, 最常用的值为 `kubernetes.io/hostname`. 同样 pod 亲和节点也有两种 `requiredDuringSchedulingIgnoredDuringExecution` 和 `requiredDuringSchedulingIgnoredDuringExecution`.

pod 亲和与反亲和通过 PodSpec 的 `affinity` 字段下的 `podAffinity` 和 `podAntiAffinity` 字段指定, 前者为亲和性后者为反亲和性. 操作符仅支持 `In`, `NotIn`, `Exists`, `DoesNotExist`.

我们来解决一下开头的问题 3:

```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: service
spec:
  selector:
    matchLabels:
      app: service
  replicas: 3
  template:
    metadata:
      labels:
        app: service
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - key: app
                    operator: In
                    values:
                      - service
              topologyKey: 'kubernetes.io/hostname'
      containers:
        - name: service
          image: service:latest
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
spec:
  selector:
    matchLabels:
      app: gateway
  replicas: 3
  template:
    metadata:
      labels:
        app: gateway
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - key: app
                    operator: In
                    values:
                      - gateway
              topologyKey: 'kubernetes.io/hostname'
        podAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - key: app
                    operator: In
                    values:
                      - service
              topologyKey: 'kubernetes.io/hostname'
      containers:
        - name: gateway
          image: gateway:latest
```

我们设置 service pods 间的反亲和性, 使得任意两个 service pods 不得调度在同一个 node 上面. 设置 gateway pods 间反亲和性使得任意两个 gateway pods 不得调度在同一个 node 上面, 并且设置亲和性使得 gateway pod 必须调度到运行了 service pod 的 node 上面. 因此我们的集群可能会是这样:

| node-01       | node-02       | node-03       |
| ------------- | ------------- | ------------- |
| service-xxx-1 | service-xxx-2 | service-xxx-3 |
| gateway-xxx-1 | gateway-xxx-2 | gateway-xxx3  |

如果将上面的 `topologyKey` 值换为 `topology.kubernetes.io/region` 就可以保证 pods 在区域之间的调度.

假如我们将 `replicas` 设置为 4 而我们仅有 3 个节点, 那么只能成功运行 3 个节点, 因为我们使用的是 `requiredDuringSchedulingIgnoredDuringExecution` 硬性标准.

`requiredDuringSchedulingIgnoredDuringExecution` 如果指定了多个 `matchExpressions`, 则 _必须同时满足_ 所有 `matchExpressions` 条件的 node 才是可调度的 (AND 关系).

_注意:_ 相信你也能感受到 pod 间的亲和反亲和需要大量计算处理, 依赖大量的 pod 和 node 状态信息, 所以会显著减慢大规模集群中的调度速度, k8s 官方不建议在超过数百个节点的集群中使用它们.

更多配置细节可查看 [pod 间亲和/反亲和](https://github.com/kubernetes/community/blob/master/contributors/design-proposals/scheduling/podaffinity.md).

## 总结

简单来说 `nodeSelector` 可以解决我们 80% 的问题, 剩下的问题便需要节点或者 pod 亲和性来解决了. 一个很基本的例子是: 假如我们某个应用峰值的时候, 我们只有将它尽量分散开才能减轻集群负载(因为 k8s 默认不保证同类 pods 均匀调度), 这时我们使用 pod 亲和性便可以解决问题.

![wxmp](/wxmp_tiny.png)
