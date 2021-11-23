---
title: Dapr 源码解析 | 可观测性
date: 2021-11-23T14:34:46+08:00
cover: /dapr-observability.png
description: 本文介绍 Dapr Observability 相关源码.
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

Observability(可观测性)一般指 `Logging`, `Metrics` 和 `Tracing` .

<!--more-->

## Logging

从最基本的日志说起, 容器化时代特别是 k8s 时代, 容器日志基本都会直接输出到 stdout, 再由容器运行时收集. 基于 k8s 的日志解决方案有很多, 例如: loki, EFK 之类.

一般来说使用 json 格式会更便于日志收集器解析.

所以 dapr 的日志也是直接输出到 stdout, 唯一需要注意的是生产环境最好将日志输出格式设置成 json. 可以通过 k8s annotations `dapr.io/log-as-json: "true"` 设置. 对于 dapr 自己的服务, 可以在 helm 安装时通过 flag `-set global.logAsJson=true` 设置.

## Metrics

指标监控方面, [Prometheus](https://prometheus.io/) 基本已经成为标准了, 所以 dapr 也是通过暴露 prometheus 格式的指标入口, 之后通过配置 prometheus 就可以完成指标抓取.

dapr 使用 [https://opencensus.io](https://opencensus.io/) 库来计算和暴露指标, 虽然 OpenCensus 和 OpenTracing 已经合并成了 [OpenTelemetry](https://opentelemetry.io).

所有 dapr 服务对外暴露的指标列表可见 [https://github.com/dapr/dapr/blob/master/docs/development/dapr-metrics.md](https://github.com/dapr/dapr/blob/master/docs/development/dapr-metrics.md). 本文仅分析 runtime 相关.

### 指标更新

`runtime.initRuntime` 中的第一行代码就是调用 `diag.InitMetrics` 初始化 metrics, 直接查看此方法:

```go
func InitMetrics(appID string) error {
  if err := DefaultMonitoring.Init(appID); err != nil {
    return err
  }

  if err := DefaultGRPCMonitoring.Init(appID); err != nil {
    return err
  }

  if err := DefaultHTTPMonitoring.Init(appID); err != nil {
    return err
  }

  // Set reporting period of views
  view.SetReportingPeriod(DefaultReportingPeriod)

  return nil
}
```

可以看出 runtime 指标主要分为三部分: runtime 服务, http 调用和 grpc 调用.

runtime 服务相关指标声名在源码 [pkg/diagnostics/service_monitoring.go](http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/diagnostics/service_monitoring.go#L58-L58) 中, 主要分为 component load 相关, mTLS 相关, actor 相关, access control 相关. 这些指标基本都是宏观的, 比如有多少个 component 载入成功或失败, mTLS 请求证书成功和失败多少次. `serviceMetrics` 还封装了各个指标更新的方法:

```go
// ComponentLoaded records metric when component is loaded successfully.
func (s *serviceMetrics) ComponentLoaded() {
  if s.enabled {
    stats.RecordWithTags(s.ctx, diag_utils.WithTags(appIDKey, s.appID), s.componentLoaded.M(1))
  }
}

// ComponentInitialized records metric when component is initialized.
func (s *serviceMetrics) ComponentInitialized(component string) {
  if s.enabled {
    stats.RecordWithTags(
      s.ctx,
      diag_utils.WithTags(appIDKey, s.appID, componentKey, component),
      s.componentInitCompleted.M(1))
  }
}
```

接着要做的就是在相应的时机调用相应的函数更新指标, 例如 `ComponentLoaded` 就是在 `runtime.processComponentAndDependents` 函数中 componet 载入成功时调用的:

```go
func (a *DaprRuntime) processComponentAndDependents(comp components_v1alpha1.Component) error {
  // ...
  go func() {
    ch <- a.doProcessOneComponent(compCategory, comp)
  }()
  // ...
  log.Infof("component loaded. name: %s, type: %s/%s", comp.ObjectMeta.Name, comp.Spec.Type, comp.Spec.Version)
  a.appendOrReplaceComponents(comp)
  diag.DefaultMonitoring.ComponentLoaded()
  // ...
}
```

剩下两个 HTTP 和 grpc 的指标大家应该很熟悉, 就是请求成功数, 失败数, 延迟等常见应用指标.

HTTP metrics 分为两个部分 server 端和 client 端.

server 端使用标准 fast http middleware 的方式实现, 这种大家应该非常熟悉, 不做过多说明:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/diagnostics/http_monitoring.go#L173-L173
func (h *httpMetrics) FastHTTPMiddleware(next fasthttp.RequestHandler) fasthttp.RequestHandler {
  return func(ctx *fasthttp.RequestCtx) {
    reqContentSize := ctx.Request.Header.ContentLength()
    if reqContentSize < 0 {
      reqContentSize = 0
    }

    method := string(ctx.Method())
    path := h.convertPathToMetricLabel(string(ctx.Path()))

    h.ServerRequestReceived(ctx, method, path, int64(reqContentSize))

    start := time.Now()

    next(ctx)

    status := strconv.Itoa(ctx.Response.StatusCode())
    elapsed := float64(time.Since(start) / time.Millisecond)
    respSize := int64(len(ctx.Response.Body()))
    h.ServerRequestCompleted(ctx, method, path, status, respSize, elapsed)
  }
}
```

http client 端则是指 dapr runtime 使用 http 的方式请求用户 app 的指标(因为 dapr sidecar 之间完全使用 grpc 交流), 所以相关指标在 `http_channel.invokeMethodV1` 中更新:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/channel/http/http_channel.go#L142-L142
func (h *Channel) invokeMethodV1(ctx context.Context, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  // ...
  verb := string(channelReq.Header.Method())
  // update metrics
  diag.DefaultHTTPMonitoring.ClientRequestStarted(ctx, verb, req.Message().Method, int64(len(req.Message().Data.GetValue())))
  startRequest := time.Now()

  resp := fasthttp.AcquireResponse()
  err := h.client.Do(channelReq, resp)
  defer func() {
    fasthttp.ReleaseRequest(channelReq)
    fasthttp.ReleaseResponse(resp)
  }()

  elapsedMs := float64(time.Since(startRequest) / time.Millisecond)

  if err != nil {
    // update metrics
    diag.DefaultHTTPMonitoring.ClientRequestCompleted(ctx, verb, req.Message().GetMethod(), strconv.Itoa(nethttp.StatusInternalServerError), int64(resp.Header.ContentLength()), elapsedMs)
    return nil, err
  }

  rsp := h.parseChannelResponse(req, resp)
  // update metrics
  diag.DefaultHTTPMonitoring.ClientRequestCompleted(ctx, verb, req.Message().GetMethod(), strconv.Itoa(int(rsp.Status().Code)), int64(resp.Header.ContentLength()), elapsedMs)

  return rsp, nil
}
```

grpc 相关指标和 HTTP 类似, 不过 server 端和 client 都是使用 grpc middleware 实现的, 并没有实现 stream 相关:

```go
// UnaryServerInterceptor is a gRPC server-side interceptor for Unary RPCs.
func (g *grpcMetrics) UnaryServerInterceptor() func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
  return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
    start := g.ServerRequestReceived(ctx, info.FullMethod, int64(g.getPayloadSize(req)))
    resp, err := handler(ctx, req)
    size := 0
    if err == nil {
      size = g.getPayloadSize(resp)
    }
    g.ServerRequestSent(ctx, info.FullMethod, status.Code(err).String(), int64(size), start)
    return resp, err
  }
}

// UnaryClientInterceptor is a gRPC client-side interceptor for Unary RPCs.
func (g *grpcMetrics) UnaryClientInterceptor() func(ctx context.Context, method string, req, reply interface{}, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
  return func(ctx context.Context, method string, req, reply interface{}, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
    start := g.ClientRequestSent(ctx, method, int64(g.getPayloadSize(req)))
    err := invoker(ctx, method, req, reply, cc, opts...)
    size := 0
    if err == nil {
      size = g.getPayloadSize(reply)
    }
    g.ClientRequestReceived(ctx, method, status.Code(err).String(), int64(size), start)
    return err
  }
}
```

并分别在 [pkg/grpc/server.go](http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/server.go#L199-L199) 和 [pkg/grpc/grpc.go](http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/grpc.go#L97-L97) 中被加入 grpc option.

### 指标暴露

指标更新在内存之后还得向外暴露一个 http 路由以供指标收集软件抓取. 这一步在 `runtime.FromFlags` 中进行:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/cli.go#L33-L33
func FromFlags() (*DaprRuntime, error) {
  // ...
  metricsExporter := metrics.NewExporter(metrics.DefaultMetricNamespace)
  // 将 --metrics-port 和 --enable-metric 注册到 flags 中
  metricsExporter.Options().AttachCmdFlags(flag.StringVar, flag.BoolVar)
  flag.Parse()
  // ...
  // 调用 Init 初始化
  if err := metricsExporter.Init(); err != nil {
    log.Fatal(err)
  }
  //...
}
```

`metricsExporter.Init` 方法初始化了一个 prometheus exporter, 并且开启一个 http 服务将它暴露.

```go
func (m *promMetricsExporter) Init() error {
  if !m.exporter.Options().MetricsEnabled {
    return nil
  }

  var err error
  if m.ocExporter, err = ocprom.NewExporter(ocprom.Options{
    Namespace: m.namespace,
    Registry:  prom.DefaultRegisterer.(*prom.Registry),
  }); err != nil {
    return errors.Errorf("failed to create Prometheus exporter: %v", err)
  }

  // start metrics server
  return m.startMetricServer()
}

func (m *promMetricsExporter) startMetricServer() error {
  go func() {
    mux := http.NewServeMux()
    mux.Handle(defaultMetricsPath, m.ocExporter)

    if err := http.ListenAndServe(addr, mux); err != nil {
      m.exporter.logger.Fatalf("failed to start metrics server: %v", err)
    }
  }()

  return nil
}
```

## Tracing

dapr tracing 也是使用 OpenCensus 实现的. Tracing 对于 go 语言来说使用起来是相对简单的, 因为基本 io 操作相关函数都会传递 context, tracing span 就可以使用 context 来传递. 并且 dapr runtime 位于应用层, 请求都是显示转发的, 所以添加 tracing 功能也相对简单.

dapr tracing 分为三部分, HTTP, gRPC 和消息类.

### HTTP Tracing

dapr 中使用 HTTP 协议的有两部分, 分别是 HTTP API server 和 HTTP AppChannel, 一边作为 server 一边作为 client.

对于 server 端, dapr 使用标准 fast http middleware 的形式实现:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/diagnostics/http_tracing.go#L39-L39
func HTTPTraceMiddleware(next fasthttp.RequestHandler, appID string, spec config.TracingSpec) fasthttp.RequestHandler {
  return func(ctx *fasthttp.RequestCtx) {
    path := string(ctx.Request.URI().Path())
    // 忽略健康检查路由
    if isHealthzRequest(path) {
      next(ctx)
      return
    }
    // 从当前 ctx 开启新 span, 当前上下文会被作为 parent span
    ctx, span := startTracingClientSpanFromHTTPContext(ctx, path, spec)
    // 调用后续 handler
    next(ctx)

    // 当 span 被采样时再更新 span 属性, 减少计算
    if span.SpanContext().TraceOptions.IsSampled() {
      AddAttributesToSpan(span, userDefinedHTTPHeaders(ctx))
      spanAttr := spanAttributesMapFromHTTPContext(ctx)
      AddAttributesToSpan(span, spanAttr)

      // Correct the span name based on API.
      if sname, ok := spanAttr[daprAPISpanNameInternal]; ok {
        span.SetName(sname)
      }
    }

    if ctx.Response.Header.Peek(traceparentHeader) == nil {
      span = diag_utils.SpanFromContext(ctx)
      SpanContextToHTTPHeaders(span.SpanContext(), ctx.Response.Header.Set)
    }
    // 根据响应状态码更新 span 状态属性
    UpdateSpanStatusFromHTTPStatus(span, ctx.Response.StatusCode())
    // 结束 span
    span.End()
  }
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/http/server.go#L64-L64
func (s *server) StartNonBlocking() error {
  // ...
  handler = s.useTracing(handler)
  // ...
}

func (s *server) useTracing(next fasthttp.RequestHandler) fasthttp.RequestHandler {
  // 配置开启 tracing 时添加中间件
  if diag_utils.IsTracingEnabled(s.tracingSpec.SamplingRate) {
    log.Infof("enabled tracing http middleware")
    return diag.HTTPTraceMiddleware(next, s.config.AppID, s.tracingSpec)
  }
  return next
}
```

对于 client 端, dapr 不做 span 提交, 仅仅是将 tracing header 传递给用户 app:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/channel/http/http_channel.go#L179-L179
func (h *Channel) constructRequest(ctx context.Context, req *invokev1.InvokeMethodRequest) *fasthttp.Request {
  channelReq := fasthttp.AcquireRequest()
  // ...
  // 从当前 ctx 获取 span
  span := diag_utils.SpanFromContext(ctx)
  httpFormat := &tracecontext.HTTPFormat{}
  // 将 span 序列化并设置 http request header
  tp, ts := httpFormat.SpanContextToHeaders(span.SpanContext())
  channelReq.Header.Set("traceparent", tp)
  if ts != "" {
    channelReq.Header.Set("tracestate", ts)
  }
  // ...
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/diagnostics/utils/trace_utils.go#L59-L59
func SpanFromContext(ctx context.Context) *trace.Span {
  if reqCtx, ok := ctx.(*fasthttp.RequestCtx); ok {
    val := reqCtx.UserValue(daprFastHTTPContextKey)
    if val == nil {
      return nil
    }
    return val.(*trace.Span)
  }

  return trace.FromContext(ctx)
}
```

用户会收到 `traceparent: '00-335e5042916a0eb409d72ce631f3df88-c20be56b7f30aafb-01'` header, 可以基于此追踪信息自行做后续操作.

### GRPC Tracing

dapr 中使用 gRPC 协议可分为四个部分, API Server, Internal Server, Internal Client, AppChannel.

gRPC API server 和 Internal Server 都使用标准 `UnaryServerInterceptor` 和 `StreamServerInterceptor` 来实现 tracing.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/diagnostics/grpc_tracing.go#L34-L34
func GRPCTraceUnaryServerInterceptor(appID string, spec config.TracingSpec) grpc.UnaryServerInterceptor {
  return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
    var span *trace.Span
    spanName := info.FullMethod
    // 从当前 ctx 的 grpc metadata 中获取的 tracing 信息初始化成 span
    sc, _ := SpanContextFromIncomingGRPCMetadata(ctx)
    sampler := diag_utils.TraceSampler(spec.SamplingRate)

    var spanKind trace.StartOption

    // 此函数是共享的, internal grpc kind 会被设置成 server
    // runtime grpc 会被设置为 client
    if isInternalCalls(info.FullMethod) {
      spanKind = trace.WithSpanKind(trace.SpanKindServer)
    } else {
      spanKind = trace.WithSpanKind(trace.SpanKindClient)
    }
    // 以上面解析出的当前 span 作为 parent, 开启新的 span
    ctx, span = trace.StartSpanWithRemoteParent(ctx, spanName, sc, sampler, spanKind)
    // 调用后续 handler
    resp, err := handler(ctx, req)
    // 添加此次调用相关的 span 属性
    addSpanMetadataAndUpdateStatus(ctx, span, info.FullMethod, appID, req, false)

    // Add grpc-trace-bin header for all non-invocation api's
    if info.FullMethod != "/dapr.proto.runtime.v1.Dapr/InvokeService" {
      traceContextBinary := propagation.Binary(span.SpanContext())
      grpc.SetHeader(ctx, metadata.Pairs(grpcTraceContextKey, string(traceContextBinary)))
    }
    // 更新 span 状态属性
    UpdateSpanStatusFromGRPCError(span, err)
    // 结束 span
    span.End()

    return resp, err
  }
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/server.go#L173-L173
func (s *server) getMiddlewareOptions() []grpc_go.ServerOption {
  // ...
  if diag_utils.IsTracingEnabled(s.tracingSpec.SamplingRate) {
    s.logger.Info("enabled gRPC tracing middleware")
    intr = append(intr, diag.GRPCTraceUnaryServerInterceptor(s.config.AppID, s.tracingSpec))
    // grpc proxy 功能是基于 stream 的, 功能开启时增加 StreamServerInterceptor
    if s.proxy != nil {
      intrStream = append(intrStream, diag.GRPCTraceStreamServerInterceptor(s.config.AppID, s.tracingSpec))
    }
  }
  // ...
}
```

StreamServerInterceptor 也是类似的, 不做过多说明.

gRPC Internal Client 和 AppChannel 也是不主动提交 span, 只是将 span 通过 metadata 传递.

internal grpc client 是在 `directMessaging.invokeRemote` 中使用:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/messaging/direct_messaging.go#L173-L173
func (d *directMessaging) invokeRemote(ctx context.Context, appID, namespace, appAddress string, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  conn, err := d.connectionCreatorFn(context.TODO(), appAddress, appID, namespace, false, false, false)
  //
  ctx = d.setContextSpan(ctx)
  // ...
}

func (d *directMessaging) setContextSpan(ctx context.Context) context.Context {
  // 从当前 ctx 拿到 span, 将其注入 grpc request metadata
  span := diag_utils.SpanFromContext(ctx)
  ctx = diag.SpanContextToGRPCMetadata(ctx, span.SpanContext())

  return ctx
}
```

AppChannel 则是在 `channel.invokeMethodV1` 中使用:

```go
func (g *Channel) invokeMethodV1(ctx context.Context, req *invokev1.InvokeMethodRequest) (*invokev1.InvokeMethodResponse, error) {
  // ...
  clientV1 := runtimev1pb.NewAppCallbackClient(g.client)
  // 将 req metadata 转化成 grpc metadata, 包含 tracing 相关
  grpcMetadata := invokev1.InternalMetadataToGrpcMetadata(ctx, req.Metadata(), true)
  // ...
}
```

### 消息类

目前找到的有两种, pub/sub 和 input binding 消息.

之前文章提到过, pub/sub 默认情况下会将消息封装成 CloudEvent 的格式, 此时会显式得使用 `TraceID` 传递追踪信息.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/http/api.go#L1306-L1306
func (a *api) onPublish(reqCtx *fasthttp.RequestCtx) {
  // ...
  // 从当前 ctx 获取 span 信息
  span := diag_utils.SpanFromContext(reqCtx)
  // 序列化成字符串
  corID := diag.SpanContextToW3CString(span.SpanContext())

  if !rawPayload {
    envelope, err := runtime_pubsub.NewCloudEvent(&runtime_pubsub.CloudEvent{
      ID:              a.id,
      Topic:           topic,
      DataContentType: contentType,
      Data:            body,
      TraceID:         corID, // 显式传递
      Pubsub:          pubsubName,
    })
  }
  // ...
}
```

而在订阅这边, 则是尝试从消息 `TraceID` 字段拿到追踪信息, 来建立调用用户 handler 行为的追踪信息, 调用用户 handler 有 `publishMessageHTTP` 和 `publishMessageGRPC` 两种形式, 以 HTTP 为例:

```go
func (a *DaprRuntime) publishMessageHTTP(ctx context.Context, msg *pubsubSubscribedMessage) error {
  cloudEvent := msg.cloudEvent
  var span *trace.Span
  // 尝试从 cloudEvent TraceID 字段拿到追踪信息, 并初始化 span
  if cloudEvent[pubsub.TraceIDField] != nil {
    traceID := cloudEvent[pubsub.TraceIDField].(string)
    sc, _ := diag.SpanContextFromW3CString(traceID)
    spanName := fmt.Sprintf("pubsub/%s", msg.topic)
    ctx, span = diag.StartInternalCallbackSpan(ctx, spanName, sc, a.globalConfig.Spec.TracingSpec)
  }
  // 调用用户 handler
  resp, err := a.appChannel.InvokeMethod(ctx, req)
  if err != nil {
    return errors.Wrap(err, "error from app channel while sending pub/sub event to app")
  }

  statusCode := int(resp.Status().Code)

  if span != nil {
    // 添加 span 属性, 并结束 span
    m := diag.ConstructSubscriptionSpanAttributes(msg.topic)
    diag.AddAttributesToSpan(span, m)
    diag.UpdateSpanStatusFromHTTPStatus(span, statusCode)
    span.End()
  }
  // ...
}
```

input binding 则是单纯创建一个新的 span 来追踪调用用户 handler 的行为:

```go
func (a *DaprRuntime) sendBindingEventToApp(bindingName string, data []byte, metadata map[string]string) ([]byte, error) {
  var response bindings.AppResponse
  spanName := fmt.Sprintf("bindings/%s", bindingName)
  // 创建一个新的 span, parent span 为空
  ctx, span := diag.StartInternalCallbackSpan(context.Background(), spanName, trace.SpanContext{}, a.globalConfig.Spec.TracingSpec)
  if a.runtimeConfig.ApplicationProtocol == GRPCProtocol {
    // 将 span 注入 grpc request ctx 中
    ctx = diag.SpanContextToGRPCMetadata(ctx, span.SpanContext())
    // 调用用户 handler
    client := runtimev1pb.NewAppCallbackClient(a.grpc.AppClient)
    resp, err := client.OnBindingEvent(ctx, req)
    if span != nil {
      // 更新 span 属性, 并结束 span
      m := diag.ConstructInputBindingSpanAttributes(
        bindingName,
        "/dapr.proto.runtime.v1.AppCallback/OnBindingEvent")
      diag.AddAttributesToSpan(span, m)
      diag.UpdateSpanStatusFromGRPCError(span, err)
      span.End()
    }
  }
  // HTTP 形式也是同理
  // ...
}
```

## 参考资料

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
