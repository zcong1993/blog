---
title: 'Influx + Grafana 监控应用'
date: 2018-07-02T18:05:22+08:00
draft: false
categories: ['监控']
tags: ['Influx DB', 'Grafana', '监控']
---

监控是服务必不可少的一项功能. 当然早已不满足于单纯 health 的监控. 最近尝试了 `Influx DB + Grafana` 做监控和显示服务.

<!--more-->

## 为什么选择 Influx DB 和 Grafana ?

监控一般只关注实时或者近期数据, 所以 `Influx DB` 这种时序数据库效率会很高, 所以我们选择它.

监控还可以使用 `Prometheus`, 但是它是主动拉数据的, 所以需要我们配置一个路由, 对于 rest 服务非常简单好用, 但是 ws 服务往往就没那么好做, 因此我们选择 influxdb.

而且 influxdb 自带了 http 和 udp 接口, 使用起来非常方便.

Grafana 则把重心放在了数据显示方面, 集成了好多数据库, 基本开箱即用.

## 启动服务

我们使用 docker 来启动两个服务:

### 1. influx db

```bash
$ docker run --name influxdb -d -v `pwd`/influxdb.conf:/etc/influxdb/influxdb.conf:ro -p 8086:8086 -p 8089:8089 influxdb
# 建立数据库, 后面使用
$ docker exec -it influxdb bash
# in docker
$ influx
$ create database app_metrics;
```

### 2. Grafana

```bash
$ docker run --name grafana -d -p 9300:3000 grafana/grafana
```

## 监控 reporter 实现

数据库和显示服务搭好了, 接着就等我们的服务上报自己的状态了, 基本思路就是我们定时更新服务的一些指标并插入到数据库.

用 [@zcong/metrics-influxdb](https://github.com/zcong1993/node-metrics-influxdb) 这个库来实现一个简单的 demo:

```js
const InfluxMetrics = require('@zcong/metrics-influxdb')

const options = {
  host: 'localhost',
  port: 8086,
  protocol: 'http',
  database: 'app_metrics',
  tags: {
    app: 'my-app',
    environment: 'test',
  },
  callback(error) {
    if (error) {
      console.log('Sending data to InfluxDB failed: ', error)
    }
  },
}

const reporter = new InfluxMetrics.Reporter(options)

let i = 10

const g = new InfluxMetrics.Gauge()
reporter.addMetric('test.gauge', g)

// 每 5s 更新一次状态
setInterval(() => g.set(Math.random() > 0.5 ? i++ : i--), 5000)

// 每 5s 向数据库插入一条记录
reporter.start(5000)
```

运行一段时间脚本然后进入 influx db 中查看数据:

```bash
$ docker exec -it influxdb bash
$ influx
$ use app_metrics
$ SELECT * FROM "test.gauge"
```

可以看到:

![influx1](/influx-1.png)

## Grafana 接入数据

按照提示设置好密码, 然后配置我们自己的 datasource, 数据库选好, 然后新建一个 dashboard, add 一个 Graph panel, 点击 Metrics 配置 query:

如下设置 query 语句:

![influx2](/influx-2.png)

此时就能看到如下效果:

![influx3](/influx-3.png)

## 总结

这样就做好了一个最简单的监控, influxdb 和 grafana 的高级用法建议查看官方文档. 后续分享一下多服务, 或者单服务多容器怎么实现监控汇总.
