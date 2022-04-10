---
title: Dapr 源码解析 | Resiliency
date: 2022-04-08T22:46:30+08:00
cover: /dapr-resiliency.png
description: 本文介绍 Dapr 新功能, Resiliency 弹性容错功能.
categories:
  - Golang
  - Dapr
  - Cloud Native
tags:
  - Golang
  - Dapr
  - Cloud Native
keywords:
  - Golang
  - Dapr
  - Cloud Native
draft: true
---

Dapr 1.17 版本已经发布, 本文介绍 1.17 版本最重磅的功能 `Resiliency` 弹性容错功能.

## 背景

分布式系统往往由非常多的微服务组成, 系统故障出现的可能性就大大增加了. 例如, 一个实例可能由于硬件、过多的请求、应用重启或其他一些原因而失败或无响应, 这些问题会导致应用间调用失败. 所以我们需要让我们的应用具有 **容错性**, 即检测、缓解和响应故障的能力, 使得我们的应用具有自愈能力.

service mesh 往往都会在网络层提供这样的弹性能力. 对于 dapr 来说, 它不但接管了我们的服务间请求, 还提供很多应用和中间件交互的组件, 所以 dapr 在 1.17 版本提供了三种策略, `超时`、`重试` 和 `熔断`, 并且我们可以选择在 `服务间调用`, `component` 和 `actor` 维度使用他们.

## 配置

Resiliency 配置是 kind 是 `Resiliency` , 类型为 CRD 的全局配置, 主要分为 `policies` 和 `targets` 两个部分, 还支持 `scopes` 控制配置生效范围.

```yaml
apiVersion: dapr.io/v1alpha1
kind: Resiliency
metadata:
  name: myresiliency
scopes:
  # 可以指定对哪些 app 生效(范围)
spec:
  policies: # 声明三种策略, targets 来引用
    timeouts:
      # 超时模块配置
    retries:
      # 重试策略配置
    circuitBreakers:
      # 熔断策略配置
  targets: # 为不同的目标指定上述策略
    apps:
      # 服务间调用
    actors:
      # actors 相关
    components:
      # 组件模块
```

`policies` 配置可以分别声明出多种策略, `targets` 则是通过引用上面的 policy 实现对不同模块的弹性功能配置.

### load 配置

配置加载之前文章也有讲过. 分别实现了 k8s 集群内通过 operator 获取 CRD 配置, 非 k8s 集群从文件中加载配置. 具体代码可见 `pkg/resiliency/resiliency.go` 方法为 `LoadKubernetesResiliency` 和 `LoadStandaloneResiliency`, 值得注意的是最终都会通过 `filterResiliencyConfigs` 方法保证只会加载 scope 中包含自己的配置.

## 源码分析

### resiliency module

Resiliency 模块的核心实现在 `pkg/resiliency` 文件夹下.

首先分析 `Policy` 方法, 它是一个高阶函数, 提供了根据三种弹性策略配置生成一个具有弹性能力的 function wrapper, 将应用逻辑放进去执行就可以获得对应的弹性能力.

```go
// https://github.com/zcong1993/dapr-1/blob/3c4510a685470eb8a5403e9d9a451bc93e67e6c4/pkg/resiliency/policy.go#L37
func Policy(ctx context.Context, log logger.Logger, operationName string, t time.Duration, r *retry.Config, cb *breaker.CircuitBreaker) Runner {
  return func(oper Operation) error {
    operation := oper
    // 超时策略
    if t > 0 {
      operCopy := operation
      // 非常经典的 go 语言超时控制
      operation = func(ctx context.Context) error {
        ctx, cancel := context.WithTimeout(ctx, t)
        defer cancel()

        done := make(chan error, 1)
        go func() {
          done <- operCopy(ctx)
        }()

        select {
        case err := <-done:
          return err
        case <-ctx.Done():
          return ctx.Err()
        }
      }
    }

    // 熔断策略
    // 使用 github.com/sony/gobreaker 库
    if cb != nil {
      operCopy := operation
      operation = func(ctx context.Context) error {
        err := cb.Execute(func() error {
          return operCopy(ctx)
        })
        // 熔断生效时, 返回 backoff.Permanent 错误,
        // 让重试失效
        if r != nil && breaker.IsErrorPermanent(err) {
          err = backoff.Permanent(err)
        }
        return err
      }
    }

    if r == nil {
      return operation(ctx)
    }

    // 重试
    // 使用 github.com/cenkalti/backoff/v4 库
    b := r.NewBackOffWithContext(ctx)
    return retry.NotifyRecover(func() error {
      return operation(ctx)
    }, b, func(_ error, _ time.Duration) {
      log.Infof("Error processing operation %s. Retrying...", operationName)
    }, func() {
      log.Infof("Recovered processing operation %s.", operationName)
    })
  }
}
```

