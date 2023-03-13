---
title: gRPC 扩展类型的使用
date: 2021-12-28T14:24:16+08:00
cover: /grpc-advance-types.jpeg
description: 本文主要介绍一些多语言广泛支持的 protobuf 扩展类型.
categories:
  - gRPC
  - RPC
  - Golang
  - NodeJS
tags:
  - gRPC
  - RPC
  - Golang
  - NodeJS
keywords:
  - gRPC
  - RPC
  - protobuf
  - types
draft: false
js:
  - js/prism-protobuf.min.js
---

gRPC 使用 protobuf 格式对消息进行编码, 基本类型都会映射到各种语言的类型. 为了丰富表达能力, 官方基于基本类型封装了一些类型, 例如: `Timestamp`, `Duration`, `Any`, `Struct`.

<!--more-->

## Timestamp

Timestamp 类型是对时间戳的扩展, 因为字符串时间标准非常多而且不同语言差异很大, 此扩展格式兼顾了精度.

```protobuf
message Timestamp {
  // Represents seconds of UTC time since Unix epoch
  // 1970-01-01T00:00:00Z. Must be from 0001-01-01T00:00:00Z to
  // 9999-12-31T23:59:59Z inclusive.
  int64 seconds = 1;

  // Non-negative fractions of a second at nanosecond resolution. Negative
  // second values with fractions must still have non-negative nanos values
  // that count forward in time. Must be from 0 to 999,999,999
  // inclusive.
  int32 nanos = 2;
}
```

为了方便使用, 各语言基本都会有 `Timestamp` 和 `Date(Time)` 类型互相转换的函数.

```go
// Golang

// golang Time -> Timestamp
timestamp := timestamppb.New(time.Now())
// Timestamp -> golang Time
goTime := timestamp.AsTime()
```

```ts
// JavaScript

// js Date -> Timestamp
const ts = new Timestamp()
ts.fromDate(new Date())
// Timestamp -> js Date
const date = ts.toDate()
```

源码方面也是非常简单, 基本都是处理精度转换, Golang 时间戳精度有 nanosecond 所以不需要转换, JavaScript 的时间戳为 13 位也就是精度是 Millisecond.

```js
proto.google.protobuf.Timestamp.prototype.toDate = function () {
  var seconds = this.getSeconds()
  var nanos = this.getNanos()
  // 将 seconds nanos 分别转成 ms 相加就是 js 时间戳
  return new Date(seconds * 1000 + nanos / 1000000)
}

/**
 * Sets the value of this Timestamp object to be the given Date.
 * @param {!Date} value The value to set.
 */
proto.google.protobuf.Timestamp.prototype.fromDate = function (value) {
  // 从 Date 得到时间戳, 转成 seconds 和 nanos
  this.setSeconds(Math.floor(value.getTime() / 1000))
  this.setNanos(value.getMilliseconds() * 1000000)
}
```

## Duration

Duration 类型很多语言并没有对应的格式, 不同语言时间精度也是不一样的, 所以此扩展也兼顾了精度.

```protobuf
message Duration {
  // Signed seconds of the span of time. Must be from -315,576,000,000
  // to +315,576,000,000 inclusive. Note: these bounds are computed from:
  // 60 sec/min * 60 min/hr * 24 hr/day * 365.25 days/year * 10000 years
  int64 seconds = 1;

  // Signed fractions of a second at nanosecond resolution of the span
  // of time. Durations less than one second are represented with a 0
  // `seconds` field and a positive or negative `nanos` field. For durations
  // of one second or more, a non-zero value for the `nanos` field must be
  // of the same sign as the `seconds` field. Must be from -999,999,999
  // to +999,999,999 inclusive.
  int32 nanos = 2;
}
```

格式和 Timestamp 完全相同, 只是表示的含义不同. 本质其实是提供了最高精度为 nanosecond 的持续时间 `duration = seconds * 1e9 + nanos` .

对于 Golang 这种自带 Duration 类型的语言, 提供了互转 API, 并会检查是否溢出:

```go
func New(d time.Duration) *Duration {
  nanos := d.Nanoseconds()
  secs := nanos / 1e9
  nanos -= secs * 1e9
  return &Duration{Seconds: int64(secs), Nanos: int32(nanos)}
}

// AsDuration converts x to a time.Duration,
// returning the closest duration value in the event of overflow.
func (x *Duration) AsDuration() time.Duration {
  secs := x.GetSeconds()
  nanos := x.GetNanos()
  d := time.Duration(secs) * time.Second
  overflow := d/time.Second != time.Duration(secs)
  d += time.Duration(nanos) * time.Nanosecond
  overflow = overflow || (secs < 0 && nanos < 0 && d > 0)
  overflow = overflow || (secs > 0 && nanos > 0 && d < 0)
  if overflow {
    switch {
    case secs < 0:
      return time.Duration(math.MinInt64)
    case secs > 0:
      return time.Duration(math.MaxInt64)
    }
  }
  return d
}
```

