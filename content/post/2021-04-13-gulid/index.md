---
title: 分布式全局唯一 ID 生成
date: 2021-04-13T19:03:05+08:00
cover: /san-francisco.jpeg
description: 各种业务账号订单 ID, 保证幂等的消息 ID 等均需要全局唯一, 那么如何设计一个分布式 ID 生成器(Distributed ID Generator)，并保证 ID 按时间粗略有序?
categories:
  - SystemDesign
tags:
  - SystemDesign
  - ulid
draft: false
---

如何设计一个分布式 ID 生成器(Distributed ID Generator)，并保证 ID 按时间粗略有序?

## 应用场景

各种业务账号订单 ID, 保证幂等的消息 ID 等均需要全局唯一

## 需求

- 全局唯一(unique)
- 按照时间粗略有序(sortable by time)
- 尽可能短
- 部署简单轻量

## 方案评估

### MongoDB ObjectID

#### 优点

1. 多个实例生成 ID 没有依赖关系, 天然分布式高可用
2. 高位为时间戳, 本身有序

#### 缺点

1. 太长, 12 字节(96 位)

### Snowflake

#### 优点

1. 64 位, 比较短
2. 高位为时间戳, 本身有序
3. 分布式高可用

#### 缺点

1. 需要额外部署 ZooKeeper 和 Snowflake 服务

### DB Ticket Servers

例如 [Flickr](https://code.flickr.net/2010/02/08/ticket-servers-distributed-unique-primary-keys-on-the-cheap)

利用 mysql 集群

```sql
CREATE TABLE `Tickets64` (
  `id` bigint(20) unsigned NOT NULL auto_increment,
  `stub` char(1) NOT NULL default '',
  PRIMARY KEY  (`id`),
  UNIQUE KEY `stub` (`stub`)
) ENGINE=InnoDB

# replace into 表里只会有一条记录
REPLACE INTO Tickets64 (stub) VALUES ('a');
SELECT LAST_INSERT_ID();
```

不同的 mysql 服务使用不同步长

```conf
TicketServer1:
auto-increment-increment = 2
auto-increment-offset = 1

TicketServer2:
auto-increment-increment = 2
auto-increment-offset = 2
```

#### 优点

1. 部署简单, 扩展扩容方便

#### 缺点

1. 需要部署管理多台服务器, 单台服务器会变成系统单点
2. 多实例生成 ID 并不是严格递增

### Instagram pg

> 和 snowflake 原理相似, 但是只依赖 pg 比较简单

[https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c](https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c)

选择一个开始时间作为 epoch 开始

ID 组成 `[41][13][10]`

- 高 41 位为当前时间 - epoch 开始 毫秒数
- 中间 13 位为分片 ID
- 低 10 位为递增 ID % 1024

使用 pg 实现:

```sql
CREATE SCHEMA test1;

# 创建自增 id
CREATE SEQUENCE test1.table_id_seq;

# 创建函数, 开始时间选 2021-01-01 00:00:00
CREATE OR REPLACE FUNCTION test1.next_id(OUT result bigint) AS $$
DECLARE
    our_epoch bigint := 1609430400000;
    seq_id bigint;
    now_millis bigint;
    shard_id int := 1;
BEGIN
    SELECT nextval('test1.table_id_seq') % 1024 INTO seq_id;
    SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000) INTO now_millis;
    result := (now_millis - our_epoch) << 23;
    result := result | (shard_id <<10);
    result := result | (seq_id);
END;
    $$ LANGUAGE PLPGSQL;

# 创建表
CREATE TABLE test1.test_table (
  "id" bigint NOT NULL DEFAULT test1.next_id()
);
```

测试:

```sql
insert into test1.test_table (id) VALUES (DEFAULT);
insert into test1.test_table (id) VALUES (DEFAULT);
insert into test1.test_table (id) VALUES (DEFAULT);

select * from test1.test_table;

        id
-------------------
 70817154986935305
 70817228647302154
 70817232925492235
(3 rows)
```

原理使用 go 语言简单实现:

```go
var nextSeq int64 = 1

func genID(shardId int64, epochStart time.Time) int {
	diffMs := time.Now().Sub(epochStart).Milliseconds()
	res := diffMs << 23
	res |= shardId << 10
	res |= nextSeq

	nextSeq++

	return int(res)
}
```

#### 优点

1. 部署简单, 扩容方便, 初期可在同一 pg 里面使用多个 schema
2. 使用时间戳 - 初始时间作为高位, 比直接用时间戳能够使用更多时长

## 参考资料

- [https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c](https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c)
- [https://code.flickr.net/2010/02/08/ticket-servers-distributed-unique-primary-keys-on-the-cheap](https://code.flickr.net/2010/02/08/ticket-servers-distributed-unique-primary-keys-on-the-cheap)
- [https://soulmachine.gitbooks.io/system-design/content/cn/distributed-id-generator.html](https://soulmachine.gitbooks.io/system-design/content/cn/distributed-id-generator.html)
