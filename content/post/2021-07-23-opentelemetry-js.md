---
title: OpenTelemetry-JS Tracing 实现详解
date: 2021-07-23T18:05:25+08:00
cover: /opentelemetry/cover.png
description: 本文讲解 OpenTelemetry-JS tracing 相关使用和实现原理.
categories:
  - Tracing
  - NodeJS
tags:
  - CNCF
  - Tracing
  - NodeJS
  - OpenTelemetry
keywords:
  - CNCF
  - Tracing
  - NodeJS
  - OpenTelemetry
draft: false
---

## 1. OpenTelemetry 是什么?

[OpenTelemetry](https://opentelemetry.io) 是由 [OpenTracing](https://opentracing.io) 和 [OpenCensus](https://opencensus.io) 合并而成, 前身之一 OpenTracing 则是 CNCF 的一个 tracing  方向的孵化项目. OpenTelemetry 对自己的定义是一个大而全的可观测性框架.

<!--more-->

## 2. Tracing 是什么?

系统的可观测性(Observability)一般指 `Logging`, `Metrics`, `Tracing`. Tracing 也就是链路追踪往往是距离我们最遥远的, 因为实现起来比另外两个难得多.

微服务时代, 一个外部请求需要内部若干服务的联动响应, 这时候完整的调用轨迹将跨越多个服务, 同时包括服务间的网络传输信息与各个服务内部的调用堆栈信息. 追踪的主要目的是排查故, 如分析调用链的哪一部分、哪个方法出现错误或阻塞, 输入输出是否符合预期, 等等.

例如: A 服务收到用户请求, 通过 grpc 调用了 B 和 C 服务, B 服务读写了数据库, 然后再通过 http 请求了 D. 有了追踪理论上我们可以知道这个请求以上各个步骤分别从何时开始用了多久, 有没有出现错误.

## 3. Tracing 时序图(效果)

![tracing01](/opentelemetry/tracing01.png)

根据上图可以想象: 一个请求进来被 http server handler (1) 处理, 1 调用了函数 2, 函数 2 内做了数据库操作 3, 之后并发调用函数 4 和 5, 结束后 1 返回请求响应.

<!-- ![jaeger](/opentelemetry/jaeger.png) -->
{{< figure src="/opentelemetry/jaeger.png" alt="jaeger" position="center" caption="Jaeger web UI 中的 tracing 时序图" captionPosition="center" >}}

### 3.1 数据格式

是一个树形结构, 以 jaeger 为例, `references` 记录父子层级关系, `startTime` 和 `duration` 记录 span 执行时间. 删掉不相关字段后如下:

```js
{
  "data": [
    {
      "traceID": "fb2d2bbff8c53ddb2d9aa25cabad22fd",
      "spans": [
        {
          "traceID": "fb2d2bbff8c53ddb2d9aa25cabad22fd",
          "spanID": "76aaa1e18584ecb1",
          "operationName": "2",
          "references": [
            {
              "refType": "CHILD_OF",
              "traceID": "fb2d2bbff8c53ddb2d9aa25cabad22fd",
              "spanID": "ca8d5cedee0f6241"
            }
          ],
          "startTime": 1626922994782859,
          "duration": 329844
        },
        {
          "traceID": "fb2d2bbff8c53ddb2d9aa25cabad22fd",
          "spanID": "22b6b3a3942abc66",
          "operationName": "3",
          "references": [
            {
              "refType": "CHILD_OF",
              "traceID": "fb2d2bbff8c53ddb2d9aa25cabad22fd",
              "spanID": "76aaa1e18584ecb1"
            }
          ],
          "startTime": 1626922994888037,
          "duration": 200680
        },
        {
          "traceID": "fb2d2bbff8c53ddb2d9aa25cabad22fd",
          "spanID": "ca8d5cedee0f6241",
          "operationName": "1",
          "references": [],
          "startTime": 1626922994781944,
          "duration": 836854
        },
        ...
      ]
    }
  ]
}
```

## 4. 实现原理

了解了 tracing 数据结构, 可以知道它收集的核心信息是: 开始时间, 持续时间和父子层级关系. 其实是要做 **定义某一个代码块为一个 span 开始时 startSpan 结束时调用 endSpan, 如果需要子 span 则要以当前 span 为 parent 将关系处理好**, 很像代码块中的局部变量.

```js
// 伪代码
{
  let span = { parent: null, name: 'root' }

  {
    // child 1
    const parent = span
    let span = { parent, name: 'child-1' }
    // do child 1 work

    span.end()
  }

  // do root work

  span.end()
}
```

### 4.1 AsyncLocalStorage 管理 local span

[AsyncLocalStorage](https://nodejs.org/dist/latest-v16.x/docs/api/async_context.html#async_context_class_asynclocalstorage) 相当于 java 的 `ThreadLocal`

`context.active()` 永远能够拿到当前 scope 的 span 对象(记作 active span), `tracer.startSpan()` 默认会以 active span 作为 parent 创建出子 span, 层级关系就这样有了, 最后用 `context.with(ctx, fn)` 使函数在 scope 中执行(封装的 `asyncLocalStorage.run` 方法).

根据上面原理分析, tracing 伪代码如下:

```ts
const span = tracer.startSpan(spanName, spanOptions)

const run = async (name: string, fn: () => Promise<any>) => {
  const span = tracer.startSpan(name)

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      await fn()
    } finally {
      span.end()
    }
  })
}
```

AsyncLocalStorage 对比版本:

```js
const asyncLocalStorage = new AsyncLocalStorage()

const active = () => {
  return asyncLocalStorage.getStore() || { parent: null, name: 'root' }
}

const print = (prefix) => {
  let c = active()
  let l = [`${prefix}`]

  while(c.parent) {
    l.push(c.name)
    c = c.parent
  }

  console.log(l.reverse()
    .map(n => n.length >= 5 ? n : n + ' '.repeat(5-n.length))
    .join(' '.repeat(5)))
}

const run = async (name, fn) => {
  const parent = active()
  const current = {
    parent,
    name
  }

  return asyncLocalStorage.run(current, async () => {
    print('start')
    try {
      await fn()
    } finally {
      print('end')
    }
  })
}
```

#### 4.1.1 额外处理 EventEmitter

默认情况下 `EventEmitter` callback 执行时上下文是不确定的, 但是我们需要 context 来维护层级关系, 所以需要额外为所有 callback 绑定当前 context.

为事件 callback 绑定 scope 实现细节查看 [AbstractAsyncHooksContextManager.ts#L97](https://github.com/open-telemetry/opentelemetry-js/blob/56de304a99158dfad424410e65d99e1940c8635d/packages/opentelemetry-context-async-hooks/src/AbstractAsyncHooksContextManager.ts#L97).

### 4.2 跨服务传播

跨服务传播需要根据协议选择 `carrier`, 并且通过 [PropagationAPI](https://github.com/open-telemetry/opentelemetry-js-api/blob/14655bc1730d01d2e6ac153abba2f472c7a71b5d/src/api/propagation.ts#L45) 进行注入或者读取.

http 协议选择 header 作为 carrier, grpc 使用 metadata.

核心为下面两个方法:

- inject 负责将当前 context 中的 span 信息注入 carrier 发送给另一个服务
- extract 负责从接收到的 carrier 中还原 span 信息

```ts
class PropagationAPI {
    /**
     * Inject context into a carrier to be propagated inter-process
     *
     * @param context Context carrying tracing data to inject
     * @param carrier carrier to inject context into
     * @param setter Function used to set values on the carrier
     */
    inject<Carrier>(context: Context, carrier: Carrier, setter?: TextMapSetter<Carrier>): void;
    /**
     * Extract context from a carrier
     *
     * @param context Context which the newly created context will inherit from
     * @param carrier Carrier to extract context from
     * @param getter Function used to extract keys from a carrier
     */
    extract<Carrier>(context: Context, carrier: Carrier, getter?: TextMapGetter<Carrier>): Context;
}
```

![propagation](/opentelemetry/propagation.png)

跨服务通过 carrier 传播 span 信息, 服务内部通过 AsyncLocalStorage 传递 span

可通过打印 grpc metadata 看到传递的 span 信息(下面为默认格式):

```js
{
  // 00-traceId-spanId-01
  traceparent: '00-5f2c391594a2aab0405f2717bb3f5edf-465073d693b58b16-01'
}
```

#### 4.2.1 instrumentation-grpc 相关代码

server 端 extract 代码:

```ts
context.with(
  propagation.extract(ROOT_CONTEXT, call.metadata, {
    get: (carrier, key) => carrier.get(key).map(String),
    keys: carrier => Object.keys(carrier.getMap()),
  }),
  () => {
    // run origin server handler in span context
  }
)
```

client 端 inject 代码:

```ts
export function setSpanContext(metadata: grpcJs.Metadata): void {
  propagation.inject(context.active(), metadata, {
    set: (metadata, k, v) => metadata.set(k, v as grpcJs.MetadataValue),
  });
}
```

### 4.3 instrumentation 实现原理

js 相关 [instrumentations](https://opentelemetry.io/registry/?language=js&component=instrumentation#)

instrumentation 通过 monkey patch 形式更改相应的库进行无感知 tracing 注入, 自动做到以下几点:

- 在某个 handler 开始时调用 startSpan, 结束时调用 endSpan, 并保证 handler 在 span scope 中执行
- 库做跨服务沟通时, inject 或者 extract 进行 span 传递和转换
- 增加 span kind attributes 等信息

例如: instrumentation-http 会将 node http/https http server 和 client 相关函数 patch 掉

- 保证 http server handler 和 client request 在相应的 span 中执行
- inject extract 转换 header 和 span
- 增加 attributes 如: ip port method path status

## 5. 如何使用

由于 instrumentation 使用 monkey patch 实现, 所以需要在 patch 库之前执行, 某些框架有自己的加载器, 没有一个入口文件, 所以建议单独定义一个 `trace.js` 文件, 使用 `node --require trace.js app.js` 启动应用, 框架基本都有给 node 传递 require 文件的方法.

```ts
import { NodeTracerProvider } from '@opentelemetry/node'
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { Resource } from '@opentelemetry/resources';
import { ResourceAttributes } from '@opentelemetry/semantic-conventions';
import { SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/tracing'
import { JaegerExporter } from '@opentelemetry/exporter-jaeger'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc'

const serviceName = process.env.serviceName || 'server'

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)

// 声名定义 tracer provider
const provider = new NodeTracerProvider({
  resource: new Resource({
    // 定义 service 名称
    [ResourceAttributes.SERVICE_NAME]: serviceName,
  }),
});

// 定义 tracing 输出服务, zipkin 选择 ZipkinExporter
const exporter = new JaegerExporter({
  host: 'localhost',
  port: 6832,
})

// SimpleSpanProcessor 每个 span 发一个请求, 性能很低, 生产环境不要用
// provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
// BatchSpanProcessor 批处理, 生产环境使用
provider.addSpanProcessor(new BatchSpanProcessor(exporter))

// 注册需要的 instrumentations
registerInstrumentations({
  instrumentations: [new GrpcInstrumentation()],
})

provider.register()

console.log('tracing initialized')
```

**注意:** jaeger batch UDP processor 注意调整 sysctl net.inet.udp.maxdgram

```bash
sudo sysctl net.inet.udp.maxdgram=65536
```

### 5.1 Sampler 配置

生产环境请求量很大, 而且很多时候没必要所有请求都配置追踪, 可以通过 sampler 配置采样比率.

官方文档 [opentelemetry-core#built-in-sampler](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-core#built-in-sampler).

`OTEL_TRACES_SAMPLER` 和 `OTEL_TRACES_SAMPLER_ARG` 环境变量可以直接控制内置采样器, 也可以实现自己的采样器

## 6. 个人感受

OpenTelemetry Tracing 方面能够做到无侵入使用体验非常好, 但是 Metrics 方面就没必要使用了, 首先 Prometheus 生态已经非常成熟而且使用扩展起来很简单, 其次 OpenTelemetry Metrics 自己定义了一套指标类型然后通过适配器转化成 Prometheus metrics 个人感觉没什么必要.
