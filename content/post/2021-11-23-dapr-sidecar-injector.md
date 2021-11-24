---
title: Dapr 源码解析 | Sidecar Injector
date: 2021-11-23T18:58:34+08:00
cover: /sidecar-injector.png
description: 本文介绍 Dapr Sidecar Injector 相关源码.
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

dapr sidecar injector 是 dapr 几个独立软件之一, 功能是在 k8s 环境为用户服务注入 dapr runtime sidecar 容器.

<!--more-->

## 总览

想要看懂 injector 工作原理, 我们需要从部署入手, 因为它是和 k8s 很多功能一起完成的.

首先通过 helm 生成一份部署配置文件:

```bash
helm repo add dapr https://dapr.github.io/helm-charts/
helm repo update
helm template dapr dapr/dapr > dapr.yaml
```

dapr.yaml 就是生成出来的部署配置文件.

搜寻 dapr-sidecar-injector 相关的配置, 可以看到除了常规的 Deployment 和 Service 配置还有个配置:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: dapr-sidecar-injector
  labels:
    app: dapr-sidecar-injector
webhooks:
  - name: sidecar-injector.dapr.io
    clientConfig:
      service:
        namespace: default
        name: dapr-sidecar-injector
        path: '/mutate'
      caBundle: 'xxxx'
    rules:
      - apiGroups:
          - ''
        apiVersions:
          - v1
        resources:
          - pods
        operations:
          - CREATE
    failurePolicy: Ignore
    sideEffects: None
    admissionReviewVersions: ['v1', 'v1beta1']