而对于 JavaScript 这种没有对应类型的语言则没有任何转换方法, 需要开发者手动处理.

## Any

Any 类型允许我们使用此字段传递任何 `Protocol Buffer` 类型的消息, 类似于某些编程语言中的泛型.

```protobuf
message Any {
  string type_url = 1;

  // Must be a valid serialized protocol buffer of the above specified type.
  bytes value = 2;
}
```

只有两个字段, `value` 字段为消息通过 protobuf 序列化成 binary 之后的值, 而 `type_url` 则是该类型的 `唯一标识符`.

proto 文件定义的每种类型和方法都会有一个全局唯一标识符, 类型一般为 `<package>.<type>` 而 rpc 方法一般为 `<package>.<service>/<method>`. 后者查看 grpc client 生成文件可以看出 client 方法都是通过 `c.cc.Invoke(ctx, "/pb.Hello/Echo", in, out, opts...)` 这种形式执行调用逻辑的, 外层仅仅是生成了类型. 生成类型都会被保存在运行时的全局变量中, 运行时可以通过标识符或者 url 来查找, Golang 默认为 `protoregistry.GlobalTypes`.

之所以有 `type_url` 这个字段, 是因为一般来说 protobuf 消息序列化反序列化都需要类型定义, 因此有了类型标识符, 接收方就知道该反序列化成哪种类型的消息了. 这个字段最终还需要加上 `type.googleapis.com/` 前缀.

Golang 生成消息类型可以使用反射获取到标识符:

```go
req := &pb.EchoRequest{}
fullName := req.ProtoReflect().Descriptor().FullName() // pb.EchoRequest
```

Golang Any 类型提供了几个常用的方法:

```go
req := &pb.EchoRequest{}
// 将 EchoRequest 转成 Any 类型
// type_url 可以根据反射拿到
any, err := anypb.New(req)
// 检查 any 底层消息是不是 EchoRequest 类型
// 通过 type_url 拿到 fullName 检查等于反射得到的目标 EchoRequest fullName
any.MessageIs(&pb.EchoRequest{}) // true
// 将 any 消息转回 EchoRequest 类型
var req2 pb.EchoRequest
any.UnmarshalTo(&req2)
// 将 any 消息转回动态类型
// 通过 type_url 拿到 fullName, 从全局类型中查找出对应类型, 反序列化
dy, err := any.UnmarshalNew()
_, ok := dy.(*pb.EchoRequest) // true
```

以 `UnmarshalNew` 来举例(`any.UnmarshalNew` 就是单纯调用的 UnmarshalNew):

```go
func UnmarshalNew(src *Any, opts proto.UnmarshalOptions) (dst proto.Message, err error) {
  if src.GetTypeUrl() == "" {
    return nil, protoimpl.X.NewError("invalid empty type URL")
  }
  // 这里 resolver 负责从 type url 拿到消息类型
  // 如果没指定类型 resolver 就使用全局的
  if opts.Resolver == nil {
    opts.Resolver = protoregistry.GlobalTypes
  }
  r, ok := opts.Resolver.(protoregistry.MessageTypeResolver)
  if !ok {
    return nil, protoregistry.NotFound
  }
  // 拿到消息类型
  mt, err := r.FindMessageByURL(src.GetTypeUrl())
  if err != nil {
    if err == protoregistry.NotFound {
      return nil, err
    }
    return nil, protoimpl.X.NewError("could not resolve %q: %v", src.GetTypeUrl(), err)
  }
  // 根据类型初始化接收者, 并反序列化消息
  // 后续我们可以使用 dst.(*Type) 来使用
  dst = mt.New().Interface()
  return dst, opts.Unmarshal(src.GetValue(), dst)
}
```

对于 JavaScript 这种动态语言来说, 使用起来就非常麻烦了, Any 类型仅提供了非常抽象的两个方法:

```ts
interface Any {
  pack(serialized: Uint8Array, name: string, typeUrlPrefix?: string): void
  unpack<T extends jspb.Message>(
    deserialize: (packed: Uint8Array) => T,
    name: string
  ): T | null
}
```

对于不熟悉 grpc 的用户来说根本不知道这两个函数该传什么参数进去, 这里必须要再次吐槽下, js grpc 社区基本没有文档, 很多时候我都是对比 golang 的表现去找源码, 但是很多时候你会发现很多 golang 实现了的它又是缺失的.

`pack` 方法基本等于直接调用 `setTypeUrl` 和 `setValue` 两个方法. 更不可思议的是, js protobuf 没有像 Golang 运行时获取消息 `fullName` 的 API. `unpack` 需要我们指定目标消息的反序列化函数, 也就是目标消息类型的 `deserializeBinary` 方法, 并且会在反序列化前比较传入的 name 和 any 消息的 type_url.

所以对于上面 go 语言的例子, 我们只能这么做:

