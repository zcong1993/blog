---
title: Dapr 源码解析 | 配置模块
date: 2021-11-01T14:10:29+08:00
cover: /dapr-configuration.png
description: Dapr 配置模块. 不同运行环境, 不同可插拔组件如何组织配置.
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

本文源码选用 dapr 1.4.3 [https://github.com/zcong1993/dapr-1/tree/learn-1.4.3](https://github.com/zcong1993/dapr-1/tree/learn-1.4.3)

<!--more-->

## 总览

dapr 配置主要分为三部分: 全局配置, 组件配置和运行时配置.

全局配置和组件配置是以 yaml 形式定义的, 而且直接使用 k8s crd 类型, 例如:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Configuration
metadata:
  name: daprConfig
  namespace: default
spec:
  tracing:
    samplingRate: '1'
    zipkin:
      endpointAddress: 'http://localhost:9411/api/v2/spans'
```

熟悉 k8s 的人应该可以看出来这就是 CRD 的类型. 全局配置的 kind 类型为 `Configuration` , 组件配置 kind 类型为 `Component`.

### 使用 crd 的优势

dapr 支持本地运行和 k8s 环境运行, 使用 crd 定义配置时, 在 k8s 环境用户可以用非常熟悉的 `kubectl` 来更改配置. 在本地环境时, 由于 yaml 本身就是结构化的, 所以直接读取文件也能拿到定义的类型.

## 全局配置

全局配置类型定义在 [pkg/config/configuration.go](http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/config/configuration.go) 中:

```go
type Configuration struct {
  metav1.TypeMeta `json:",inline" yaml:",inline"`
  // See https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#metadata
  metav1.ObjectMeta `json:"metadata,omitempty" yaml:"metadata,omitempty"`
  // See https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#spec-and-status
  Spec ConfigurationSpec `json:"spec" yaml:"spec"`
}

type ConfigurationSpec struct {
  HTTPPipelineSpec   PipelineSpec       `json:"httpPipeline,omitempty" yaml:"httpPipeline,omitempty"`
  TracingSpec        TracingSpec        `json:"tracing,omitempty" yaml:"tracing,omitempty"`
  MTLSSpec           MTLSSpec           `json:"mtls,omitempty"`
  MetricSpec         MetricSpec         `json:"metric,omitempty" yaml:"metric,omitempty"`
  Secrets            SecretsSpec        `json:"secrets,omitempty" yaml:"secrets,omitempty"`
  AccessControlSpec  AccessControlSpec  `json:"accessControl,omitempty" yaml:"accessControl,omitempty"`
  NameResolutionSpec NameResolutionSpec `json:"nameResolution,omitempty" yaml:"nameResolution,omitempty"`
  Features           []FeatureSpec      `json:"features,omitempty" yaml:"features,omitempty"`
  APISpec            APISpec            `json:"api,omitempty" yaml:"api,omitempty"`
}
```

根据上面类型代码, 可以看出主要控制下面几种功能:

1. HTTPPipelineSpec 控制启用 middleware
2. TracingSpec 配置追踪相关
3. MTLSSpec 配置 mTLS 相关
4. MetricSpec 配置是否开启指标监控
5. Secrets 控制 secrets store 访问范围
6. AccessControlSpec 控制服务到服务的 api 访问权限, 类似于 k8s role 权限控制
7. NameResolutionSpec 控制服务发现方式, 例如: 可以配置使用 consul 做服务发现
8. Features 控制启用那些 preview 功能, 例如: proxy.grpc
9. APISpec 可以控制 dapr 哪些 api 允许被调用

### load 配置

dapr 实现了两种配置 load 方式, k8s 模式下使用 `LoadKubernetesConfiguration` 方法, 本地模式使用 `LoadStandaloneConfiguration` 方法.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/cli.go#L212
switch modes.DaprMode(*mode) {
case modes.KubernetesMode:
  client, conn, clientErr := client.GetOperatorClient(*controlPlaneAddress, security.TLSServerName, runtimeConfig.CertChain)
  if clientErr != nil {
    return nil, clientErr
  }
  defer conn.Close()
  namespace = os.Getenv("NAMESPACE")
  globalConfig, configErr = global_config.LoadKubernetesConfiguration(*config, namespace, client)
case modes.StandaloneMode:
  globalConfig, _, configErr = global_config.LoadStandaloneConfiguration(*config)
}
```

这两个方法做了获取配置和校验工作, `LoadStandaloneConfiguration` 直接从本地文件中获取配置,

`LoadKubernetesConfiguration` 则是通过 `operator API` 拿到配置.

## 组件配置

component 配置主要控制可插拔组件 provider 及配置, 例如: 定义一个 Redis 类型的 `State Stores`. 它也是一个 crd:

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: [COMPONENT-NAME]
  namespace: [COMPONENT-NAMESPACE]
spec:
  type: [COMPONENT-TYPE]
  version: v1
  initTimeout: [TIMEOUT-DURATION]
  ignoreErrors: [BOOLEAN]
  metadata:
    - name: [METADATA-NAME]
      value: [METADATA-VALUE]
```

`metadata` 表示你要创建的 component 信息, `spec.type` 和 `spec.version` 表示 component 的类型以及 provider, 例如: 定义 `local file secret store` 时, `spec.type` 需要设置为 `secretstores.local.file`. `spec.metadata` 为 `key/value` 形式的当前 provider 所需配置.

### load 配置

与全局配置类似, 本地模式从本地配置文件中载入配置, k8s 通过 operator API 获取 crd 配置.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1578
var loader components.ComponentLoader
switch a.runtimeConfig.Mode {
case modes.KubernetesMode:
  loader = components.NewKubernetesComponents(a.runtimeConfig.Kubernetes, a.namespace, a.operatorClient)
case modes.StandaloneMode:
  loader = components.NewStandaloneComponents(a.runtimeConfig.Standalone)
default:
  return errors.Errorf("components loader for mode %s not found", a.runtimeConfig.Mode)
}
```

dapr 定义了两种 loader:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/components/components_loader.go#L11
// ComponentLoader is an interface for returning Dapr components.
type ComponentLoader interface {
  LoadComponents() ([]components_v1alpha1.Component, error)
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/components/standalone_loader.go#L28
// StandaloneComponents loads components in a standalone mode environment.
type StandaloneComponents struct {
  config config.StandaloneConfig
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/components/kubernetes_loader.go#L30
// KubernetesComponents loads components in a kubernetes environment.
type KubernetesComponents struct {
  config    config.KubernetesConfig
  client    operatorv1pb.OperatorClient
  namespace string
}
```

## 运行时配置

运行时配置主要控制单个 daprd sidecar 的运行配置, 例如: 用户 app 的 protocol 类型, app port, app-id 等等.

本地模式通过 flags 和环境变量来控制, k8s 模式则通过 `annotations` 控制.

### 本地模式

flags 定义在 [pkg/runtime/cli.go](http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/cli.go#L33) :

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/cli.go#L33
// FromFlags parses command flags and returns DaprRuntime instance.
func FromFlags() (*DaprRuntime, error) {
  // 从 flags 中获取
  mode := flag.String("mode", string(modes.StandaloneMode), "Runtime mode for Dapr")
  daprHTTPPort := flag.String("dapr-http-port", fmt.Sprintf("%v", DefaultDaprHTTPPort), "HTTP port for Dapr API to listen on")
  daprAPIListenAddresses := flag.String("dapr-listen-addresses", DefaultAPIListenAddress, "One or more addresses for the Dapr API to listen on, CSV limited")
  daprPublicPort := flag.String("dapr-public-port", "", "Public port for Dapr Health and Metadata to listen on")
  daprAPIGRPCPort := flag.String("dapr-grpc-port", fmt.Sprintf("%v", DefaultDaprAPIGRPCPort), "gRPC port for the Dapr API to listen on")
  daprInternalGRPCPort := flag.String("dapr-internal-grpc-port", "", "gRPC port for the Dapr Internal API to listen on")
  appPort := flag.String("app-port", "", "The port the application is listening on")
  // ...

  // 从环境变量中获取
  variables := map[string]string{
    env.AppID:           *appID,
    env.AppPort:         *appPort,
    env.HostAddress:     host,
    env.DaprPort:        strconv.Itoa(daprInternalGRPC),
    env.DaprGRPCPort:    *daprAPIGRPCPort,
    env.DaprHTTPPort:    *daprHTTPPort,
    env.DaprMetricsPort: metricsExporter.Options().Port, // TODO - consider adding to runtime config
    env.DaprProfilePort: *profilePort,
  }

  if err = setEnvVariables(variables); err != nil {
    return nil, err
  }
  // ...
}
```

### k8s 模式

k8s 模式虽然我们使用 `annotations` 控制运行时配置, 但是 daprd 只会有上面一种方式获取配置, 所以是 `injector` 做了转换.

k8s 模式下, daprd 会通过 sidecar 容器运行在用户 app pod 中, 而这个容器是 `injector` 控制创建的, 所以 injector 也会负责转换配置. 而且 `annotations` 还会额外支持很多 k8s 容器相关配置, 例如: `[dapr.io/sidecar-cpu-limit](http://dapr.io/sidecar-cpu-limit)` 和 `[dapr.io/sidecar-memory-limi](http://dapr.io/sidecar-memory-limi)` 来配置 sidecar 容器的资源限制.

相关代码如下:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/injector/pod_patch.go#L487
func getSidecarContainer(annotations map[string]string, id, daprSidecarImage, imagePullPolicy, namespace, controlPlaneAddress, placementServiceAddress string, tokenVolumeMount *corev1.VolumeMount, trustAnchors, certChain, certKey, sentryAddress string, mtlsEnabled bool, identity string) (*corev1.Container, error) {
  appPort, err := getAppPort(annotations)

  metricsEnabled := getEnableMetrics(annotations)
  metricsPort := getMetricsPort(annotations)
  maxConcurrency, err := getMaxConcurrency(annotations)
  sidecarListenAddresses := getListenAddresses(annotations)

  sslEnabled := appSSLEnabled(annotations)

  pullPolicy := getPullPolicy(imagePullPolicy)

  httpHandler := getProbeHTTPHandler(sidecarPublicPort, apiVersionV1, sidecarHealthzPath)

  allowPrivilegeEscalation := false

  requestBodySize, err := getMaxRequestBodySize(annotations)

  // ...

  cmd := []string{"/daprd"}

  args := []string{
    "--mode", "kubernetes",
    "--dapr-http-port", fmt.Sprintf("%v", sidecarHTTPPort),
    "--dapr-grpc-port", fmt.Sprintf("%v", sidecarAPIGRPCPort),
    "--dapr-internal-grpc-port", fmt.Sprintf("%v", sidecarInternalGRPCPort),
    "--dapr-listen-addresses", sidecarListenAddresses,
    "--dapr-public-port", fmt.Sprintf("%v", sidecarPublicPort),
    "--app-port", appPortStr,
    "--app-id", id,
    "--control-plane-address", controlPlaneAddress,
    "--app-protocol", getProtocol(annotations),
    "--placement-host-address", placementServiceAddress,
    "--config", getConfig(annotations),
    "--log-level", getLogLevel(annotations),
    "--app-max-concurrency", fmt.Sprintf("%v", maxConcurrency),
    "--sentry-address", sentryAddress,
    fmt.Sprintf("--enable-metrics=%t", metricsEnabled),
    "--metrics-port", fmt.Sprintf("%v", metricsPort),
    "--dapr-http-max-request-size", fmt.Sprintf("%v", requestBodySize),
  }

  // ...
}
```

## 参考资料

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