整个函数逻辑是简单的使用装饰器模式分别为上层的 Operation 增加了超时, 重试和熔断的能力.

但是从参数可以看出超时和重试仅仅需要传递配置, 但是熔断则是传递了 `CircuitBreaker` 实例, 因为熔断是需要根据历史数据计算熔断器状态的, 也就是有状态的, 并且熔断的粒度在不同场景下是不一样的, 例如服务间调用往往是以 API 请求类型作为维度(rpc method 或者 http endpoint)设置熔断器, 而数据库则经常以整体为维度设置熔断器. 因此引入了下一个关键部分 `Provider` 和 `Resiliency` 管理组织共享超时, 重试配置和熔断器实例.

```go
// https://github.com/zcong1993/dapr-1/blob/3c4510a685470eb8a5403e9d9a451bc93e67e6c4/pkg/resiliency/resiliency.go#L62
// Provider 抽象出了 resiliency 提供者
type Provider interface {
  // 为服务间调用提供 policy runner
  EndpointPolicy(ctx context.Context, service string, endpoint string) Runner
  // actor 相关(不分析)
  ActorPreLockPolicy(ctx context.Context, actorType string, id string) Runner
  // actor 相关(不分析)
  ActorPostLockPolicy(ctx context.Context, actorType string, id string) Runner
  // component 出口相关 (dapr sidecar -> 外部系统(db, queue, redis))
  ComponentOutboundPolicy(ctx context.Context, name string) Runner
  // component 入口相关 (dapr sidecar -> 用户应用)
  ComponentInboundPolicy(ctx context.Context, name string) Runner
}
```

由于 dapr 支持服务间调用, component 和 actor 三个部分的弹性功能, 所以 Provider 需要为各自模块提供获取 Policy Runner 的能力.

`Resiliency` 实现了 `Provider`, 核心点就在于共享熔断器实例.

```go
// https://github.com/zcong1993/dapr-1/blob/3c4510a685470eb8a5403e9d9a451bc93e67e6c4/pkg/resiliency/resiliency.go#L78
type Resiliency struct {
  log logger.Logger

  // policies 中声明的 timeout 策略
  timeouts        map[string]time.Duration
  // policies 中声明的 retry 策略
  retries         map[string]*retry.Config
  // policies 中声明的熔断策略, 会作为 template 使用
  circuitBreakers map[string]*breaker.CircuitBreaker

  actorCBCaches map[string]*lru.Cache
  serviceCBs    map[string]*lru.Cache
  componentCBs  *circuitBreakerInstances

  apps       map[string]PolicyNames
  actors     map[string]ActorPolicies
  components map[string]ComponentPolicyNames
}

type circuitBreakerInstances struct {
  sync.RWMutex
  cbs map[string]*breaker.CircuitBreaker
}
```

timeouts, retries 都会将 policies 中声明的超时, 重试策略保存成 `map[name]config` 的形式, 后面会通过 name 来引用. 但是熔断器配置这里有点特殊, 由于会根据需求存在多个熔断器实例, 所以策略中的熔断器配置会作为 template 来使用.

`actorCBCaches`, `serviceCBs` 和 `componentCBs` 用来管理, 存储, 共享各自模块的熔断器实例.

