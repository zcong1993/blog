---
title: '一个可以根据 mongoose schema 生成 model 类型的工具'
date: 2020-06-17T15:12:21+08:00
categories:
  - NodeJS
  - MongoDB
  - Typescript
tags:
  - NodeJS
  - MongoDB
  - Typescript
draft: false
description: 如何解放双手根据 mongoose schema 类型生成 Typescript 类型.
---

MongoDB 在 NodeJS 社区有着非常广泛的使用. 虽然灵活是 MongoDB 的一大优势, 但是真正业务中不希望它 '过于灵活', 因此一般都会搭配 mongoose 来使用, 所以基本也会定义 `Schema`.

由于 mongoose 出现很早, 它是以 Object 的形式来定义 Schema. 但是随着 Typescript 的流行, ts 和 mongoose 结合使用时, 定义 Model 类型时不能直接使用 Schema 类型, 所以我们一般都要根据对应的 Schema 类型再写一个类型: `type UserModel = mongoose.Model<UserType>`.

综上, 我决定写一个自动化工具来解放双手, 减少人工失误.

<!--more-->

## 工具使用介绍

```ts
import { ModelGenerator } from '@zcong/ts-mongoose-code-generator'

const testSchema = new Schema({
  name: String,
  age: {
    type: Number
  },
  requiredName: {
    type: String,
    required: true
  }
}

const dtoGen = new ModelGenerator({
  filename: `${__dirname}/modelGen.ts`,
  useInterface: true, // 使用 interface 或者 class 类型
  arrayStyle: 'squareBrackets', // 数组生成格式 squareBrackets(T[]) or generic(Array<T>)
  // 是否优化 enum, if set true, String type with enum field
  // ['test1', 'test2'] will be type `'test1' | 'test2'`
  stringEnumUseUnionType: true,
})
dtoGen.generateModelBySchema(testSchema, 'Test')
dtoGen.getFile().saveSync() // save generated code as file
dtoGen.getGeneratedCode() // get generated code content

// export interface TestModel {
//   name?: string;
//   age?: number;
//   requiredName: string;
// }
```

## 原理

因为 mongoose Schema 已经是结构化的了, 所以这件事情基本分为两步, 将 Schema 转化成方便处理的类型和生成最终代码.

### parser

首先想想我们需要的字段信息:

- type
- required
- enum
- isArray
- ref

```ts
Schema {
  paths: {
    name: SchemaString {
      enumValues: [],
      path: 'name',
      instance: 'String',
      options: {
        required: true,
        unique: true
      },
      isRequired: true
    }
  }
}
```

对于基本类型('ObjectID', 'String', 'Number', 'Date', 'Boolean', 'Mixed', 'Buffer', 'Map', 'Decimal128'), 上面的这些包含了我们想要的信息.

接着要处理数组类型, 嵌套类型, 嵌套 Schema 这几种情况.

#### 对于数组类型

```ts
SchemaArray {
  caster: SchemaString {
    enumValues: [],
    path: 'arr',
    instance: 'String',
  },
  '$isMongooseArray': true,
  path: 'arr',
  instance: 'Array',
}
```

可以看出 instance 类型是 `Array`, `caster` 字段就是数组元素的类型信息, 递归处理.

#### 对于嵌套 Schema

```ts
SingleNestedPath {
  schema: Schema {
    paths: {
      // ...
    },
  },
  '$isSingleNested': true,
  path: 'nested',
  instance: 'Embedded'
}
```

可以看出 instance 类型是 `Embedded`, `schema` 字段是子文档的类型信息, 递归处理.

#### (直接)嵌套类型

```ts
new Schema({
  nested2: {
    name: String,
    age: Number
  },
})

{
  'nested2.name': SchemaString {
    enumValues: [],
    path: 'nested2.name',
    instance: 'String',
    options: {},
  },
  'nested2.age': SchemaNumber {
    path: 'nested2.age',
    instance: 'Number',
    options: {},
  }
}
```

此种类型 Schema 处理的比较诡异, 结构被扁平化处理了, 所以我们需要先把它结构恢复回去, 并标记成 `Embedded` 类型.

于是我们就可以把每一个字段处理成下面这个结构:

```ts
export interface PropertyType {
  type: string
  isArray?: boolean
  enumValues?: any[]
  $__schemaType?: any
  rawOpts?: any
}

export interface ParsedField {
  type: PropertyType
  options?: { required?: boolean; ref?: string }
  schema?: ParsedType
}

export interface ParsedType {
  [key: string]: ParsedField
}
```

_注_ 相关处理代码可在 [zcong1993/mongoose-schema-parser](https://github.com/zcong1993/mongoose-schema-parser/blob/master/src/parser.ts) 查看.

### 生成代码

有了结构化的数据, 把他们转化成 TS 代码并不难. 但是如果直接使用字符串拼接, 不太具有结构化, 而且缩进处理起来不是很舒服, 代码看起来也不清晰. 所以我们选择 [ts-morph](https://github.com/dsherret/ts-morph) 这个库来生成代码.

简单介绍下它的使用:

```ts
const project = new Project({
  manipulationSettings: {
    indentationText: IndentationText.TwoSpaces,
    quoteKind: QuoteKind.Single,
  },
})
const file = project.createSourceFile(opts.filename || 'tmp.ts', '', {
  overwrite: true,
})

// add interface
const inter = file.addInterface({
  name: 'Test',
  isExported: true,
})

// add property
inter.addProperty({
  hasQuestionToken: true,
  name: 'name',
  type: 'string',
})

console.log(file.getFullText())
// Output:
// interface Test {
//   name?: string
// }
```

可以看到代码非常清晰, 而且缩进之类的也会处理得当.

言归正传, 需要我们做的其实是两点:

- 基本类型处理成 ts 类型或者 mongoose 提供的类型
- 复杂类型递归生成子类型结构

基本类型对应 ts 类型可参考下面表格:

| MongoDB    | TS                        |
| ---------- | ------------------------- |
| Boolean    | boolean                   |
| String     | string                    |
| Number     | number                    |
| Date       | Date                      |
| ObjectID   | mongoose.Types.ObjectID   |
| Mixed      | any                       |
| Buffer     | Buffer                    |
| Map        | any                       |
| Decimal128 | mongoose.Types.Decimal128 |

_注_ 对于 enum 类型, 可优化为 enum 字面量的联合类型, 例如: type: 'A' | 'B'

遇到 `Schema` 和 `Embedded` 类型时, 递归处理生成子类型就好了.

_注_ 相关处理代码可在 [ts-mongoose-code-generator](https://github.com/zcong1993/ts-mongoose-code-generator/blob/master/src/modelGenerator.ts) 查看.

## 后记

我一直认为如果更改一个字段声名需要改动两个地方以上, 就很容易出现不一致的情况, 因为人在做重复劳动时总是会犯错, 所以我们需要一些工具来做一些有固定模式化的事情.

但是我觉得 ORM 的未来肯定是基于 `注解式` 声名, 这样就能统一 Schema 结构和 Model 类型, 就像 [typeorm](https://github.com/typeorm/typeorm) 那样.