```

可以看到配置类型是 `MutatingWebhookConfiguration` , 它是做什么的呢?

根据上面配置 webhooks 和 rules 配置, 大概能够猜出来: 在 k8s pod 资源创建时, 给 `dapr-sidecar-injector` service 的路由 `/mutate` 发送一个 webhook 请求.

查看官方文档 [https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) 可以看到, 确实和猜想的没有太大出入. `Mutating admission webhooks` 可以定义一个 webhook, 会在对应的时机率先被调用, 并且允许我们对该资源进行修改, 并在修改完成后继续执行相应步骤.

综上所述, 需要 sidecar injector 做的事情就是提供一个 http webhook handler, 收到 pod 创建请求时, 根据 pod 信息为其注入 dapr sidecar 容器(响应相应的 patchOps 修改操作).

## 源码

injector 入口文件为 `cmd/injector/main.go` .

```go
func main() {
  // ...
  uids, err := injector.AllowedControllersServiceAccountUID(ctx, kubeClient)
  if err != nil {
    log.Fatalf("failed to get authentication uids from services accounts: %s", err)
  }

  injector.NewInjector(uids, cfg, daprClient, kubeClient).Run(ctx)

  shutdownDuration := 5 * time.Second
  log.Infof("allowing %s for graceful shutdown to complete", shutdownDuration)
  <-time.After(shutdownDuration)
}
```

去掉健康检查服务, 剩下的代码就只是单纯调用 `injector.NewInjector` 实例化 injector 然后运行.

`NewInjector` 函数创建了一个 http server 并且添加了 webhook 路由 `mux.HandleFunc("/mutate", i.handleRequest)` .

`handleRequest` 会真正处理 webhook 逻辑.

```go
func (i *injector) handleRequest(w http.ResponseWriter, r *http.Request) {
  // 检验请求参数
  // ...
  // 反序列化拿到请求参数
  ar := v1.AdmissionReview{}
  _, gvk, err := i.deserializer.Decode(body, nil, &ar)
  if err != nil {
    log.Errorf("Can't decode body: %v", err)
  } else {
    // 检查账号权限
    if !(utils.StringSliceContains(ar.Request.UserInfo.UID, i.authUIDs) || utils.StringSliceContains(systemGroup, ar.Request.UserInfo.Groups)) {
      log.Errorf("service account '%s' not on the list of allowed controller accounts", ar.Request.UserInfo.Username)
    } else if ar.Request.Kind.Kind != "Pod" { // 排除其他非 pod 资源的请求
      log.Errorf("invalid kind for review: %s", ar.Kind)
    } else {
      // 构造出 pod 资源需要的修改操作
      patchOps, err = i.getPodPatchOperations(&ar, i.config.Namespace, i.config.SidecarImage, i.config.SidecarImagePullPolicy, i.kubeClient, i.daprClient)
      if err == nil {
        patchedSuccessfully = true
      }
    }
  }
  // 根据上述结果构造出 webhook 响应
  // ...
}
```

除了请求校验和响应构建, 核心就是调用 `getPodPatchOperations` 函数构造出修改操作 `patchOps` 后续会作为响应 `response.patch` 返回, `response.patch` 为 `[]byte` 类型, JSON 序列化之后会变成 `base64` 格式字符串.

```json
{
  "apiVersion": "admission.k8s.io/v1",
  "kind": "AdmissionReview",
  "response": {
    "uid": "<value from request.uid>",
    "allowed": true,
    "patchType": "JSONPatch",
    "patch": "W3sib3AiOiAiYWRkIiwgInBhdGgiOiAiL3NwZWMvcmVwbGljYXMiLCAidmFsdWUiOiAzfV0="
  }
}
```

`getPodPatchOperations` 函数主要逻辑如下:

1. 如果 pod `dapr.io/enabled` 注解不为 true 或者是否已有 dapr sidecar, 直接 return
2. 根据 pod 注解构建出 sidecar 容器配置
3. 为用户 app 注入 `DAPR_HTTP_PORT` 和 `DAPR_GRPC_PORT` 两个环境变量

```go
func (i *injector) getPodPatchOperations(ar *v1.AdmissionReview,
  namespace, image, imagePullPolicy string, kubeClient *kubernetes.Clientset, daprClient scheme.Interface) ([]PatchOperation, error) {
  // ...
  // 过滤不需要注入的 pod 请求
  if !isResourceDaprEnabled(pod.Annotations) || podContainsSidecarContainer(&pod) {
    return nil, nil
  }
  // ...
  // 通过 dapr 全局配置 crd 读取是否启用 mTLS
  mtlsEnabled := mTLSEnabled(daprClient)
  // 根据 k8s secrets API 读取信任链 cert
  trustAnchors, certChain, certKey = getTrustAnchorsAndCertChain(kubeClient, namespace)
  identity = fmt.Sprintf("%s:%s", req.Namespace, pod.Spec.ServiceAccountName)
  // 构建出 sidecar 容器配置
  sidecarContainer, err := getSidecarContainer(pod.Annotations, id, image, imagePullPolicy, req.Namespace, apiSvcAddress, placementAddress, tokenMount, trustAnchors, certChain, certKey, sentryAddress, mtlsEnabled, identity)
  // ...
  // 如果没有用户容器, 直接创建 dapr sidecar
  if len(pod.Spec.Containers) == 0 {
    path = containersPath
    value = []corev1.Container{*sidecarContainer}
  } else {
    // 有用户容器, 为用户容器注入环境变量
    envPatchOps = addDaprEnvVarsToContainers(pod.Spec.Containers)
    // 容器列表添加 dapr sidecar
    path = "/spec/containers/-"
    value = sidecarContainer
  }

  patchOps = append(
    patchOps,
    PatchOperation{
      Op:    "add",
      Path:  path,
      Value: value,
    },
  )
  // 合并所有 patch 操作, 并返回
  patchOps = append(patchOps, envPatchOps...)

  return patchOps, nil
}
```

`getSidecarContainer` 函数会根据上面条件创建出 dapr sidecar, 支持通过很多 `dapr.io/` 开头的注解来控制 sidecar 容器参数:

```go
func getSidecarContainer(annotations map[string]string, id, daprSidecarImage, imagePullPolicy, namespace, controlPlaneAddress, placementServiceAddress string, tokenVolumeMount *corev1.VolumeMount, trustAnchors, certChain, certKey, sentryAddress string, mtlsEnabled bool, identity string) (*corev1.Container, error) {
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
  c := &corev1.Container{
    Name:            sidecarContainerName,
    Image:           daprSidecarImage,
    ImagePullPolicy: pullPolicy,
    SecurityContext: &corev1.SecurityContext{
      AllowPrivilegeEscalation: &allowPrivilegeEscalation,
    },
    Ports:   ports,
    Command: cmd,
    Env: []corev1.EnvVar{
      {
        Name:  "NAMESPACE",
        Value: namespace,
      },
    },
    Args: args,
    ReadinessProbe: &corev1.Probe{
      Handler:             httpHandler,
      InitialDelaySeconds: getInt32AnnotationOrDefault(annotations, daprReadinessProbeDelayKey, defaultHealthzProbeDelaySeconds),
      TimeoutSeconds:      getInt32AnnotationOrDefault(annotations, daprReadinessProbeTimeoutKey, defaultHealthzProbeTimeoutSeconds),
      PeriodSeconds:       getInt32AnnotationOrDefault(annotations, daprReadinessProbePeriodKey, defaultHealthzProbePeriodSeconds),
      FailureThreshold:    getInt32AnnotationOrDefault(annotations, daprReadinessProbeThresholdKey, defaultHealthzProbeThreshold),
    },
    LivenessProbe: &corev1.Probe{
      Handler:             httpHandler,
      InitialDelaySeconds: getInt32AnnotationOrDefault(annotations, daprLivenessProbeDelayKey, defaultHealthzProbeDelaySeconds),
      TimeoutSeconds:      getInt32AnnotationOrDefault(annotations, daprLivenessProbeTimeoutKey, defaultHealthzProbeTimeoutSeconds),
      PeriodSeconds:       getInt32AnnotationOrDefault(annotations, daprLivenessProbePeriodKey, defaultHealthzProbePeriodSeconds),
      FailureThreshold:    getInt32AnnotationOrDefault(annotations, daprLivenessProbeThresholdKey, defaultHealthzProbeThreshold),
    },
  }
  // ...
}
```

## 总结

在阅读 dapr 源码前, 我是不知道 k8s 支持 `MutatingWebhookConfiguration` 功能的, 没想打这个狗能可以这么简单实现出来. 全局化配置和注解差异化配置也使得 dapr sidecar 容器的很多配置是可控的.

不过 injector 做完工作 sidecar 并不是可用状态, 因为仅仅有 sidecar 容器并不能互相做 grpc 调用, 所以剩下一部分工作还需要 operator 完成, 后续文章再说明.

## **参考资料**

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
