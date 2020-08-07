---
title: '使用 prometheus 监控应用'
date: 2020-07-03T14:02:19+08:00
categories:
  - Devops
  - 监控
tags:
  - Devops
  - 监控
draft: false
description: 生产环境的应用往往都需要 7x24 小时高强度服务用户, 上线之后如果想睡好觉, 就需要知晓应用运行的某些状态指标, 以此判断应用是否健康, 这也就是监控的意义之一. K8S 世界会有什么样的工具帮我们做好监控呢?
---

生产环境的应用往往都需要 7x24 小时高强度服务用户, 上线之后如果想睡好觉, 就需要知晓应用运行的某些状态指标, 以此判断应用是否健康, 这也就是监控的意义之一.

当然还可以有更高的追求, 例如: 接口 QPS, 接口的错误率, 接口的 90 分位响应时间等等, 这些可以帮助我们更好的了解应用的运行状态, 更好得确立优化方向.

于是接下来介绍一下开源监控组件 [prometheus](https://prometheus.io)

<!--more-->

本文假定您已经了解 prometheus 的基本概念.

## 指标类型

简单介绍下我们将要用到的指标.

### Counter

Counter 是一个单调的计数器, 只能增加或重置, 常用来统计请求数之类的指标.

### Histogram

Histogram 常用来追踪请求响应时间之类的值, 使用 `histogram_quantile()` 函数可以计算不同分位指标.

## 如何使用

### 应用端

应用端我们使用简单的 koa 应用举例, 并且使用 [prom-client](https://github.com/siimon/prom-client) 作为 prometheus client lib.

```ts
const Koa = require('koa')
const app = new Koa()

app.use(async (ctx) => {
  const r = Math.random() * 100
  await sleep(r)
  if (r > 90) {
    ctx.status = 400
  }
  ctx.body = r
})

app.listen(3000)
```

此应用会随机 0-100ms 的延迟, 并有 10% 的概率 http status = 400.

#### 统计请求数量

接着我们创建一个中间件, 来统计请求数量.

```ts
const { register, Counter } = require('prom-client')

// 建立一个 counter 统计指标
const counter = new Counter({
  name: 'http_requests_total',
  help: 'Counter for total requests received',
  labelNames: ['path', 'method', 'status'], // labels 为了统计分组, 可以区分不同维度的指标
})

// 监控指标中间件
app.use(async (ctx, next) => {
  // 路径 /metrics 为监控指标 route, 返回指标
  if (ctx.path === '/metrics') {
    ctx.set('Content-Type', register.contentType)
    ctx.body = register.metrics()
    return
  }

  // 其他路由均统计指标
  try {
    await next()
  } finally {
    const labels = {
      path: ctx.path,
      method: ctx.method,
      status: ctx.status,
    }
    counter.inc(labels, 1)
  }
})
```

_注:_ 为了演示方便, 直接使用 path 作为 label, 正常时候应该使用 matchRoute, 这样才能正确处理 path 中含有占位符的情况.

此时运行应用, 访问 [http://localhost:3000/metrics](http://localhost:3000/metrics) 可以看到没有任何指标, 当我们手动发送几条请求, 便可看到指标:

```marked
# HELP http_requests_total Counter for total requests received
# TYPE http_requests_total counter
http_requests_total{path="/",method="GET",status="200"} 5
http_requests_total{path="/",method="GET",status="400"} 2
```

请求次数与我们发送次数是匹配的.

#### 统计响应时间

响应时间也是同理, 只是指标类型不一样.

```ts
const hrtime2ms = (hrtime) => (hrtime[0] * 1e9 + hrtime[1]) / 1e6 // hrtime 转化成 ms

const histogram = new Histogram({
  name: `http_request_duration_ms`,
  help: 'Duration of HTTP requests in ms',
  labelNames: ['path', 'method', 'status'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000], // buckets 单位 ms
})

// 监控指标中间件
app.use(async (ctx, next) => {
  // 路径 /metrics 为监控指标 route, 返回指标
  if (ctx.path === '/metrics') {
    ctx.set('Content-Type', register.contentType)
    ctx.body = register.metrics()
    return
  }

  // 其他路由均统计指标
  const start = process.hrtime() // 开始时间
  try {
    await next()
  } finally {
    const dur = hrtime2ms(process.hrtime(start)) // 计算请求处理时间
    const labels = {
      path: ctx.path,
      method: ctx.method,
      status: ctx.status,
    }
    histogram.observe(labels, dur) // 统计响应时间
  }
})
```

选用更加精确的 `process.hrtime` 计算时间差.

手动发送请求便可得到相应指标:

```marked
# HELP http_request_duration_ms Duration of HTTP requests in ms
# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{le="5",path="/",method="GET",status="200"} 0
http_request_duration_ms_bucket{le="10",path="/",method="GET",status="200"} 0
http_request_duration_ms_bucket{le="25",path="/",method="GET",status="200"} 3
http_request_duration_ms_bucket{le="50",path="/",method="GET",status="200"} 6
http_request_duration_ms_bucket{le="100",path="/",method="GET",status="200"} 9
http_request_duration_ms_bucket{le="250",path="/",method="GET",status="200"} 9
http_request_duration_ms_bucket{le="500",path="/",method="GET",status="200"} 9
http_request_duration_ms_bucket{le="1000",path="/",method="GET",status="200"} 9
http_request_duration_ms_bucket{le="+Inf",path="/",method="GET",status="200"} 9
http_request_duration_ms_sum{path="/",method="GET",status="200"} 340.23
http_request_duration_ms_count{path="/",method="GET",status="200"} 9
```

上面指标含义是, 一共 9 个请求, 总耗时 340.23ms, 响应时间都小于 100ms, 有 6 条小于 50ms 并且 3 条小于 25ms.

### 服务端

可以 clone [zcong1993/prometheus-grafana](https://github.com/zcong1993/prometheus-grafana) 项目快速启动一个 prometheus 和 grafana docker 应用.

```bash
git clone https://github.com/zcong1993/prometheus-grafana.git
```

修改 prometheus.yml 配置

```yml
# my global config# my global config
global:
  scrape_interval: 5s # 每 5 秒抓取一次指标, 仅做测试, 生产环境不应这么频繁
  evaluation_interval: 15s # Evaluate rules every 15 seconds. The default is every 1 minute.
  # scrape_timeout is set to the global default (10s).

  # Attach these labels to any time series or alerts when communicating with
  # external systems (federation, remote storage, Alertmanager).
  external_labels:
    monitor: 'codelab-monitor'

# Load rules once and periodically evaluate them according to the global 'evaluation_interval'.
rule_files:
  # - "first.rules"
  # - "second.rules"

# A scrape configuration containing exactly one endpoint to scrape:
# Here it's Prometheus itself.
scrape_configs:
  # The job name is added as a label `job=<job_name>` to any timeseries scraped from this config.
  - job_name: 'prometheus'

    # metrics_path defaults to '/metrics'
    # scheme defaults to 'http'.

    static_configs:
      - targets: ['localhost:9090']
  # Add your own jobs here.
  - job_name: 'koa-app'
    static_configs:
      - targets: ['你的本机 IP:3000'] # 由于 prometheus 是从 docker 内访问本机, 所以不能使用 localhost
```

访问 [http://localhost:9090](http://localhost:9090) 查看 web 端.

## 常用查询语句

- 最近 2 分钟平均 QPS, 根据路由分组

```sql
sum(rate(http_requests_total{job=~"koa-app", path=~".*"}[2m])) by (path)
```

- 最近 1 分钟平均响应时间, 根据路由分组

```sql
avg(increase(http_request_duration_ms_sum{job=~"koa-app", path=~".*"}[1m]) / increase(http_request_duration_ms_count{job=~"koa-app", path=~".*"}[1m]) >0) by (path)
```

- 最近 1 分钟 90 分位响应时间, 根据路由分组

```sql
histogram_quantile(0.90, sum(irate(http_request_duration_ms_bucket{job=~"koa-app", path=~".*"}[1m])) by (path, le))
```

- 最近 5 分钟, 非 200 请求率, 根据路由分组

```sql
sum(irate(http_requests_total{status!~"200",job=~"koa-app", path=~".*"}[5m])) BY (job, path, status) / IGNORING(status) GROUP_LEFT() sum(irate(http_requests_total{job=~"koa-app", path=~".*"}[5m])) BY (job, path) * 100
```

## 总结

对于一个普通的应用, 简单的监控中间件思路就是上面的情况, 但是如果你的应用是 cluster 模式, 那么问题会复杂很多, prom-client 项目里面也有示例. 但是我觉得云平台, 容器技术火热的今天, 我们已经没必要使用 node cluster 了, 多启用几个 pod 会更好.

虽然我们可以用语句拿到上面的那些指标, 但是还是不够直观, 所以后面还会继续介绍如何配合 grafana 使用, 使得这些指标更直观.
