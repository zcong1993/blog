---
title: Dapr | State Store Encryption
date: 2022-01-11T18:05:39+08:00
cover: /dapr-state-store-encryption.png
description: 本文介绍 Dapr 新功能, State Store 加密.
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
---

之前源码系列文章讲到过, Dapr 可以对集群内部提供 `kv store` (键值存储) 的功能. 但是很多时候我们希望有更好的安全性, 因为存储功能总是需要外部软件提供, 所以 dapr 提供了键值存储自动加密的功能.

<!--more-->

**注意:** 这个功能目前还处于 `Preview feature` 阶段, 如果要使用需要在全局配置中开启这个特性. 本文源码对应 dapr `v1.5.1` 版本.

## 基本思路

dapr 选用 `AES-256-GCM` 对称加密算法进行数据加解密, 因为用户应用都是通过 dapr API 来读取, 新增或者修改数据, 所以 dapr 在写入/修改 handler 中增加加密逻辑, 在读取 handler 中增加解密逻辑就可以实现此功能了.

## 源码解析

此功能使用时需要在 state store component 配置中增加 `primaryEncryptionKey` 作为秘钥, 如果没有配置则当做不加密处理. 所以在 component 初始化阶段 dapr runtime 会根据配置标记该 store 的加解密配置.

```go
// pkg/runtime/runtime.go
func (a *DaprRuntime) initState(s components_v1alpha1.Component) error {
  ...
  // 检查全局配置是否开启此 feature
  if config.IsFeatureEnabled(a.globalConfig.Spec.Features, config.StateEncryption) {
      secretStore := a.getSecretStore(secretStoreName)
      // 从 component 配置中尝试读取 aes 秘钥
      encKeys, encErr := encryption.ComponentEncryptionKey(s, secretStore)
      if encErr != nil {
        log.Errorf("error initializing state store encryption %s (%s/%s): %s", s.ObjectMeta.Name, s.Spec.Type, s.Spec.Version, encErr)
        diag.DefaultMonitoring.ComponentInitFailed(s.Spec.Type, "creation")
        return encErr
      }

      if encKeys.Primary.Key != "" {
        // 如果配置了秘钥说明此 store 后续需要加解密, 将秘钥信息保存在全局 map 中
        ok := encryption.AddEncryptedStateStore(s.ObjectMeta.Name, encKeys)
        if ok {
          log.Infof("automatic encryption enabled for state store %s", s.ObjectMeta.Name)
        }
      }
    }
  ...
}
```

**注意:** 由于使用 `AES-256-GCM` 加密算法, 所以秘钥必须为 32 bytes, 并且需要是 hex 格式.

### 写入/更新

以 HTTP API 为例:

```go
// pkg/http/api.go
func (a *api) onPostState(reqCtx *fasthttp.RequestCtx) {
  ...
  // 上面初始化可以看出配置了秘钥的 store 会被放在全局 map 中
  // 下面函数就是去该 map 中查找当前 store 是否配置秘钥
  if encryption.EncryptedStateStore(storeName) {
    data := []byte(fmt.Sprintf("%v", r.Value))
    // 对值进行加密
    val, encErr := encryption.TryEncryptValue(storeName, data)
    if encErr != nil {
      statusCode, errMsg, resp := a.stateErrorResponse(encErr, "ERR_STATE_SAVE")
      resp.Message = fmt.Sprintf(messages.ErrStateSave, storeName, errMsg)

      respond(reqCtx, withError(statusCode, resp))
      log.Debug(resp.Message)
      return
    }

    reqs[i].Value = val
  }
  ...
}
```

接着查看 `encryption.TryEncryptValue` 方法:

```go
// pkg/encryption/state.go
func TryEncryptValue(storeName string, value []byte) ([]byte, error) {
  keys := encryptedStateStores[storeName]
  enc, err := encrypt(value, keys.Primary, AES256Algorithm)
  if err != nil {
    return value, err
  }

  sEnc := b64.StdEncoding.EncodeToString(enc) + separator + keys.Primary.Name
  return []byte(sEnc), nil
}
```

可以看到最终存在外部存储中的值为 `base64(aes256gcm(data)) + || + primaryEncryptionKey name` 的形式.

为什么不直接存储加密后的值而是在后面还拼接了秘钥名称?

因为此功能提供了一个 `Key rotation` 的功能, 也就是为了方便用户修改秘钥. 所以加密功能其实是可以配置 `primaryEncryptionKey` 和 `secondaryEncryptionKey` 两个秘钥, 更新秘钥时, 需要将老的秘钥配置为 `secondaryEncryptionKey`. 加密永远会使用 `primaryEncryptionKey`, 新增数据会直接使用新秘钥, 而老数据只有在更新时才会用新秘钥加密. 因此存储中会同时存在新老秘钥加密的数据, 为了能够正常解密, dapr 才将加密使用秘钥名称存储在了每条数据中.

### 读取

以 HTTP API 为例, 读取实现非常简单, 如果发现请求的 store 配置了加密功能, 增加一步解密操作.

```go
// pkg/http/api.go
func (a *api) onGetState(reqCtx *fasthttp.RequestCtx) {
  ...
  // 同写入操作
  if encryption.EncryptedStateStore(storeName) {
    // 尝试解密
    val, err := encryption.TryDecryptValue(storeName, resp.Data)
    if err != nil {
      msg := NewErrorResponse("ERR_STATE_GET", fmt.Sprintf(messages.ErrStateGet, key, storeName, err.Error()))
      respond(reqCtx, withError(fasthttp.StatusInternalServerError, msg))
      log.Debug(msg)
      return
    }

    resp.Data = val
  }
  ...
}
```

接着查看 `encryption.TryDecryptValue` 方法:

```go
// pkg/encryption/state.go
func TryDecryptValue(storeName string, value []byte) ([]byte, error) {
  keys := encryptedStateStores[storeName]
  // 将拿到数据使用 || 分割, 获取对应的秘钥名称
  ind := bytes.LastIndex(value, []byte(separator))
  keyName := string(value[ind+len(separator):])

  if len(keyName) == 0 {
    return value, errors.Errorf("could not decrypt data for state store %s: encryption key name not found on record", storeName)
  }

  var key Key

  // 从 primaryEncryptionKey 和 secondaryEncryptionKey 中找到名称匹配的秘钥
  if keys.Primary.Name == keyName {
    key = keys.Primary
  } else if keys.Secondary.Name == keyName {
    key = keys.Secondary
  }

  return decrypt(value[:ind], key, AES256Algorithm)
}
```

## 总结

这个新特性实现是非常简单的, 但是 `primaryEncryptionKey` 和 `secondaryEncryptionKey` 的设计减轻了更换秘钥的难度值得学习.

## 参考资料

- [state-management/howto-encrypt-state](https://docs.dapr.io/developing-applications/building-blocks/state-management/howto-encrypt-state)

![wxmp](/wxmp_tiny_1.png)
