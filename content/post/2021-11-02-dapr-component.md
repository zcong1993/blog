---
title: Dapr 源码解析 | 组件模块
date: 2021-11-02T15:50:51+08:00
cover: /dapr-component.png
description: 本文介绍 Dapr Component 部分和源码.
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
draft: false
---

`Components` 是 dapr 抽象出来的提供某种特定功能的可插拔组件, 为 dapr 或者 building blocks 所使用.

例如: 服务发现功能就是 dapr 的一个 component, 它的提供者可以使 mDNS, Kubernetes 和 consul, dapr 允许用户根据需求选择使用提供者的某种.

<!--more-->

## 功能介绍

dapr 目前有如下这些组件:

1. Secret Stores 秘钥管理
2. State Stores 键值存储
3. Pub/sub brokers 发布订阅
4. Name Resolutions 服务发现
5. Bindings 事件绑定
6. Middlewares 中间件

## 实现

由于 component 设计成了可插拔的方式, 所以单个功能会有多种实现方式, 为了方便维护 dapr 将 component 实现代码分离在了 [https://github.com/dapr/components-contrib](https://github.com/dapr/components-contrib) 项目.

我们以 `Secret Stores` 为例, 分析下源码:

首先, 由于是某种特定功能, 所以 component 功能定义为一个 interface.

```go
// http://github.com/zcong1993/components-contrib/blob/ff9f357a77f74a9ebaa0032da71c1f571143a1ca/secretstores/secret_store.go#L9
type SecretStore interface {
  // Init authenticates with the actual secret store and performs other init operation
  Init(metadata Metadata) error
  // GetSecret retrieves a secret using a key and returns a map of decrypted string/string values
  GetSecret(req GetSecretRequest) (GetSecretResponse, error)
  // BulkGetSecrets retrieves all secrets in the store and returns a map of decrypted string/string values
  BulkGetSecret(req BulkGetSecretRequest) (BulkGetSecretResponse, error)
}
```

基本上所有组件定义都分为两个部分, `Init` 和`功能部分`.

Init 方法是用来校验配置和初始化组件. 而 matadata 就是 `map[string]string` 形式的组件配置, 通过 component config 获取, 之前配置模块文章介绍过.

[https://github.com/zcong1993/components-contrib/tree/dapr-v1.4.3/secretstores](https://github.com/zcong1993/components-contrib/tree/dapr-v1.4.3/secretstores) 文件夹下面包含了所有实现 `SecretStore` 的 provider.

以 kubernetes 实现为例:

```go
// http://github.com/zcong1993/components-contrib/blob/ff9f357a77f74a9ebaa0032da71c1f571143a1ca/secretstores/kubernetes/kubernetes.go
type kubernetesSecretStore struct {
  kubeClient kubernetes.Interface
  logger     logger.Logger
}

// 初始化 k8s provider
func NewKubernetesSecretStore(logger logger.Logger) secretstores.SecretStore {
  return &kubernetesSecretStore{logger: logger}
}

// impl Init
func (k *kubernetesSecretStore) Init(metadata secretstores.Metadata) error {
  client, err := kubeclient.GetKubeClient()
  if err != nil {
    return err
  }
  k.kubeClient = client

  return nil
}

// impl GetSecret
func (k *kubernetesSecretStore) GetSecret(req secretstores.GetSecretRequest) (secretstores.GetSecretResponse, error) {
  resp := secretstores.GetSecretResponse{
    Data: map[string]string{},
  }
  namespace, err := k.getNamespaceFromMetadata(req.Metadata)
  if err != nil {
    return resp, err
  }

  secret, err := k.kubeClient.CoreV1().Secrets(namespace).Get(context.TODO(), req.Name, meta_v1.GetOptions{})
  if err != nil {
    return resp, err
  }

  for k, v := range secret.Data {
    resp.Data[k] = string(v)
  }

  return resp, nil
}

// impl BulkGetSecret
func (k *kubernetesSecretStore) BulkGetSecret(req secretstores.BulkGetSecretRequest) (secretstores.BulkGetSecretResponse, error) {
  // ...
}
```

可以看到, 此模块就是简单包装了 k8s `secrets` API, Init 初始化 k8s client, GetSecret 和 BulkGetSecret 则是做了简单的校验和结果转换.

### Provider 管理

component provider 以 runtime option 的形式注册到 runtime 实例上:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/cmd/daprd/main.go#L155
err = rt.Run(
    runtime.WithSecretStores(
      secretstores_loader.New("kubernetes", func() secretstores.SecretStore {
        return sercetstores_kubernetes.NewKubernetesSecretStore(logContrib)
      }),
      secretstores_loader.New("azure.keyvault", func() secretstores.SecretStore {
        return keyvault.NewAzureKeyvaultSecretStore(logContrib)
      }),
      secretstores_loader.New("hashicorp.vault", func() secretstores.SecretStore {
        return vault.NewHashiCorpVaultSecretStore(logContrib)
      }),
      secretstores_loader.New("aws.secretmanager", func() secretstores.SecretStore {
        return secretmanager.NewSecretManager(logContrib)
      }),
      secretstores_loader.New("aws.parameterstore", func() secretstores.SecretStore {
        return parameterstore.NewParameterStore(logContrib)
      }),
      secretstores_loader.New("gcp.secretmanager", func() secretstores.SecretStore {
        return gcp_secretmanager.NewSecreteManager(logContrib)
      }),
      secretstores_loader.New("local.file", func() secretstores.SecretStore {
        return secretstore_file.NewLocalSecretStore(logContrib)
      }),
      secretstores_loader.New("local.env", func() secretstores.SecretStore {
        return secretstore_env.NewEnvSecretStore(logContrib)
      }),
    ),
    // ...
}
```

之后在 `runtime.initRuntime` 方法中交给 `runtime.secretStoresRegistry` 管理.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/components/secretstores/registry.go#L18
type (
  // Registry is used to get registered secret store implementations.
  Registry interface {
    Register(components ...SecretStore)
    Create(name, version string) (secretstores.SecretStore, error)
  }

  secretStoreRegistry struct {
    secretStores map[string]func() secretstores.SecretStore
  }
)
```

`secretStoreRegistry` 是一个 `map[string]factorFunc` 类型, 通过 `Register` 方法将所有 providers 注册到这个 map 中, `Create` 则可以通过 name 作为 key 和 version 找到并调用对应的 `factorFunc` 返回对应 provider 实例 , version 是为了扩展, 方便后续做多版本支持(目前大都为 v0, v1 版本号可以作为缺省值).

### 初始化模块

之前[配置模块文章](https://www.notion.so/Configuration-41ec54c26786462a9407198b9f76e075), 可以知道 dapr 根据运行平台以不同的方式 load components 配置, 然后将所有`components` 配置交给 `runtime.processComponents` 处理.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1639
func (a *DaprRuntime) processComponents() {
  for comp := range a.pendingComponents {
    if comp.Name == "" {
      continue
    }

    err := a.processComponentAndDependents(comp)
    if err != nil {
      e := fmt.Sprintf("process component %s error: %s", comp.Name, err.Error())
      if !comp.Spec.IgnoreErrors {
        log.Warnf("process component error daprd process will exited, gracefully to stop")
        a.shutdownRuntime(defaultGracefulShutdownDuration)
        log.Fatalf(e)
      }
      log.Errorf(e)
    }
  }
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1577
func (a *DaprRuntime) loadComponents(opts *runtimeOpts) error {
  // ...
  for _, comp := range authorizedComps {
    a.pendingComponents <- comp
  }
}
```

`processComponents` 只是简单将 component 分配给 `processComponentAndDependents` 处理, 它做了以下工作:

1. 通过 `preprocessOneComponent` 检查模块是否依赖其他模块, 如果依赖, 将模块放入 `pendingComponentDependents` 中等待依赖初始化后处理
2. 通过 `extractComponentCategory` 拿到模块分类, 例如: 秘钥管理就是 `secretstores`
3. 开启一个 goroutine 调用 `doProcessOneComponent` 函数初始化当前模块, 并进行超时控制
4. `doProcessOneComponent` 只是简单通过不同分类调用不同的初始化方法, 初始化方法通过配置中的 type 和 version 通过对应 `Registry.Create` 拿到 provider, 然后调用它的 `Init` 方法, 最后将初始化完毕的实例保存到 `runtime` 对应模块 `map` 中
5. 检查是否有模块依赖当前模块, 如果有, 初始化这些模块

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1666
func (a *DaprRuntime) processComponentAndDependents(comp components_v1alpha1.Component) error {
  log.Debugf("loading component. name: %s, type: %s/%s", comp.ObjectMeta.Name, comp.Spec.Type, comp.Spec.Version)
  // 步骤 1
  res := a.preprocessOneComponent(&comp)
  if res.unreadyDependency != "" {
    a.pendingComponentDependents[res.unreadyDependency] = append(a.pendingComponentDependents[res.unreadyDependency], comp)
    return nil
  }
  // 步骤 2
  compCategory := a.extractComponentCategory(comp)
  if compCategory == "" {
    // the category entered is incorrect, return error
    return errors.Errorf("incorrect type %s", comp.Spec.Type)
  }

  ch := make(chan error, 1)

  timeout, err := time.ParseDuration(comp.Spec.InitTimeout)
  if err != nil {
    timeout = defaultComponentInitTimeout
  }

  // 步骤 3
  go func() {
    ch <- a.doProcessOneComponent(compCategory, comp)
  }()

  select {
  case err := <-ch:
    if err != nil {
      return err
    }
  case <-time.After(timeout):
    return fmt.Errorf("init timeout for component %s exceeded after %s", comp.Name, timeout.String())
  }

  log.Infof("component loaded. name: %s, type: %s/%s", comp.ObjectMeta.Name, comp.Spec.Type, comp.Spec.Version)
  a.appendOrReplaceComponents(comp)
  diag.DefaultMonitoring.ComponentLoaded()

  // 步骤 5
  dependency := componentDependency(compCategory, comp.Name)
  if deps, ok := a.pendingComponentDependents[dependency]; ok {
    delete(a.pendingComponentDependents, dependency)
    for _, dependent := range deps {
      if err := a.processComponentAndDependents(dependent); err != nil {
        return err
      }
    }
  }

  return nil
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1717
// 步骤 4.1
func (a *DaprRuntime) doProcessOneComponent(category ComponentCategory, comp components_v1alpha1.Component) error {
  switch category {
  case bindingsComponent:
    return a.initBinding(comp)
  case pubsubComponent:
    return a.initPubSub(comp)
  case secretStoreComponent:
    return a.initSecretStore(comp)
  case stateComponent:
    return a.initState(comp)
  }
  return nil
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L2011
// 步骤 4.2
func (a *DaprRuntime) initSecretStore(c components_v1alpha1.Component) error {
  secretStore, err := a.secretStoresRegistry.Create(c.Spec.Type, c.Spec.Version)
  if err != nil {
    log.Warnf("failed creating secret store %s/%s: %s", c.Spec.Type, c.Spec.Version, err)
    diag.DefaultMonitoring.ComponentInitFailed(c.Spec.Type, "creation")
    return err
  }

  err = secretStore.Init(secretstores.Metadata{
    Properties: a.convertMetadataItemsToProperties(c.Spec.Metadata),
  })
  if err != nil {
    log.Warnf("failed to init state store %s/%s named %s: %s", c.Spec.Type, c.Spec.Version, c.ObjectMeta.Name, err)
    diag.DefaultMonitoring.ComponentInitFailed(c.Spec.Type, "init")
    return err
  }
  // 将当前实例储存在 runtime map 中
  a.secretStores[c.ObjectMeta.Name] = secretStore
  diag.DefaultMonitoring.ComponentInitialized(c.Spec.Type)
  return nil
}
```

以下面配置为例:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: mycustomsecretstore
  namespace: default
spec:
  type: secretstores.kubernetes
  version: v1
  metadata:
    - name: ''
```

最终会被初始化并存储在 runtime 中:

```go
runtime.secretStores = map[string]secretstores.SecretStore{
  "mycustomsecretstore": &kubernetesSecretStore{...},
}
```

同理别的部分模块也会被按照分类以 map 的形式存在 runtime 中:

```go
type DaprRuntime struct {
  // ...
  stateStores            map[string]state.Store
  inputBindings          map[string]bindings.InputBinding
  outputBindings         map[string]bindings.OutputBinding
  secretStores           map[string]secretstores.SecretStore
  pubSubs                map[string]pubsub.PubSub
  // ...
}
```

### 为什么会出现模块依赖?

组件配置中经常会需要配置一些敏感信息, 例如数据库密码之类. 使用纯文本是非常不安全的, 所以 dapr 允许在组件配置中引用 `secret store` 组件中的秘钥配置, 类似于 k8s 中环境变量引用 secrets.

例如, 可以这么声名一个基于 redis 实现的 state store:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: statestore
  namespace: default
spec:
  type: state.redis
  version: v1
  metadata:
    - name: redisHost
      value: localhost:6379
    - name: redisPassword
      secretKeyRef:
        name: redis-secret
        key: redis-password
auth:
  secretStore: mycustomsecretstore
```

`redisPassword` 就是引用的 `mycustomsecretstore` 这个 secret store 中的 key 为 `redis-password` 的秘钥. 因此这个组件也就依赖了 `mycustomsecretstore` 这个 secret store 组件.

如果运行环境为 k8s, 则 `auth.secretStore` 可以省略, 并且会直接从包装的 `kubernetesSecretStore` 直接获取, 不算做依赖.

查看源码:

`preprocessOneComponent` 调用 `processComponentSecrets` 来检查是否有依赖组件, 也说明了目前 dapr 只有这一种依赖类型.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1831-L1831
func (a *DaprRuntime) processComponentSecrets(component components_v1alpha1.Component) (components_v1alpha1.Component, string) {
  cache := map[string]secretstores.GetSecretResponse{}

  for i, m := range component.Spec.Metadata {
    // metadata[i].SecretKeyRef 为空时代表没有引用
    if m.SecretKeyRef.Name == "" {
      continue
    }

    // 获取 auth.secretStore
    secretStoreName := a.authSecretStoreOrDefault(component)
    secretStore := a.getSecretStore(secretStoreName)
    // secretStore 还没 load 好, 返回当前组件和此 secret 作为依赖
    if secretStore == nil {
      log.Warnf("component %s references a secret store that isn't loaded: %s", component.Name, secretStoreName)
      return component, secretStoreName
    }

    // 下面是依赖 secret 组件已经 load 完成, 或者在 k8s 环境下

    // k8s 环境 dapr operator 会帮我们将 secrets 引用放入 Value 中
    if a.runtimeConfig.Mode == modes.KubernetesMode && secretStoreName == kubernetesSecretStore {
      val := m.Value.Raw

      var jsonVal string
      err := json.Unmarshal(val, &jsonVal)
      if err != nil {
        log.Errorf("error decoding secret: %s", err)
        continue
      }

      dec, err := base64.StdEncoding.DecodeString(jsonVal)
      if err != nil {
        log.Errorf("error decoding secret: %s", err)
        continue
      }

      m.Value = components_v1alpha1.DynamicValue{
        JSON: v1.JSON{
          Raw: dec,
        },
      }

      component.Spec.Metadata[i] = m
      continue
    }

    // 缓存
    resp, ok := cache[m.SecretKeyRef.Name]
    if !ok {
      // 从 secretStore 获取 secrets
      r, err := secretStore.GetSecret(secretstores.GetSecretRequest{
        Name: m.SecretKeyRef.Name,
        Metadata: map[string]string{
          "namespace": component.ObjectMeta.Namespace,
        },
      })
      if err != nil {
        log.Errorf("error getting secret: %s", err)
        continue
      }
      resp = r
    }

    // 优先使用 SecretKeyRef.Key 其次是 SecretKeyRef.Name 获取引用
    secretKeyName := m.SecretKeyRef.Key
    if secretKeyName == "" {
      secretKeyName = m.SecretKeyRef.Name
    }

    // 将获取到的 secret 放入 Value 中
    val, ok := resp.Data[secretKeyName]
    if ok {
      component.Spec.Metadata[i].Value = components_v1alpha1.DynamicValue{
        JSON: v1.JSON{
          Raw: []byte(val),
        },
      }
    }

    cache[m.SecretKeyRef.Name] = resp
  }
  return component, ""
}
```

总结一下:

1. 检查组件 `metadata[i].SecretKeyRef` 是否有引用定义, 没有则代表当前组件没有依赖
2. 有引用 secret store 且该组件没有初始化完成时, 会将引用 secret store作为当前组件的依赖, 此关系会被存入 `runtime.pendingComponentDependents` 中, 当前组件会在引用 secret store 初始化完成之后再被初始化
3. 有引用且 secret store 已初始化完成, k8s 模式下 operator 已经将引用 secret 放入 value 中了, 只需要简单 base64 decode 下; 其他模式下调用 `secretStore.GetSecret` 获取秘钥并放在 value 中

## 参考资料

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://github.com/dapr/components-contrib](https://github.com/dapr/components-contrib)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
