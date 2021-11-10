---
title: Dapr 源码解析 | 服务间调用
date: 2021-11-10T18:10:38+08:00
cover: /dapr-service-invocation.png
description: 本文介绍 Dapr 服务间调用模块相关源码.
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

Service Invocation 是 dapr 对外提供的最基础功能, 也就是服务间调用. 另外别的一些功能也会间接使用它.

<!--more-->

本文不会介绍功能如何使用, 相关资料请查看官方文档.

[https://docs.dapr.io/developing-applications/building-blocks/service-invocation/howto-invoke-discover-services/](https://docs.dapr.io/developing-applications/building-blocks/service-invocation/howto-invoke-discover-services/)

[https://docs.dapr.io/developing-applications/building-blocks/service-invocation/howto-invoke-services-grpc/](https://docs.dapr.io/developing-applications/building-blocks/service-invocation/howto-invoke-services-grpc/)

## 总览

![dapr-si-overview](/dapr-si-overview.png)

官方文档给出来 Service Invocation 服务间调用的示意图, 已经是非常清晰了. 因为 dapr 是 sidecar 模式运行在业务 APP 旁边, 所以我们服务间调用也是通过 dapr 做的转发, dapr 也就是在这一步做了监控, 追踪, mTLS 等功能.

1. service A 想通过 HTTP/gRPC 调用 service B, 会先请求自己本地 dapr A(sidecar)应用
2. dapr A 通过 `name resolution` 服务发现模块获取到 dapr B 服务的地址
3. dapr A 通过 `gRPC` 调用 dapr B (dapr之间的调用都会用 gRPC 提高性能)
4. dapr B 收到请求后转发请求给 service B
5. service B 返回响应给 dapr B
6. dapr B 将收到的响应返回给 dapr A
7. dapr A 将收到的相应返回给 service A

## HTTP API

### 1. 入口

dapr 对外提供的服务间调用 HTTP API 为:

`POST/GET/PUT/DELETE [http://localhost](http://localhost/):<daprPort>/v1.0/invoke/<appId>/method/<method-name>`

### 1.1 onDirectMessage (1, 7)

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/http/api.go#L260
func (a *api) constructDirectMessagingEndpoints() []Endpoint {
   return []Endpoint{
      {
        Methods: []string{router.MethodWild},
        Route:   "invoke/{id}/method/{method:*}",
        Alias:   "{method:*}",
        Version: apiVersionV1,
        Handler: a.onDirectMessage,
      },
   }
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/http/api.go#L865
func (a *api) onDirectMessage(reqCtx *fasthttp.RequestCtx) {
  // 从请求中解析到目标 app-id
  targetID := a.findTargetID(reqCtx)

  // 拿到请求 method, 后续构建转发请求
  verb := strings.ToUpper(string(reqCtx.Method()))
  invokeMethodName := reqCtx.UserValue(methodParam).(string)

  // 构建转发的请求, 转发一些 metadata
  req := invokev1.NewInvokeMethodRequest(invokeMethodName).WithHTTPExtension(verb, reqCtx.QueryArgs().String())
  // ...

  // 通过 directMessaging 转发请求
  resp, err := a.directMessaging.Invoke(reqCtx, targetID, req)
  // err does not represent user application response
  if err != nil {
    // 响应错误
    return
  }

  // 响应请求, 如果是 grpc 响应则转化一下
  statusCode := int(resp.Status().Code)
  respond(reqCtx, with(statusCode, body))
}
```

onDirectMessage 为 API handler, 简单来说主要做了以下几点事情:

1. 解析请求获取目标 app-id, 和一些简单校验工作
2. 通过用户请求构建出内部请求(内部请求为 protobuf 格式, body 为 pb.Any 格式)
3. 调用 `directMessaging.Invoke` 转发请求
4. 根据响应构建响应返回给用户

### 1.2 directMessaging

dapr 也是很标准的大写开头定义 interface 接口, 小写字母开头定义实现.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/messaging/direct_messaging.go#L42
type DirectMessaging interface {
  Invoke(ctx context.Context, targetAppID string, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error)
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/messaging/direct_messaging.go#L102
func (d *directMessaging) Invoke(ctx context.Context, targetAppID string, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  // 通过 name resolution 获取目标 app 信息
  app, err := d.getRemoteApp(targetAppID)
  if err != nil {
    return nil, err
  }
  // 发现目标为自己时, invokeLocal 调用自己 sidecar 本地的用户 app
  if app.id == d.appID && app.namespace == d.namespace {
    return d.invokeLocal(ctx, req)
  }
  // 目标不是自己, 调用目标 dapr sidecar
  return d.invokeWithRetry(ctx, retry.DefaultLinearRetryCount, retry.DefaultLinearBackoffInterval, app, d.invokeRemote, req)
}
```



directMessaging 做了下面几件事情:

1. 通过 name resolution 获取目标 app 的 address
2. 如果发现调用是自己, 则通过 `invokeLocal` 调用自己 sidecar 本地的用户 app
3. 发现不是自己时, 通过 `invokeWithRetry` 调用目标 dapr sidecar

### 2.  name resolution (2)

name resolution 部分会在后续讲解, 现在只需要知道它和我们服务发现差不多, `ResolveID(req ResolveRequest) (string, error)` 通过 interface 定义可以看出, 就是通过 appId 和 namespace 获取 address.

### 3. invokeWithRetry (3, 6)

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/messaging/direct_messaging.go#L129
func (d *directMessaging) invokeWithRetry(
  ctx context.Context,
  numRetries int,
  backoffInterval time.Duration,
  app remoteApp,
  fn func(ctx context.Context, appID, namespace, appAddress string, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error),
  req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  for i := 0; i < numRetries; i++ {
    // 简单封装了带有 backoff 的 retry
    // fn 为 d.invokeRemote
    resp, err := fn(ctx, app.id, app.namespace, app.address, req)
    if err == nil {
      return resp, nil
    }
    time.Sleep(backoffInterval)

    code := status.Code(err)
    if code == codes.Unavailable || code == codes.Unauthenticated {
      // 重新建立连接, recreateIfExists = true
      _, connerr := d.connectionCreatorFn(context.TODO(), app.address, app.id, app.namespace, false, true, false)
      if connerr != nil {
        return nil, connerr
      }
      continue
    }
    return resp, err
  }
  return nil, errors.Errorf("failed to invoke target %s after %v retries", app.id, numRetries)
}
```

invokeWithRetry 做了两件事情:

1. 简单封装了带有 backoff 的 retry, 真正执行逻辑的函数为传进来的 `d.invokeRemote`
2. 在出现 Unavailable 和 Unauthenticated 错误时, 尝试重新建立连接

### 3.1 connectionCreatorFn

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/grpc.go#L77
func (g *Manager) GetGRPCConnection(ctx context.Context, address, id string, namespace string, skipTLS, recreateIfExists, sslEnabled bool, customOpts ...grpc.DialOption) (*grpc.ClientConn, error) {
  g.lock.RLock()
  if val, ok := g.connectionPool[address]; ok && !recreateIfExists {
    g.lock.RUnlock()
    return val, nil
  }
  g.lock.RUnlock()

  g.lock.Lock()
  defer g.lock.Unlock()
  // read the value once again, as a concurrent writer could create it
  if val, ok := g.connectionPool[address]; ok && !recreateIfExists {
    return val, nil
  }

  opts := []grpc.DialOption{
    grpc.WithDefaultServiceConfig(grpcServiceConfig),
  }
  // ...
  opts = append(opts, customOpts...)
  conn, err := grpc.DialContext(ctx, dialPrefix+address, opts...)
  if err != nil {
    return nil, err
  }

  if c, ok := g.connectionPool[address]; ok {
    c.Close()
  }

  g.connectionPool[address] = conn

  return conn, nil
}
```

GetGRPCConnection 简单管理共享复用 grpc client 连接, `map[string]*grpc.ClientConn` . 当参数 recreateIfExists 为 true 时会关闭旧连接创建新连接. 后续 `d.invokeRemote` 也是通过此函数拿连接.

### 3.2 invokeRemote

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/messaging/direct_messaging.go#L173
func (d *directMessaging) invokeRemote(ctx context.Context, appID, namespace, appAddress string, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  // 获取复用连接
  conn, err := d.connectionCreatorFn(context.TODO(), appAddress, appID, namespace, false, false, false)
  if err != nil {
    return nil, err
  }

  ctx = d.setContextSpan(ctx)

  d.addForwardedHeadersToMetadata(req)
  d.addDestinationAppIDHeaderToMetadata(appID, req)

  clientV1 := internalv1pb.NewServiceInvocationClient(conn)

  var opts []grpc.CallOption
  opts = append(opts, grpc.MaxCallRecvMsgSize(d.maxRequestBodySize*1024*1024), grpc.MaxCallSendMsgSize(d.maxRequestBodySize*1024*1024))

  // grpc 调用
  resp, err := clientV1.CallLocal(ctx, req.Proto(), opts...)
  if err != nil {
    return nil, err
  }

  return invokev1.InternalInvokeResponse(resp)
}
```

invokeRemote 通过 grpc  `CallLocal` 方法调用另一个 dapr sidecar 的 grpc server 方法. 这里的 `CallLocal` 不是本地调用的意思, 而是代表它是 dapr 的 internal 内部方法.

### 4.  grpcServer.CallLocal (4, 5)

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/api.go#L147
func (a *api) CallLocal(ctx context.Context, in *internalv1pb.InternalInvokeRequest) (*internalv1pb.InternalInvokeResponse, error) {
  // ...
  // 包装转化 request
  req, err := invokev1.InternalInvokeRequest(in)
  if err != nil {
    return nil, status.Errorf(codes.InvalidArgument, messages.ErrInternalInvokeRequest, err.Error())
  }

  // 路由权限管理
  if a.accessControlList != nil {
    // ...
    callAllowed, errMsg := acl.ApplyAccessControlPolicies(ctx, operation, httpVerb, a.appProtocol, a.accessControlList)
    if !callAllowed {
      return nil, status.Errorf(codes.PermissionDenied, errMsg)
    }
  }

  // 转发请求
  resp, err := a.appChannel.InvokeMethod(ctx, req)
  if err != nil {
    err = status.Errorf(codes.Internal, messages.ErrChannelInvoke, err)
    return nil, err
  }
  return resp.Proto(), err
}
```

发现 CallLocal 部分除了转换下请求和路由权限管理外, 将核心逻辑交给了 `appChannel.InvokeMethod` 来处理, 那么 `appChannel` 又是什么呢?

我们知道 dapr 作为 sidecar 时允许我们 app 通过 HTTP 和 gRPC 两种方式和它交互, 所以 `appChannel` 其实就是这个调用的抽象, 它有两个实现, 一种是 HTTP, 另一种是 gRPC.

dapr 会根据 `runtimeConfig.ApplicationProtocol` 中指定的类型(可以通过 dapr run`--app-protocol` 参数指定)选择初始化哪种作为 `appChannel`:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/channel/channel.go#L21
type AppChannel interface {
  GetBaseAddress() string
  GetAppConfig() (*config.ApplicationConfig, error)
  InvokeMethod(ctx context.Context, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error)
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1962
func (a *DaprRuntime) createAppChannel() error {
  if a.runtimeConfig.ApplicationPort > 0 {
    var channelCreatorFn func(port, maxConcurrency int, spec config.TracingSpec, sslEnabled bool, maxRequestBodySize int) (channel.AppChannel, error)
    // 根据用户 app 协议类型初始化不同 appChannel
    switch a.runtimeConfig.ApplicationProtocol {
    case GRPCProtocol:
      channelCreatorFn = a.grpc.CreateLocalChannel
    case HTTPProtocol:
      channelCreatorFn = http_channel.CreateLocalChannel
    default:
      return errors.Errorf("cannot create app channel for protocol %s", string(a.runtimeConfig.ApplicationProtocol))
    }

    ch, err := channelCreatorFn(a.runtimeConfig.ApplicationPort, a.runtimeConfig.MaxConcurrency, a.globalConfig.Spec.TracingSpec, a.runtimeConfig.AppSSL, a.runtimeConfig.MaxRequestBodySize)
    // ...
    // set appChannel
    a.appChannel = ch
  }

  return nil
}
```

### 4.1 http_channel.InvokeMethod

我们以 HTTP 协议为例, 继续分析 `http_channel.InvokeMethod`:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/channel/http/http_channel.go#L118
func (h *Channel) InvokeMethod(ctx context.Context, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  // 简单做了参数校验, 和 api 版本管理方便后续扩展
  // 目前只会调用 invokeMethodV1
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/channel/http/http_channel.go#L142
func (h *Channel) invokeMethodV1(ctx context.Context, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  // 转换请求, 将请求地址转化为 http://localhost:3000/method?query1=value1
  // 请求体 body protobuf 类型转化成 content-type 类型, 并且设置 header
  channelReq := h.constructRequest(ctx, req)

  // 限速
  if h.ch != nil {
    h.ch <- 1
  }

  // 指标监控相关
  verb := string(channelReq.Header.Method())
  diag.DefaultHTTPMonitoring.ClientRequestStarted(ctx, verb, req.Message().Method, int64(len(req.Message().Data.GetValue())))
  startRequest := time.Now()

  // 发送请求
  resp := fasthttp.AcquireResponse()
  err := h.client.Do(channelReq, resp)
  defer func() {
    fasthttp.ReleaseRequest(channelReq)
    fasthttp.ReleaseResponse(resp)
  }()

  elapsedMs := float64(time.Since(startRequest) / time.Millisecond)

  if err != nil {
    diag.DefaultHTTPMonitoring.ClientRequestCompleted(ctx, verb, req.Message().GetMethod(), strconv.Itoa(nethttp.StatusInternalServerError), int64(resp.Header.ContentLength()), elapsedMs)
    return nil, err
  }

  if h.ch != nil {
    <-h.ch
  }

  // 将用户 app 返回的 response 转化为 dapr 内部的 protobuf 类型
  rsp := h.parseChannelResponse(req, resp)
  diag.DefaultHTTPMonitoring.ClientRequestCompleted(ctx, verb, req.Message().GetMethod(), strconv.Itoa(int(rsp.Status().Code)), int64(resp.Header.ContentLength()), elapsedMs)

  return rsp, nil
}
```

invokeMethodV1 最终做的就是将内部的请求类型转化为用户服务类型, 例如 body 转为 json 类型, 拿到响应后再转为内部类型. `grpcServer.CallLocal` 部分就分析完了.

### 5. invokeLocal (1, 7)

invokeLocal 只会出现在使用 dapr API 自己调用自己时, 只是简单调用 `appChannel.InvokeMethod` . 正常情况下不会出现此情况.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/messaging/direct_messaging.go#L158
func (d *directMessaging) invokeLocal(ctx context.Context, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  if d.appChannel == nil {
    return nil, errors.New("cannot invoke local endpoint: app channel not initialized")
  }

  return d.appChannel.InvokeMethod(ctx, req)
}
```

## gRPC API

dapr 1.4 使用 `gRPC proxying` 这个新特性来处理用户 app 和 dapr sidecar 之间的 gRPC 调用.

简单来说就是现在使用 dapr 进行 gRPC 调用时, 使用方式和直接调用自己服务没有区别, 仅仅需要把 client 连接地址换成 dapr sidecar gRPC API 的地址, 并且调用时需要在 metadata  中增加 `dapr-app-id`.

### 为什么需要这个特性?

gRPC 很重要的一个特性是, 它可以帮助我们根据 proto 定义生成出函数类型定义, 请求和响应定义, 也就是说 gRPC 相当于编程中的静态语言. 但是 dapr 的 `InvokeService` 为了通用性, 只能将 request/response data 定义为 `any` 类型, 相当于变成了动态语言, 使用方式也变成了下面这种:

```go
content := &dapr.DataContent{
    ContentType: "application/json",
    Data:        []byte(`{ "id": "a123", "value": "demo", "valid": true }`),
}

resp, err = client.InvokeMethodWithContent(ctx, "app-id", "method-name", "post", content)
```

在使用上是难以接受的.

### 源码部分

[https://github.com/zcong1993/dapr-1/tree/learn-1.4.3/pkg/grpc/proxy](https://github.com/zcong1993/dapr-1/tree/learn-1.4.3/pkg/grpc/proxy)

grpc proxy 部分基于 [https://github.com/trusch/grpc-proxy](https://github.com/trusch/grpc-proxy) 项目修改而来. 主要在 grpc server 部分.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/server.go#L221
func (s *server) getGRPCServer() (*grpc_go.Server, error) {
  opts := s.getMiddlewareOptions()
  // ...
  opts = append(opts, grpc_go.MaxRecvMsgSize(s.config.MaxRequestBodySize*1024*1024), grpc_go.MaxSendMsgSize(s.config.MaxRequestBodySize*1024*1024))

  if s.proxy != nil {
    // 如果使用 proxy, 注册 proxy.Handler 到 grpc.UnknownServiceHandler
    opts = append(opts, grpc_go.UnknownServiceHandler(s.proxy.Handler()))
  }

  return grpc_go.NewServer(opts...), nil
}

// 处理当前 grpc server 不认识的请求
func (p *proxy) Handler() grpc.StreamHandler {
  return grpc_proxy.TransparentHandler(p.intercept)
}

// 主要是通过 metadata 中的 dapr-app-id 拿到请求的地址, 然后代理请求
func (p *proxy) intercept(ctx context.Context, fullName string) (context.Context, *grpc.ClientConn, error) {
  md, _ := metadata.FromIncomingContext(ctx)

  v := md.Get(diagnostics.GRPCProxyAppIDKey)
  if len(v) == 0 {
    return ctx, nil, errors.Errorf("failed to proxy request: required metadata %s not found", diagnostics.GRPCProxyAppIDKey)
  }

  outCtx := metadata.NewOutgoingContext(ctx, md.Copy())
  appID := v[0]

  if appID == p.appID {
    // proxy locally to the app
    if p.acl != nil {
      ok, authError := acl.ApplyAccessControlPolicies(ctx, fullName, common.HTTPExtension_NONE, config.GRPCProtocol, p.acl)
      if !ok {
        return ctx, nil, status.Errorf(codes.PermissionDenied, authError)
      }
    }

    conn, err := p.connectionFactory(outCtx, p.localAppAddress, p.appID, "", true, false, false, grpc.WithDefaultCallOptions(grpc.CallContentSubtype((&codec.Proxy{}).Name())))
    return ctx, conn, err
  }

  // proxy to a remote daprd
  remote, err := p.remoteAppFn(appID)
  if err != nil {
    return ctx, nil, err
  }

  conn, err := p.connectionFactory(outCtx, remote.address, remote.id, remote.namespace, false, false, false, grpc.WithDefaultCallOptions(grpc.CallContentSubtype((&codec.Proxy{}).Name())))
  outCtx = p.telemetryFn(outCtx)

  return outCtx, conn, err
}
```

主要为两个步骤:

1. `intercept` 拿到 metadata 中的 `dapr-app-id`, 根据 name resolution 拿到目标 gRPC 服务地址后, 从 connectionFactory 拿到共享连接
2. `grpc_proxy.TransparentHandler` 通过双向转发流数据, 进行代理

假如上面流程图里面 server A 和 service B 都是 gRPC 服务, 而且 A 调用 B 的 `Echo` 方法, 会经过一下流程:

1. 直接连接 dapr A gRPC server, 调用  `Echo` 方法, metadata `dapr-app-id` 需要设置为 service-b
2. dapr A 不认识这个方法, grpc_proxy.TransparentHandler 处理请求, 根据 `dapr-app-id` 与 dapr B 建立连接, 并将请求转发给 dapr B
3. dapr B 也不认识这个方法, grpc_proxy.TransparentHandler 处理请求, 根据 `dapr-app-id` 发现请求目标是自己, 与 service B 建立连接, 并将请求转发给 service B
4. service B `Echo` 处理请求, 并响应结果

## 参考资料

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
