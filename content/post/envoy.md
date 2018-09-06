---
title: "Envoy"
date: 2018-09-06T15:09:48+08:00
draft: false
categories: ["尝试", "服务", "负载均衡"]
---

负载均衡应用非常广泛, 实现方式也有多种, 有硬件层面上的, 也有软件层面的. 软件层面上的基本大家都很熟悉 `nginx`. 与 docker 配合得很好得有 `traefik`, k8s 好多组件选择了 `envoy`, 今天尝试了一下.

<!-- more -->

### echo 小服务

我之前写了个很小的供测试的 `echo` 服务, 有 3 个路由, `get` 请求返回 `headers`, `post` 请求返回发送的 `json body`, `ws` 连接返回客户端发送的消息.

```sh
$ docker run --rm -p 8080:8080 zcong/echo
$ export BASE=localhost:8080
# get
$ curl $BASE
# post
$ curl -X POST $BASE/echo -H 'Content-Type: application/json' -d '{"name": "zcong"}'
# ws 可使用 chrome 插件测试
```

### 1. 简单负载均衡

配置如下:
```yaml
<!-- simple-proxy.yaml -->
version: '2'

services:
  proxy:
    image: envoyproxy/envoy:latest
    volumes:
      - ./simple-proxy.yaml:/etc/front-envoy.yaml
    networks:
      - envoymesh2
    expose:
      - "8001"
      - "9000"
    ports:
      - "9000:80"
      - "8001:8001"
    command: /usr/local/bin/envoy -c /etc/front-envoy.yaml --service-cluster front-proxy

  service1:
    image: zcong/echo
    networks:
      envoymesh2:
        aliases:
          - service1
    command: echo
    expose:
      - "8080"

  service2:
    image: zcong/echo
    networks:
      envoymesh2:
        aliases:
          - service2
    command: echo
    expose:
      - "8080"

networks:
  envoymesh2: {}
```

此配置作用是, 将 `0.0.0.0:80` 进来的请求所有路由路由到我们的两台 echo 服务上面. 负载策略是 `round_robin`.

测试一下:

```sh
$ docker-compose up
$ export BASE=localhost:9000
# get
$ curl $BASE
# post
$ curl -X POST $BASE/echo -H 'Content-Type: application/json' -d '{"name": "zcong"}'
```

上面的服务是简单的 `http1.1 -> http1.1` 的代理, 但是我们的路由 `/ws` 是 websocket 协议, 所以我们应该更改配置:
```yaml
...
routes:
- match:
    prefix: "/ws"
  route:
    cluster: myservice
    use_websocket: true # 对于路由 '/ws' 启用 ws
- match:
    prefix: "/"
  route:
    cluster: myservice
...
```

### 2. 服务网格

对于微服务, 我们需要监控和追踪服务之间请求调用, 以及请求整个生命周期经过了哪些服务, 所以 envoy 经常会在每一个服务上面部署作为 `sidecar`, 代理流入的流量, 这么做还有一个好处是我们请求可以变为 `http1.1 -> http2 -> 服务之间... -> http2 -> http1.1` .

```Dockerfile
# Dockerfile-services
FROM zcong/echo as external
FROM envoyproxy/envoy-alpine:latest

COPY --from=external /usr/bin/echo /usr/bin/
ADD ./start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh
ENTRYPOINT /usr/local/bin/start.sh
```

```sh
# start.sh
#!/bin/sh

/usr/bin/echo &
envoy -c /etc/service-envoy.yaml --service-cluster service${SERVICE_NAME}
```

```yaml
<!-- service-envoy.yaml -->
static_resources:
  listeners:
  - address:
      socket_address:
        address: 0.0.0.0
        port_value: 80
    filter_chains:
    - filters:
      - name: envoy.http_connection_manager
        config:
          codec_type: auto
          stat_prefix: ingress_http
          route_config:
            name: local_route
            virtual_hosts:
            - name: backend
              domains:
              - "*"
              routes:
              - match:
                  prefix: "/ws"
                route:
                  cluster: myservice
                  use_websocket: true
              - match:
                  prefix: "/"
                route:
                  cluster: myservice
          http_filters:
          - name: envoy.router
            config: {}
  clusters:
  - name: myservice
    connect_timeout: 0.25s
    type: strict_dns
    lb_policy: round_robin
    http2_protocol_options: {}
    hosts:
    - socket_address:
        address: service1
        port_value: 80
    - socket_address:
        address: service2
        port_value: 80
admin:
  access_log_path: "/dev/null"
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 8001
```

```yaml
<!-- proxy-envoy.yaml -->
static_resources:
  listeners:
  - address:
      socket_address:
        address: 0.0.0.0
        port_value: 80
    filter_chains:
    - filters:
      - name: envoy.http_connection_manager
        config:
          codec_type: auto
          stat_prefix: ingress_http
          route_config:
            name: local_route
            virtual_hosts:
            - name: backend
              domains:
              - "*"
              routes:
              - match:
                  prefix: "/ws"
                route:
                  cluster: myservice
                  use_websocket: true
              - match:
                  prefix: "/"
                route:
                  cluster: myservice
          http_filters:
          - name: envoy.router
            config: {}
  clusters:
  - name: myservice
    connect_timeout: 0.25s
    type: strict_dns
    lb_policy: round_robin
    http2_protocol_options: {}
    hosts:
    - socket_address:
        address: service1
        port_value: 80
    - socket_address:
        address: service2
        port_value: 80
admin:
  access_log_path: "/dev/null"
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 8001
```

```yaml
<!-- docker-compose.yml -->
version: '2'

services:
  front-envoy:
    image: envoyproxy/envoy:latest
    volumes:
      - ./proxy-envoy.yaml:/etc/front-envoy.yaml
    networks:
      - envoymesh
    expose:
      - "8001"
      - "9000"
    ports:
      - "9000:80"
      - "8001:8001"
    command: /usr/local/bin/envoy -c /etc/front-envoy.yaml --service-cluster front-proxy

  service1:
    build:
      context: .
      dockerfile: Dockerfile-service
    volumes:
      - ./service-envoy.yaml:/etc/service-envoy.yaml
    networks:
      envoymesh:
        aliases:
          - service1
    environment:
      - SERVICE_NAME=1
    expose:
      - "80"

  service2:
    build:
      context: .
      dockerfile: Dockerfile-service
    volumes:
      - ./service-envoy.yaml:/etc/service-envoy.yaml
    networks:
      envoymesh:
        aliases:
          - service2
    environment:
      - SERVICE_NAME=2
    expose:
      - "80"

networks:
  envoymesh: {}
```

可以看到, 每个 echo 服务内都部署了一个 envoy 服务, 最外层服务首先将流量负载均衡到不同服务中的 envoy 服务, 然后此服务再将流量导入此机器上的相应服务. 各个 envoy 之间流量均被转化了 `http2`.

测试一下:

```sh
$ docker-compose up
$ export BASE=localhost:9000
# get
$ curl $BASE
# post
$ curl -X POST $BASE/echo -H 'Content-Type: application/json' -d '{"name": "zcong"}'
```

### 3. 总结

正如 envoy 的目标一样, 它定位为现代的负载均衡器, 有超级多的复杂功能或者插件扩展, 用来实现一系列的监控, 负载, 追踪, 服务发现, 服务网格. 复杂功能还有待探究, 等到后续真正有需求的时候进一步研究.