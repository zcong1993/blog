---
title: 使用 dbmate 管理数据库 migration
date: 2021-06-15T19:07:31+08:00
cover: /use-dbmate-manage-db-migration.jpeg
description: 使用 dbmate 管理数据库 migration
categories:
  - DB
tags:
  - DB
draft: false
---

使用版本管理工具管理 db schema 迁移历史是很重要的, 市面上好多 orm 框架会自带相应的工具, 但是基本都是耦合了框架, 例如必须使用相应语言代码编写 migration 脚本, 这样入侵性太强了, 后续更换语言或者框架会非常不方便. 本文介绍的 [dbmate](https://github.com/amacneil/dbmate) 是一个 go 语言编写的和任何框架无关的轻量级命令行工具.

## 特色

- 支持多种数据库 MySQL, PostgreSQL, SQLite, and ClickHouse
- go 语言编写, 轻量级命令行工具, 可以用于任何语言
- 使用普通 sql 管理 migration, 无任何框架依赖

## 核心命令

### dbmate dump

将数据库 dump 下来, 方便提交 git, 使用版本管理 diff 表结构变更. 会保存在 `./db/schema.sql`.

**注意:** 此命令依赖 `pg_dump`, `mysqldump`, `sqlite3` 根据你使用的数据库. mysql 如果报错 `Unknown table 'COLUMN_STATISTICS' in information_schema (1109)` 增加配置文件 `~/.my.cnf`

```cnf
[mysqldump]
column-statistics=0
```

### dbmate new

创建新的迁移文件

```bash
dbmate new fix_show_date
# Creating migration: db/migrations/20210615084412_create_users_table.sql
```

会创建一个带有时间的文件防止冲突.

文件内容:

```sql
-- migrate:up
create table users (
   id SERIAL PRIMARY KEY,
   name VARCHAR(255),
   email VARCHAR(100) NOT NULL
);

-- migrate:down
drop table users;
```

很容易理解, `migrate:up` 就是执行 migrate 时候运行的 sql, `migrate:down` 就是 rollback 执行的 sql.

### dbmate migrate, up

运行所有 pending 的 migrations

```bash
dbmate up

# Applying: 20210615092831_fix_show_date.sql
# Writing: ./db/schema.sql
```

默认执行完会将最新的 schema dump 下来, 相当于帮我们执行一次 `dbmate dump`, 由于 dump 依赖 数据库 client 软件, 而且一般我们也不会在应用容器中运行此命令, 所以可以通过参数 `--no-dump-schema` 或者环境变量 `DBMATE_NO_DUMP_SCHEMA` 跳过.

`dbmate up` 命令相当于 `dbmate create` + `dbmate migrate` 一般直接用 up.

**注意:** 一般 migrate 还是建议手动运行, k8s 集群可以使用 Job 的方式运行. 测试环境先 migrate, 并且保存 schema 更新, 所以生产 migrate 也不需要再更新 schema 文件.

### dbmate rollback

回滚一个版本, 不用解释

### dbmate status

检查所有 migrations 执行状态

```bash
dbmate status --exit-code

# [X] 20210615084412_create_users_table.sql
# [ ] 20210615085005_create_books_table.sql

# Applied: 1
# Pending: 1

echo $?

# 1
```

`--exit-code` 参数作用为如果有 pending 的 migration 直接 exit 1.

可以放在我们应用程序启动前检查 migration 是否已执行, 防止应用和数据库 schema 版本不一致.

## 总结

结合 dbmate, 我们整个开发流程大致如下:

1. 测试环境, dbmate new 创建需要的 migrations
2. 测试环境, dbmate up 执行变更, 并且更新最新数据库 schema.sql
3. 根据开发需求重复 1-2
4. 生产发布前, review migrations 变更以及 schema.sql 变更
5. 生产环境, 手动执行 dbmate up 执行变更
6. 生产环境, 上线服务代码, dbmate status 检查通过, 服务启动
