---
title: '阿里云 K8S 的角色权限问题'
date: 2019-10-28T17:48:09+08:00
categories:
  - K8S
tags:
  - K8S
draft: false
---

随着 k8s 的成熟, 越来越多的云平台都集成了 k8s, 基本都成了半傻瓜式操作. 我们公司用的是阿里云平台, 但是在进行授权管理时遇到了一些与预想不一致的情况.

<!--more-->

### 背景

由于我们公司没有专职运维人员, 赋予了一些开发者发布权限, 所以我们需要按照需要给不同的开发者不同的权限, 而且为了透明, 新同事也会拥有只读权限.

### 问题

遇到的问题是, 阿里云的访问权限控制粒度太粗, 赋予的权限比预期大.

### 深入了解

首先来看看阿里云 k8s 用户授权说明:

![role](/ali-k8s/role.png)

根据最后一条可以看出, 阿里云其实是通过绑定不同的 `ClusterRole` 给不同的阿里云不同 RAM 账号来实现权限管理的.

k8s 权限管理基本都是基于 `RBAC` 策略为不同角色定义不同的资源和操作来做到权限管理的, 所以 `ClusterRole` 也是通过 RBAC 做权限控制的.

我们看一个定义文件:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: test
rules:
  - apiGroups:
      - ''
    resources:
      - pods
    verbs:
      - create
      - delete
      - deletecollection
      - get
      - list
      - patch
      - update
      - watch
```

其实控制的是不同 api 资源的访问, 比如上图, test 角色就被赋予了 pods 相关 API 的读写权限, 可以看出读操作为 get, list, watch 而剩下来的都算作写权限.

再回头看看阿里云权限说明那张图片, 咋看一下没什么问题, "开发人员, 对所有命名空间或所选命名空间下控制台可见资源的`读写`权限", "受限用户, 对所有命名空间或所选命名空间下控制台可见资源的`只读`权限", 总结一下就是受限用户给只读, 开发人员给读写可以更改.

仔细想想, k8s 的不同资源敏感度是不同的, 比如说 `secret(保密字典)` 服务, 他的安全级别非常高, 里面基本都是敏感信息, 受限用户甚至开发人员都不应该对它有权限, 但是你会发现阿里云的受限用户都可以在管理控制台相应的菜单里面看到保密字典中的数据(只读权限), 还是明文的(因为就算在 k8s 中 secret 值也只是简单的 base64). 同理进入容器的操作也是的.

### 解决方案

我们只能通过最后一种, 自定义 `ClusterRole` 来实现满足自己需求的角色.

比如, 删除 secret 和 exec 权限的开发人员权限:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cs-dev-demo
rules:
  - apiGroups:
      - ''
    resources:
      - pods
      - pods/attach
      # - pods/exec
      - pods/portforward
      - pods/proxy
    verbs:
      - create
      - delete
      - deletecollection
      - get
      - list
      - patch
      - update
      - watch
  - apiGroups:
      - ''
    resources:
      - configmaps
      - endpoints
      - persistentvolumeclaims
      - replicationcontrollers
      - replicationcontrollers/scale
      # - secrets
      - serviceaccounts
      - services
      - services/proxy
    verbs:
      - create
      - delete
      - deletecollection
      - get
      - list
      - patch
      - update
      - watch
  - apiGroups:
      - ''
    resources:
      - events
      - namespaces/status
      - replicationcontrollers/status
      - pods/log
      - pods/status
      - componentstatuses
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - ''
    resources:
      - namespaces
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - apps
    resources:
      - daemonsets
      - deployments
      - deployments/rollback
      - deployments/scale
      - replicasets
      - replicasets/scale
      - statefulsets
    verbs:
      - create
      - delete
      - deletecollection
      - get
      - list
      - patch
      - update
      - watch
  - apiGroups:
      - autoscaling
    resources:
      - horizontalpodautoscalers
    verbs:
      - create
      - delete
      - deletecollection
      - get
      - list
      - patch
      - update
      - watch
  - apiGroups:
      - batch
    resources:
      - cronjobs
      - jobs
    verbs:
      - create
      - delete
      - deletecollection
      - get
      - list
      - patch
      - update
      - watch
  - apiGroups:
      - extensions
    resources:
      - daemonsets
      - deployments
      - deployments/rollback
      - deployments/scale
      - ingresses
      - replicasets
      - replicasets/scale
      - replicationcontrollers/scale
    verbs:
      - create
      - delete
      - deletecollection
      - get
      - list
      - patch
      - update
      - watch
  - apiGroups:
      - servicecatalog.k8s.io
    resources:
      - clusterserviceclasses
      - clusterserviceplans
      - clusterservicebrokers
      - serviceinstances
      - servicebindings
    verbs:
      - create
      - delete
      - get
      - list
      - patch
      - update
      - watch
  - apiGroups:
      - servicecatalog.k8s.io
    resources:
      - clusterservicebrokers/status
      - clusterserviceclasses/status
      - clusterserviceplans/status
      - serviceinstances/status
      - serviceinstances/reference
      - servicebindings/status
    verbs:
      - update
  - apiGroups:
      - alicloud.com
    resources:
      - '*'
    verbs:
      - create
      - delete
      - get
      - list
      - patch
      - update
      - watch
  - apiGroups:
      - policy
    resources:
      - poddisruptionbudgets
    verbs:
      - create
      - delete
      - deletecollection
      - get
      - list
      - patch
      - update
      - watch
```

同理, 受限用户删除权限之后为:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cs-restricted-test
rules:
  - apiGroups:
      - ''
    resources:
      - pods
      - pods/attach
      # - pods/exec
      - pods/portforward
      - pods/proxy
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - ''
    resources:
      - configmaps
      - endpoints
      - persistentvolumeclaims
      - replicationcontrollers
      - replicationcontrollers/scale
      # - secrets
      - serviceaccounts
      - services
      - services/proxy
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - ''
    resources:
      - events
      - replicationcontrollers/status
      - pods/log
      - pods/status
      - componentstatuses
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - apps
    resources:
      - daemonsets
      - deployments
      - deployments/rollback
      - deployments/scale
      - replicasets
      - replicasets/scale
      - statefulsets
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - autoscaling
    resources:
      - horizontalpodautoscalers
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - batch
    resources:
      - cronjobs
      - jobs
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - extensions
    resources:
      - daemonsets
      - deployments
      - deployments/rollback
      - deployments/scale
      - ingresses
      - replicasets
      - replicasets/scale
      - replicationcontrollers/scale
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - servicecatalog.k8s.io
    resources:
      - clusterserviceclasses
      - clusterserviceplans
      - clusterservicebrokers
      - serviceinstances
      - servicebindings
    verbs:
      - get
      - list
      - watch
  - apiGroups:
      - alicloud.com
    resources:
      - '*'
    verbs:
      - get
      - list
  - apiGroups:
      - policy
    resources:
      - poddisruptionbudgets
    verbs:
      - get
      - list
```

运行 `kubectl apply -f xxx.yaml` 部署上面的配置之后, 我们就可以在自定义配置中选择自己定义的那两个角色了.

### 一点小问题

上面操作虽然能解决部分安全问题, 但是账户在访问任何有 secret 和 exec api 调用的页面都会反复弹窗, 说账户缺少某些权限, 特别是在部署如果使用了 secret 的情况, 基本是有几条就会弹几次(取 secret 配置的调用不是 batch 的?). 这些就只能期待阿里云之后调整了.