服务间调用的熔断粒度为 API endpoint, 所以 serviceCBs 类型为 `map[serviceName]lru<endpoint, CircuitBreaker>`, 使用 lru 防止 endpoint 过多导致内存中有太多熔断器实例. 这个 lru 的默认大小为 100, 可以通过配置修改.

接着分析 `EndpointPolicy`, 它的作用是为服务间调用提供 policy runner.

```go
// https://github.com/zcong1993/dapr-1/blob/3c4510a685470eb8a5403e9d9a451bc93e67e6c4/pkg/resiliency/resiliency.go#L360
func (r *Resiliency) EndpointPolicy(ctx context.Context, app string, endpoint string) Runner {
  var t time.Duration
  var rc *retry.Config
  var cb *breaker.CircuitBreaker
  operationName := fmt.Sprintf("endpoint[%s, %s]", app, endpoint)
  if r == nil {
    return Policy(ctx, r.log, operationName, t, rc, cb)
  }
  // 判断目标服务 target 有没有配置
  policyNames, ok := r.apps[app]
  if ok {
    // 根据 timeout 配置 name 获取对应超时策略配置
    if policyNames.Timeout != "" {
      t = r.timeouts[policyNames.Timeout]
    }
    // 根据 retry 配置 name 获取对应超时策略配置
    if policyNames.Retry != "" {
      rc = r.retries[policyNames.Retry]
    }
    if policyNames.CircuitBreaker != "" {
      // 根据熔断器名称获取对应的熔断策略配置
      template, ok := r.circuitBreakers[policyNames.CircuitBreaker]
      if ok {
        // 根据目标 app 拿到 lru 实例
        cache, ok := r.serviceCBs[app]
        if ok {
          // 从缓存中根据 endpoint 拿到对应熔断器
          cbi, ok := cache.Get(endpoint)
          if ok {
            cb, _ = cbi.(*breaker.CircuitBreaker)
          } else {
            // 不存在时根据模板配置创建并缓存
            cb = &breaker.CircuitBreaker{
              Name:        endpoint,
              MaxRequests: template.MaxRequests,
              Interval:    template.Interval,
              Timeout:     template.Timeout,
              Trip:        template.Trip,
            }
            cb.Initialize(r.log)
            cache.Add(endpoint, cb)
          }
        }
      }
    }
  }

  // 最终返回 policy runner factory
  return Policy(ctx, r.log, operationName, t, rc, cb)
}
```

`ComponentOutboundPolicy` 和 `ComponentInboundPolicy` 也是同理, 不过 component 的熔断器是以 component 实例为维度的, 数目是一定的, 所以不需要使用 lru.

### 应用

`Resiliency` 初始化后会放在 runtime 实例上, 在 dapr 的各个组件中共享. dapr sidecar 的 http/grpc server 模块也会拿到这个实例, 最终在对应的 API handler 中使用对应的 factory 初始化 policy runner 包装原来的逻辑.

以 http 服务间调用为例:

```go
// https://github.com/zcong1993/dapr-1/blob/3c4510a685470eb8a5403e9d9a451bc93e67e6c4/pkg/http/api.go#L985
func (a *api) onDirectMessage(reqCtx *fasthttp.RequestCtx) {
  // ...
  // 通过 resiliency.EndpointPolicy 创建 policy runner
  policy := a.resiliency.EndpointPolicy(reqCtx, targetID, fmt.Sprintf("%s:%s", targetID, invokeMethodName))
  err := policy(func(ctx context.Context) (rErr error) {
    // 原有逻辑
  })
  // ...
}
```

grpc server 分为两部分, `InvokeService` 方法和 proxy 模块. component 模块也是同理.

## 总结

dapr 对于弹性功能的实现非常简洁, 都是通过组合开源组件实现的. 并且配置分为了声明和引用两个部分, 减少了配置重复性. 我们自己的服务也可以借鉴这种方式实现自己的弹性模块. 使用 provider 的形式也可以实现 `noopProvider` 空实现的形式兼容未开启此功能的情况.

## **参考资料**

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://docs.dapr.io/operations/resiliency](https://docs.dapr.io/operations/resiliency)

![wxmp](/wxmp_tiny_1.png)