```ts
const req = new EchoRequest()
// 将 EchoRequest 转成 Any 类型
const any = new Any()
any.pack(sub.serializeBinary(), 'pb.EchoRequest')

// 将 any 消息转回 EchoRequest 类型
const req2 = any.unpack(EchoRequest.deserializeBinary, 'pb.EchoRequest')
```

可以看到 API 非常底层, 但是之前提到过消息类型会被保存在运行时的全局变量中, js protobuf 保存的地方就是 `global.proto`, 所以我们可以通过 `global.proto.pb.EchoRequest` 拿到 `EchoRequest` 的反序列化方法, 进而可以构造出一个类似于 Golang 的 `UnmarshalNew` 的动态反序列化方法:

```ts
const unpackAny = <T extends Message>(any: Any) => {
  // 通过 type_url 获取 fullName
  const fullName = any.getTypeName()
  // 从 global.proto 上面拿到消息类型
  const mt = _.get(global.proto, fullName)
  if (!mt) {
    throw new Error(`unregister message type ${fullName}`)
  }
  // 反序列化消息
  return any.unpack<T>(mt.deserializeBinary, fullName)
}

const req2 = unpackAny<EchoRequest>(any)
```

## Struct

Struct 类型基本就是一个最外层不能是数组的动态 JSON 类型, 序列化反序列化都是通过运行时反射得到的字段类型来处理.

```protobuf
message Struct {
  // Unordered map of dynamically typed values.
  map<string, Value> fields = 1;
}

// JSON 数据类型
message Value {
  // The kind of value.
  oneof kind {
    // Represents a null value.
    NullValue null_value = 1;
    // Represents a double value.
    double number_value = 2;
    // Represents a string value.
    string string_value = 3;
    // Represents a boolean value.
    bool bool_value = 4;
    // Represents a structured value.
    Struct struct_value = 5;
    // Represents a repeated `Value`.
    ListValue list_value = 6;
  }
}

// JSON null
enum NullValue {
  // Null value.
  NULL_VALUE = 0;
}

// JSON 数组
message ListValue {
  repeated Value values = 1;
}
```

Golang 提供了 `Struct` 到 `map[string]interface{}` 的互转 API:

```go
dd := map[string]interface{}{
  "name": "zcong",
  "age": 18,
  "arr": []interface{}{1, 2, 3, "xxx"},
}
// 转成 Struct 类型
st, err := structpb.NewStruct(dd)
if err != nil {
  panic(err)
}
// Struct 类型转成 map[string]interface{}
mp := st.AsMap()
```

源码方面也是和解析 JSON 几乎一样, 都是通过获取每个字段的值类型, 设置成对应的 protobuf 类型:

```go
func NewValue(v interface{}) (*Value, error) {
  switch v := v.(type) {
  case nil:
    return NewNullValue(), nil
  case bool:
    return NewBoolValue(v), nil
  case int:
    return NewNumberValue(float64(v)), nil
  case int32:
    return NewNumberValue(float64(v)), nil
  case int64:
    return NewNumberValue(float64(v)), nil
  case uint:
    return NewNumberValue(float64(v)), nil
  case uint32:
    return NewNumberValue(float64(v)), nil
  case uint64:
    return NewNumberValue(float64(v)), nil
  case float32:
    return NewNumberValue(float64(v)), nil
  case float64:
    return NewNumberValue(float64(v)), nil
  case string:
    if !utf8.ValidString(v) {
      return nil, protoimpl.X.NewError("invalid UTF-8 in string: %q", v)
    }
    return NewStringValue(v), nil
  case []byte:
    s := base64.StdEncoding.EncodeToString(v)
    return NewStringValue(s), nil
  case map[string]interface{}:
    v2, err := NewStruct(v)
    if err != nil {
      return nil, err
    }
    return NewStructValue(v2), nil
  case []interface{}:
    v2, err := NewList(v)
    if err != nil {
      return nil, err
    }
    return NewListValue(v2), nil
  default:
    return nil, protoimpl.X.NewError("invalid type: %T", v)
  }
}
```

而 JavaScript 这边也是提供了两个互转 API `fromJavaScript` 和 `toJavaScript`.

总的来说这种方式和使用 `bytes` 格式传递手动 JSON 序列化的消息, 接收方收到后手动 JSON 反序列化差不多.

## 总结

上面介绍的这几种类型应该都是 Google 从自己生产需求中总结出来的并且被多种语言广泛使用的类型, 也为我们自己扩展通用消息类型做了示范. 可以看到这种多语言类型扩展做到贴合各自语言特性并且 API 设计人性化还是非常难的, 上文中 `Any` 类型对于 js 用户体验就很不好.

## 参考资料

- [protocolbuffers/protobuf/google/protobuf](https://github.com/protocolbuffers/protobuf/blob/master/src/google/protobuf)
- [protocolbuffers/protobuf-go/types/known](https://github.com/protocolbuffers/protobuf-go/tree/master/types/known)

![wxmp](/wxmp_tiny_1.png)
