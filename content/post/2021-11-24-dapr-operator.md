---
title: Dapr 源码解析 | Operator
date: 2021-11-24T16:52:50+08:00
cover: /dapr-operator.png
description: 本文介绍 Dapr Operator 相关源码.
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

dapr operator 是 dapr 的几个独立软件之一.

operator 是对 k8s 功能的扩展, 可以用来扩展 CRD 做更精细化的事情, 例如: 自动化运维部署高可用数据库, 因为它是用代码解决问题而不是配置.

<!--more-->

**注意:** dapr operator 使用 [Kubebuilder](https://github.com/kubernetes-sigs/kubebuilder) 框架, 由于本人对 k8s operator 和该框架的理解仅仅停留在看了文档, 并没有真正动手实践过, 所以如果出现理解错误, 麻烦读者指正, 并且最好以官方文档为准.

## 总览

总得来说 dapr operator 功能分为三个部分:

1. CRD 定义
2. operator API Server
3. k8s controller

## CRD

k8s CRD 大家应该比较熟悉, dapr CRD 定义源码位于 `pkg/apis` 文件夹下, 一共有 `components`, `configuration` 和 `subscribtions` 三种. 而且使用 kubebuilder 根据代码定义类型可以生成出 k8s CRD 定义配置文件.

以 component 为例:

```go
// +genclient
// +genclient:noStatus
// +kubebuilder:object:root=true

// Component describes an Dapr component type.
type Component struct {
  metav1.TypeMeta `json:",inline"`
  // +optional
  metav1.ObjectMeta `json:"metadata,omitempty"`
  // +optional
  Spec ComponentSpec `json:"spec,omitempty"`
  // +optional
  Auth `json:"auth,omitempty"`
  // +optional
  Scopes []string `json:"scopes,omitempty"`
}
```

可以看到有很多 `+` 开头的注释, 这些注释甚至可以进行字段校验(schema 定义为 OpenAPI 类型). 感兴趣的可以使用命令 `make code-generate` 生成配置文件.

```bash
ζ tree config                                                                                             [a8ee3018]
config
├── crd
│   └── bases
│       ├── dapr.io_components.yaml
│       ├── dapr.io_configurations.yaml
│       └── dapr.io_subscriptions.yaml
├── dapr.io_components.yaml
├── dapr.io_configurations.yaml
└── dapr.io_subscriptions.yaml
```

最终经过修改的 crd 文件在 `charts/dapr/crds` 目录下.

部署了 CRD 之后, 就可以使用 k8s API 进行资源增删改查了. dapr 定义的三种 CRD 其实都是配置类的, 也就是只是借助了 k8s 做存储和修改管理, 并没有额外的使用 controller 根据 CRD 更新做动作需求.

## API Server

dapr operator 会启动一个 grpc 服务, 对外提供下面的功能:

```protobuf
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/dapr/proto/operator/v1/operator.proto#L14-L14
service Operator {
  // Sends events to Dapr sidecars upon component changes.
  rpc ComponentUpdate (ComponentUpdateRequest) returns (stream ComponentUpdateEvent) {}
  // Returns a list of available components
  rpc ListComponents (ListComponentsRequest) returns (ListComponentResponse) {}
  // Returns a given configuration by name
  rpc GetConfiguration (GetConfigurationRequest) returns (GetConfigurationResponse) {}
  // Returns a list of pub/sub subscriptions
  rpc ListSubscriptions (google.protobuf.Empty) returns (ListSubscriptionsResponse) {}
}
```

可以看到都是获取上述三种 CRD 资源的功能, dapr runtime 就是通过这些 API 获取相应配置的.

operator 是独立软件, 所以代码入口在 `cmd/operator/main.go` .

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/cmd/operator/main.go#L37-L37
func main() {
  // ...
  go operator.NewOperator(config, certChainPath, !disableLeaderElection).Run(ctx)
  go operator.RunWebhooks(!disableLeaderElection)
  // ...
}
```

去掉非核心代码可以看到只有两行, 分别运行了 `operator.NewOperator` 和 `operator.RunWebhooks` 两个服务. RunWebhooks 功能我们后续再说明, 继续从 NewOperator 函数中寻找 API server.

```go
var scheme = runtime.NewScheme()

// 将类型注册到 runtime scheme 中
// 后续就可以使用 controller runtime client API 拿到 CRD
func init() {
  _ = clientgoscheme.AddToScheme(scheme)

  _ = componentsapi.AddToScheme(scheme)
  _ = configurationapi.AddToScheme(scheme)
  _ = subscriptionsapi_v1alpha1.AddToScheme(scheme)
  _ = subscriptionsapi_v2alpha1.AddToScheme(scheme)
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/operator/operator.go#L66-L66
func NewOperator(config, certChainPath string, enableLeaderElection bool) Operator {
  // ...
  o.apiServer = api.NewAPIServer(o.client)
  // ...
}

func (o *operator) Run(ctx context.Context) {
  // ...
  o.apiServer.Run(certChain)
}
```

去除不相关代码, 可以看到在 NewOperator 函数中使用 `api.NewAPIServer` 创建了 API server 然后在 Run 函数最后启动了服务.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/operator/api/api.go#L69-L69
func (a *apiServer) Run(certChain *dapr_credentials.CertChain) {
  lis, err := net.Listen("tcp", fmt.Sprintf(":%v", serverPort))
  if err != nil {
    log.Fatal("error starting tcp listener: %s", err)
  }

  opts, err := dapr_credentials.GetServerOptions(certChain)
  if err != nil {
    log.Fatal("error creating gRPC options: %s", err)
  }
  s := grpc.NewServer(opts...)
  operatorv1pb.RegisterOperatorServer(s, a)

  log.Info("starting gRPC server")
  if err := s.Serve(lis); err != nil {
    log.Fatalf("gRPC server error: %v", err)
  }
}

```

`apiServer.Run` 函数启动了一个 grpc server, 实现了 proto 声名的功能. `GetConfiguration` 和 `ListSubscriptions` 实现都非常简单, 简单包装了 controller runtime client API.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/operator/api/api.go#L97-L97
func (a *apiServer) GetConfiguration(ctx context.Context, in *operatorv1pb.GetConfigurationRequest) (*operatorv1pb.GetConfigurationResponse, error) {
  key := types.NamespacedName{Namespace: in.Namespace, Name: in.Name}
  var config configurationapi.Configuration
  // 调用 controller runtime client API 拿到配置
  if err := a.Client.Get(ctx, key, &config); err != nil {
    return nil, errors.Wrap(err, "error getting configuration")
  }
  // 转化结果并返回
  b, err := json.Marshal(&config)
  if err != nil {
    return nil, errors.Wrap(err, "error marshalling configuration")
  }
  return &operatorv1pb.GetConfigurationResponse{
    Configuration: b,
  }, nil
}
```

而 `ListComponents` 这里是有点特殊的, 还是因为之前提到的 component 配置可以使用 `secretKeyRef` 的方式引用秘钥, 所以 `ListComponents` 除了拿到 CRD 资源还需要根据 `secretKeyRef` 配置拿到秘钥信息并将真实值填充回去再返回.

```go
func processComponentSecrets(component *componentsapi.Component, namespace string, kubeClient client.Client) error {
  for i, m := range component.Spec.Metadata {
    if m.SecretKeyRef.Name != "" && (component.Auth.SecretStore == kubernetesSecretStore || component.Auth.SecretStore == "") {
      var secret corev1.Secret
      // k8s secrets api 拿到真实值
      err := kubeClient.Get(context.TODO(), types.NamespacedName{
        Name:      m.SecretKeyRef.Name,
        Namespace: namespace,
      }, &secret)
      // 转换
      val, ok := secret.Data[key]
      enc := b64.StdEncoding.EncodeToString(val)
      jsonEnc, err := json.Marshal(enc)
      if ok {
        // 真实值填充到 Value 字段
        component.Spec.Metadata[i].Value = componentsapi.DynamicValue{
          JSON: v1.JSON{
            Raw: jsonEnc,
          },
        }
      }
    }
  }

  return nil
}
```

最后一个 API 是 `ComponentUpdate` , 功能是订阅 component 更新. 订阅通知功能非常常规不做解读, apiServer 封装了 `OnComponentUpdated` 方法, 在 component 更新时调用:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/operator/operator.go#L93-L93
if componentInfomer, err := mgr.GetCache().GetInformer(context.TODO(), &componentsapi.Component{}); err != nil {
  log.Fatalf("unable to get setup components informer, err: %s", err)
} else {
  // syncComponent 包装了 OnComponentUpdated 方法, 加上了类型校验
  componentInfomer.AddEventHandler(cache.ResourceEventHandlerFuncs{
    AddFunc: o.syncComponent,
    UpdateFunc: func(_, newObj interface{}) {
      o.syncComponent(newObj)
    },
  })
}
```

这是非常经典的 k8s informer 事件监听.

## Controller

前面说了, dapr operator CRD 只是单纯的作为配置来使用, 那么为什么还要 controller 呢?

答案在之前 injector 文章中也提到过, 注入了 sidecar 容器 dapr 还不是可用的, 因为还缺少了 dapr sidecar service, 所以这个 service 就是 controller 来控制的.

controller 功能由 `DaprHandler` 实现:

```go
func NewOperator(config, certChainPath string, enableLeaderElection bool) Operator {
  // ...
  daprHandler := handlers.NewDaprHandler(mgr)
  if err := daprHandler.Init(); err != nil {
    log.Fatalf("unable to initialize handler, err: %s", err)
  }
  // ...
}
```

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/operator/handlers/dapr_handler.go#L65-L65
func (h *DaprHandler) Init() error {
  // ...
  return ctrl.NewControllerManagedBy(h.mgr).
    For(&appsv1.Deployment{}). // 监听资源是 Deployment
    Owns(&corev1.Service{}). // 当前 controller 会创建出 Service 资源
    WithOptions(controller.Options{
      MaxConcurrentReconciles: 100,
    }).
    Complete(h)
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/operator/handlers/dapr_handler.go#L93-L93
// controller 逻辑实现
func (h *DaprHandler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
  var deployment appsv1.Deployment
  expectedService := false
  // 拿到变动的 Deployment 资源
  if err := h.Get(ctx, req.NamespacedName, &deployment); err != nil {
    if apierrors.IsNotFound(err) {
      log.Debugf("deployment has be deleted, %s", req.NamespacedName)
    } else {
      log.Errorf("unable to get deployment, %s, err: %s", req.NamespacedName, err)
      return ctrl.Result{}, err
    }
  } else {
    // 忽略已经删除的
    if deployment.DeletionTimestamp != nil {
      log.Debugf("deployment is being deleted, %s", req.NamespacedName)
      return ctrl.Result{}, nil
    }
    // 检查 dapr.io/enabled 注解判断
    expectedService = h.isAnnotatedForDapr(&deployment)
  }

  if expectedService {
    // 保证 dapr sidecar service 存在
    // 出错时 requeue 重试
    if err := h.ensureDaprServicePresent(ctx, req.Namespace, &deployment); err != nil {
      return ctrl.Result{Requeue: true}, err
    }
  }

  return ctrl.Result{}, nil
}
```

k8s 的面向期望状态的编程哲学在上面也有体现, 如果用户的 deployment 配置了 dapr 注解, 那么 controller 需要做的事情就是确保这个 dapr sidecar service 存在. 后续检查和创建 service 的代码比较简单, 值得注意的是 controller 会创建出名为 `{app-id}-dapr` 的 service, 并且根据 `ClusterIP: clusterIPNone` 可以看出是 `Headless Service` , 这个后续 name resolution 部分再做介绍.

## Webhooks

`RunWebhooks` 是 API Server 部分遗留下来最后讲解的. 最开始看到这部分代码时一头雾水, 因为实在想不到 operator 哪部分功能需要 webhook, 并且在部署文件中也没找到对应的配置. 最终在 [kubebuilder 文档](https://book.kubebuilder.io/multiversion-tutorial/webhooks.html)中找到了答案: 多版本 API.

k8s 在处理多版本 API 时需要做兼容性处理, 需要开发者实现不同版本 CRD 类型转换, 文档 [https://book.kubebuilder.io/multiversion-tutorial/conversion-concepts.html](https://book.kubebuilder.io/multiversion-tutorial/conversion-concepts.html) 详细说明了.

回到 dapr 项目中, 可以看到 `subscribtions` 有两个版本的配置: `v1alpha1` 和 `v2alpha1` , 文件夹下都有 `conversion.go` 文件, 并且 `v1alpha1` 实现了 `Hub` 接口, `v2alpha1` 实现了 `Spoke(Convertible)` 接口.

因此这个 webhook 就是 `subscribtions` 的 [CRD conversion webhook](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/#webhook-conversion) .

## 总结

从 dapr 这个简单的 operator, 可以看到 kubebuilder 已经替开发者解决了非常多的重复性劳动, 并且封装了常用最优范式, 使得开发者真正做到了只关心核心逻辑. k8s 这样的系统需要稳定和高性能, 所以 client 端做了非常多的优化, 单独一个 Informer 机制就可以写几篇文章. 所以 k8s 源码还是非常值得学习的.

## **参考资料**

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://docs.dapr.io](https://docs.dapr.io)
- [https://book.kubebuilder.io](https://book.kubebuilder.io)

![wxmp](/wxmp_tiny_1.png)
