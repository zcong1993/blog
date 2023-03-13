---
title: Dapr 源码解析 | 发布订阅
date: 2021-11-05T18:58:13+08:00
cover: /dapr-pubsub.png
description: 本文介绍 Dapr 发布订阅模块相关源码.
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
js:
  - js/prism-protobuf.min.js
---

发布订阅在 dapr 既是一个 component 又是一个 building block.

dapr 的 pubsub 构建块可以对外提供一个`最少一次送达保证`的发布订阅 API, 可以支持多种软件作为 message broker. 使用这个功能我们的服务就需要引入繁杂的 message broker sdk 和管理消息队列连接.

<!--more-->

## 总览

![overview](/dapr-pubsub-overview.png)

pubsub 功能分为发布和订阅两个部分:

1. 用户可以通过调用 dapr sidecar API 发送消息到某个 topic
2. 用户可以通过配置将 handler 绑定到某个 topic, 由 dapr sidecar 订阅 message broker 收到消息后交给用户 handler 处理

dapr 允许用户多个服务来订阅同一个 topic, 相当于 rabbitmq 中的 fanout 类型. 但是同一个服务多个实例则是会被放入一个 comsume group 中, 也就是一个消息只会有某个实例拿到.

默认情况下, dapr 会将用户消息包装成 [CloudEvents 1.0 specification](https://github.com/cloudevents/spec/tree/v1.0) 格式, 并且会自动集成分布式追踪.

```json
{
  "specversion": "1.0",
  "type": "xml.message",
  "source": "https://example.com/message",
  "subject": "Test XML Message",
  "id": "id-1234-5678-9101",
  "time": "2020-09-23T06:23:21Z",
  "datacontenttype": "text/xml",
  "data": "<note><to>User1</to><from>user2</from><message>hi</message></note>"
}
```

dapr 也允许通过配置来限制用户服务使用发布订阅 topic 的权限.

## 源码分析

首先 pubsub 作为一个 component, 我们查看它的 interface 声明:

```go
// http://github.com/zcong1993/components-contrib/blob/ff9f357a77f74a9ebaa0032da71c1f571143a1ca/pubsub/pubsub.go#L11-L11
type PubSub interface {
  Init(metadata Metadata) error
  Features() []Feature
  Publish(req *PublishRequest) error
  Subscribe(req SubscribeRequest, handler Handler) error
  Close() error
}

// Handler is the handler used to invoke the app handler
type Handler func(ctx context.Context, msg *NewMessage) error
```

1. Init 负责校验 component config 和初始化
2. Features 用来声明实现者所提供的特性, 下文说明
3. Publish 提供发布消息的能力
4. Subscribe 提供订阅消息的能力
5. Close 退出时关闭资源

dapr pubsub 只有一个 feature, 就是`消息生存时间`, 由于底层不同消息中间件能力不同, 所以需要使用 `Features` 方法告诉上层自己实现了哪些特性. dapr 很多模块都是使用这种方式控制特性.

### Publish

上文说明了, dapr sidecar 提供发布消息的 API:

```markup
POST http://localhost:<daprPort>/v1.0/publish/<pubsubname>/<topic>[?<metadata>]
```

```protobuf
service Dapr {
  // Publishes events to the specific topic.
  rpc PublishEvent(PublishEventRequest) returns (google.protobuf.Empty) {}
}
```

以 HTTP API 为例, 找到对应路由 handler:

```go

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/http/api.go#L238-L238
func (a *api) constructPubSubEndpoints() []Endpoint {
  return []Endpoint{
    {
      Methods: []string{fasthttp.MethodPost, fasthttp.MethodPut},
      Route:   "publish/{pubsubname}/{topic:*}",
      Version: apiVersionV1,
      Handler: a.onPublish,
    },
  }
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/http/api.go#L1306-L1306
// 省略掉错误校验
func (a *api) onPublish(reqCtx *fasthttp.RequestCtx) {
  pubsubName := reqCtx.UserValue(pubsubnameparam).(string)
  thepubsub := a.pubsubAdapter.GetPubSub(pubsubName)
  topic := reqCtx.UserValue(topicParam).(string)

  body := reqCtx.PostBody()
  contentType := string(reqCtx.Request.Header.Peek("Content-Type"))
  metadata := getMetadataFromRequest(reqCtx)
  rawPayload, metaErr := contrib_metadata.IsRawPayload(metadata)

  // Extract trace context from context.
  span := diag_utils.SpanFromContext(reqCtx)
  // Populate W3C traceparent to cloudevent envelope
  corID := diag.SpanContextToW3CString(span.SpanContext())

  data := body

  if !rawPayload {
    envelope, err := runtime_pubsub.NewCloudEvent(&runtime_pubsub.CloudEvent{
      ID:              a.id,
      Topic:           topic,
      DataContentType: contentType,
      Data:            body,
      TraceID:         corID,
      Pubsub:          pubsubName,
    })

    features := thepubsub.Features()

    pubsub.ApplyMetadata(envelope, features, metadata)

    data, err = a.json.Marshal(envelope)
    if err != nil {
      return
    }
  }

  req := pubsub.PublishRequest{
    PubsubName: pubsubName,
    Topic:      topic,
    Data:       data,
    Metadata:   metadata,
  }

  err := a.pubsubAdapter.Publish(&req)
  if err != nil {
    status := fasthttp.StatusInternalServerError
    respond(reqCtx, withError(status, msg))
    log.Debug(msg)
  } else {
    respond(reqCtx, withEmpty())
  }
}
```

上面的代码做的事情很简单, 校验参数, 拿到 pubsub name 和 topic 这些信息, 并且在用户不指定 raw 格式的时候将消息包装为 CloudEvent 格式, 最后调用 `pubsubAdapter.Publish` 方法处理消息.

`pubsubAdapter` 这个 interface 就是 runtime 来实现的, 所以 `pubsubAdapter.Publish` 其实就是 `runtime.Publish` 方法.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1243-L1243
func (a *DaprRuntime) Publish(req *pubsub.PublishRequest) error {
  thepubsub := a.GetPubSub(req.PubsubName)
  if thepubsub == nil {
    return runtime_pubsub.NotFoundError{PubsubName: req.PubsubName}
  }

  if allowed := a.isPubSubOperationAllowed(req.PubsubName, req.Topic, a.scopedPublishings[req.PubsubName]); !allowed {
    return runtime_pubsub.NotAllowedError{Topic: req.Topic, ID: a.runtimeConfig.ID}
  }

  return a.pubSubs[req.PubsubName].Publish(req)
}

// GetPubSub is an adapter method to find a pubsub by name.
func (a *DaprRuntime) GetPubSub(pubsubName string) pubsub.PubSub {
  return a.pubSubs[pubsubName]
}
```

可以看到它做了三件事:

1. 根据参数 pubsubName 拿到对应的 pubsub component 实例, `a.pubSubs` 就是之前组件介绍文章中组件加载完成保存的 map
2. 校验是否有发布消息的权限
3. 调用第一步拿到的 pubsub component `Publish` 方法发布消息到消息中间件

### Subscribe

订阅相比于发布实现会难很多.

在 `runtime.initRuntime` 方法中可以找到 subscribe 初始化入口为 `runtime.startSubscribing`:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L2093-L2093
func (a *DaprRuntime) startSubscribing() {
  for name, pubsub := range a.pubSubs {
    if err := a.beginPubSub(name, pubsub); err != nil {
      log.Errorf("error occurred while beginning pubsub %s: %s", name, err)
    }
  }
}

// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L463-L463
func (a *DaprRuntime) beginPubSub(name string, ps pubsub.PubSub) error {
  var publishFunc func(ctx context.Context, msg *pubsubSubscribedMessage) error
  switch a.runtimeConfig.ApplicationProtocol {
  case HTTPProtocol:
    publishFunc = a.publishMessageHTTP
  case GRPCProtocol:
    publishFunc = a.publishMessageGRPC
  }
  topicRoutes, err := a.getTopicRoutes()
  if err != nil {
    return err
  }
  v, ok := topicRoutes[name]
  if !ok {
    return nil
  }
  for topic, route := range v.routes {
    allowed := a.isPubSubOperationAllowed(name, topic, a.scopedSubscriptions[name])
    if !allowed {
      log.Warnf("subscription to topic %s on pubsub %s is not allowed", topic, name)
      continue
    }

    routeMetadata := route.metadata
    if err := ps.Subscribe(pubsub.SubscribeRequest{
      Topic:    topic,
      Metadata: route.metadata,
    }, func(ctx context.Context, msg *pubsub.NewMessage) error {
      if msg.Metadata == nil {
        msg.Metadata = make(map[string]string, 1)
      }

      msg.Metadata[pubsubName] = name

      rawPayload, err := contrib_metadata.IsRawPayload(routeMetadata)
      if err != nil {
        log.Errorf("error deserializing pubsub metadata: %s", err)
        return err
      }

      var cloudEvent map[string]interface{}
      data := msg.Data
      if rawPayload {
        cloudEvent = pubsub.FromRawPayload(msg.Data, msg.Topic, name)
        data, err = a.json.Marshal(cloudEvent)
        if err != nil {
          log.Errorf("error serializing cloud event in pubsub %s and topic %s: %s", name, msg.Topic, err)
          return err
        }
      } else {
        err = a.json.Unmarshal(msg.Data, &cloudEvent)
        if err != nil {
          log.Errorf("error deserializing cloud event in pubsub %s and topic %s: %s", name, msg.Topic, err)
          return err
        }
      }

      if pubsub.HasExpired(cloudEvent) {
        log.Warnf("dropping expired pub/sub event %v as of %v", cloudEvent[pubsub.IDField], cloudEvent[pubsub.ExpirationField])

        return nil
      }

      route := a.topicRoutes[msg.Metadata[pubsubName]].routes[msg.Topic]
      routePath, shouldProcess, err := findMatchingRoute(&route, cloudEvent, a.featureRoutingEnabled)
      if err != nil {
        return err
      }
      if !shouldProcess {
        // The event does not match any route specified so ignore it.
        log.Debugf("no matching route for event %v in pubsub %s and topic %s; skipping", cloudEvent[pubsub.IDField], name, msg.Topic)
        return nil
      }

      return publishFunc(ctx, &pubsubSubscribedMessage{
        cloudEvent: cloudEvent,
        data:       data,
        topic:      msg.Topic,
        metadata:   msg.Metadata,
        path:       routePath,
      })
    }); err != nil {
      log.Errorf("failed to subscribe to topic %s: %s", topic, err)
    }
  }

  return nil
}
```

1. 根据 `getTopicRoutes` 方法拿到服务订阅配置, 下文说明
2. 将拿到的所有 topic, 调用 pubsub component 的 Subscribe 订阅
3. subscribe handler 拿到订阅消息时, 将未过期的消息交给 `publishFunc` 处理

接着分析 `getTopicRoutes` 方法:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1138-L1138
func (a *DaprRuntime) getTopicRoutes() (map[string]TopicRoute, error) {
  if a.topicRoutes != nil {
    return a.topicRoutes, nil
  }

  topicRoutes := make(map[string]TopicRoute)

  if a.appChannel == nil {
    log.Warn("app channel not initialized, make sure -app-port is specified if pubsub subscription is required")
    return topicRoutes, nil
  }

  var subscriptions []runtime_pubsub.Subscription
  var err error

  // handle app subscriptions
  if a.runtimeConfig.ApplicationProtocol == HTTPProtocol {
    subscriptions, err = runtime_pubsub.GetSubscriptionsHTTP(a.appChannel, log)
  } else if a.runtimeConfig.ApplicationProtocol == GRPCProtocol {
    client := runtimev1pb.NewAppCallbackClient(a.grpc.AppClient)
    subscriptions, err = runtime_pubsub.GetSubscriptionsGRPC(client, log)
  }
  if err != nil {
    return nil, err
  }

  // handle declarative subscriptions
  ds := a.getDeclarativeSubscriptions()
  for _, s := range ds {
    skip := false

    // don't register duplicate subscriptions
    for _, sub := range subscriptions {
      if sub.PubsubName == s.PubsubName && sub.Topic == s.Topic {
        log.Warnf("two identical subscriptions found (sources: declarative, app endpoint). pubsubname: %s, topic: %s",
          s.PubsubName, s.Topic)
        skip = true
        break
      }
    }

    if !skip {
      subscriptions = append(subscriptions, s)
    }
  }

  for _, s := range subscriptions {
    if _, ok := topicRoutes[s.PubsubName]; !ok {
      topicRoutes[s.PubsubName] = TopicRoute{routes: make(map[string]Route)}
    }

    topicRoutes[s.PubsubName].routes[s.Topic] = Route{metadata: s.Metadata, rules: s.Rules}
  }

  if len(topicRoutes) > 0 {
    for pubsubName, v := range topicRoutes {
      topics := []string{}
      for topic := range v.routes {
        topics = append(topics, topic)
      }
      log.Infof("app is subscribed to the following topics: %v through pubsub=%s", topics, pubsubName)
    }
  }
  a.topicRoutes = topicRoutes
  return topicRoutes, nil
}
```

可以看到此函数会分别通过`声明式`和`函数式`两种方式拿到订阅配置并合并.

声明式是指使用 `Subscription` CRD 文件的形式定义配置, 而函数式是指用户通过路由 `/dapr/subscribe` 或者 grpc `ListTopicSubscriptions` handler 暴露给 dapr sidecar 的配置.

topicRoutes 则是 dapr 的新特性 [Pub/Sub routing](https://docs.dapr.io/developing-applications/building-blocks/pubsub/howto-route-messages/) 允许我们定义规则来使得同一个 topic 下可以为不同 `event.type` 消息绑定不同 handler. 本文不做过多介绍.

回到上面 beginPubSub 中最后调用的 `publishFunc` 函数.

开头总览部分可以看到 subscribe 的流程是, dapr sidecar 订阅消息中间件, 拿到消息之后将消息交给用户指定的 handler. 这个 `publishFunc` 做的就是将消息交给 handler.

本质其实就是使用了 `runtime.appChannel` 来调用绑定的 app 路由或者 grpc handler, 所以根据用户的 app 类型来选择调用 `publishMessageHTTP` 或 `publishMessageGRPC`.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/runtime/runtime.go#L1344-L1344
func (a *DaprRuntime) publishMessageHTTP(ctx context.Context, msg *pubsubSubscribedMessage) error {
  cloudEvent := msg.cloudEvent

  var span *trace.Span

  req := invokev1.NewInvokeMethodRequest(msg.path)
  req.WithHTTPExtension(nethttp.MethodPost, "")
  req.WithRawData(msg.data, contenttype.CloudEventContentType)

  if cloudEvent[pubsub.TraceIDField] != nil {
    traceID := cloudEvent[pubsub.TraceIDField].(string)
    sc, _ := diag.SpanContextFromW3CString(traceID)
    spanName := fmt.Sprintf("pubsub/%s", msg.topic)
    ctx, span = diag.StartInternalCallbackSpan(ctx, spanName, sc, a.globalConfig.Spec.TracingSpec)
  }

  resp, err := a.appChannel.InvokeMethod(ctx, req)
  if err != nil {
    return errors.Wrap(err, "error from app channel while sending pub/sub event to app")
  }

  statusCode := int(resp.Status().Code)

  if span != nil {
    m := diag.ConstructSubscriptionSpanAttributes(msg.topic)
    diag.AddAttributesToSpan(span, m)
    diag.UpdateSpanStatusFromHTTPStatus(span, statusCode)
    span.End()
  }

  _, body := resp.RawData()

  if (statusCode >= 200) && (statusCode <= 299) {
    // Any 2xx is considered a success.
    var appResponse pubsub.AppResponse
    err := a.json.Unmarshal(body, &appResponse)
    if err != nil {
      log.Debugf("skipping status check due to error parsing result from pub/sub event %v", cloudEvent[pubsub.IDField])
      // Return no error so message does not get reprocessed.
      return nil // nolint:nilerr
    }

    switch appResponse.Status {
    case "":
      // Consider empty status field as success
      fallthrough
    case pubsub.Success:
      return nil
    case pubsub.Retry:
      return errors.Errorf("RETRY status returned from app while processing pub/sub event %v", cloudEvent[pubsub.IDField])
    case pubsub.Drop:
      log.Warnf("DROP status returned from app while processing pub/sub event %v", cloudEvent[pubsub.IDField])
      return nil
    }
    // Consider unknown status field as error and retry
    return errors.Errorf("unknown status returned from app while processing pub/sub event %v: %v", cloudEvent[pubsub.IDField], appResponse.Status)
  }

  if statusCode == nethttp.StatusNotFound {
    // These are errors that are not retriable, for now it is just 404 but more status codes can be added.
    // When adding/removing an error here, check if that is also applicable to GRPC since there is a mapping between HTTP and GRPC errors:
    // https://cloud.google.com/apis/design/errors#handling_errors
    log.Errorf("non-retriable error returned from app while processing pub/sub event %v: %s. status code returned: %v", cloudEvent[pubsub.IDField], body, statusCode)
    return nil
  }

  // Every error from now on is a retriable error.
  log.Warnf("retriable error returned from app while processing pub/sub event %v: %s. status code returned: %v", cloudEvent[pubsub.IDField], body, statusCode)
  return errors.Errorf("retriable error returned from app while processing pub/sub event %v: %s. status code returned: %v", cloudEvent[pubsub.IDField], body, statusCode)
}
```

1. 将消息和用户绑定的路由转化成 `appChannel.InvokeMethod` 的请求参数, 并调用用户接口
2. 根据用户接口响应, 控制此函数 error 返回进而控制重试

`publishMessageGRPC` 也是同理, 只是消息格式不同.

## 其他

### 重试处理

dapr 订阅功能可以根据我们绑定 handler 的响应来判断消息是否消费成功, 没成功的消息会尝试重试操作.

对于能够自己处理重试的消息中间件, 例如 rabbitmq 的 nack 操作, dapr 会使用中间件自身的重试机制, 而自身不支持时, 会采用 `backoffRetry` 的方式处理重试.

```go
// http://github.com/zcong1993/components-contrib/blob/ff9f357a77f74a9ebaa0032da71c1f571143a1ca/pubsub/kafka/kafka.go#L78-L78
if err := retry.NotifyRecover(func() error {
  consumer.k.logger.Debugf("Processing Kafka message: %s/%d/%d [key=%s]", message.Topic, message.Partition, message.Offset, asBase64String(message.Key))
  err := consumer.callback(session.Context(), &msg)
  if err == nil {
    session.MarkMessage(message, "")
  }

  return err
}, b, func(err error, d time.Duration) {
  consumer.k.logger.Errorf("Error processing Kafka message: %s/%d/%d [key=%s]. Retrying...", message.Topic, message.Partition, message.Offset, asBase64String(message.Key))
}, func() {
  consumer.k.logger.Infof("Successfully processed Kafka message after it previously failed: %s/%d/%d [key=%s]", message.Topic, message.Partition, message.Offset, asBase64String(message.Key))
}); err != nil {
  return err
}
```

## **参考资料**

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://github.com/dapr/components-contrib](https://github.com/dapr/components-contrib)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
