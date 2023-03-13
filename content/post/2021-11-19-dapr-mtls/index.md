---
title: Dapr 源码解析 | mTLS
date: 2021-11-19T16:34:47+08:00
cover: /dapr-mtls.png
description: 本文介绍 Dapr mTLS 相关源码.
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

[mutual authentication TLS](https://en.wikipedia.org/wiki/Mutual_authentication) 是 dapr 提供的开箱即用的安全功能, 为 dapr sidecar 之间的流量进行加密.

**注意**: 本文不会讲述 mTLS 技术原理和相关证书生成细节, 如需了解请自行查找资料(主要是我自己也不懂).

<!--more-->

## 总览

![mtls overview](/dapr-mtls-overview.png)

dapr 提供了一个叫做 `sentry` 的系统服务作为一个证书颁发机构(CA), 来保证集群内流量安全.

sentry 服务有两个职责:

1. 为集群内部的 dapr sidecar 应用签署工作负载证书
2. 监听根证书是否有修改, 在修改时重启 grpc 服务

默认情况下, sentry 启动时会自动创建并保存有效期为一年的自签名根证书(ca.crt, issuer.crt, issue.key), 除非用户提供自己的. 这三个文件在 k8s 模式下会存储在 secrets 中, 本地部署模式会存在文件系统(默认为: ~/.dapr/certs).

dapr sidecar 和 sentry 之间也是通过 grpc 交流, 它们之间是通过信信任链 cert(也就是共享上面三个文件)来进行身份验证. 在 k8s 模式下, injector 会自动将这些 cert 注入到 dapr sidecar 中.

dapr sidecar 之间交流则是通过 sentry 签署的工作负载证书进行身份认证.

## 源码

源码分为两个部分, sentry 服务和 dapr runtime(daprd). 前者控制证书签发, 后者控制证书使用.

### sentry

sentry 对外暴露 grpc 服务仅提供一个 `SignCertificate` 方法:

```protobuf
service CA {
  // A request for a time-bound certificate to be signed.
  //
  // The requesting side must provide an id for both loosely based
  // And strong based identities.
  rpc SignCertificate (SignCertificateRequest) returns (SignCertificateResponse) {}
}
```

sentry 作为一个单独的服务, 入口文件为 `cmd/sentry/main.go` .

```go
func main() {
  // ... load config
  watchDir := filepath.Dir(config.IssuerCertPath)

  // 核心服务
  ca := sentry.NewSentryCA()
  go ca.Run(ctx, config, ready)
  <-ready

  // 监听根证书变化, 重启 grpc 服务
  go fswatcher.Watch(ctx, watchDir, issuerEvent)
  go func() {
    for range issuerEvent {
      monitoring.IssuerCertChanged()
      log.Warn("issuer credentials changed. reloading")
      ca.Restart(ctx, config)
    }
  }()

  // ... health http server
}
```

可以看到除了监听证书部分, 核心功能就只有这个 `ca.Run`.

`ca.Run` 就做了两件事情:

1. 载入或者创建 `trust bundle` 根证书文件, `certAuth.LoadOrStoreTrustBundle`
2. 初始化 sentry grpc server 并启动

第一步 `certAuth` 为 `NewCertificateAuthority` 初始化的 `defaultCA` 实例, 并且 `LoadOrStoreTrustBundle` 是调用 `validateAndBuildTrustBundle` 方法来完成初始化证书操作.

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/sentry/ca/certificate_authority.go#L169
func (c *defaultCA) validateAndBuildTrustBundle() (*trustRootBundle, error) {
  var (
    issuerCreds     *certs.Credentials
    rootCertBytes   []byte
    issuerCertBytes []byte
  )

  // 检查证书是否存在, 存在时载入
  if !shouldCreateCerts(c.config) {
    err := detectCertificates(c.config.RootCertPath)
    certChain, err := credentials.LoadFromDisk(c.config.RootCertPath, c.config.IssuerCertPath, c.config.IssuerKeyPath)
    issuerCreds, err = certs.PEMCredentialsFromFiles(certChain.Cert, certChain.Key)

    rootCertBytes = certChain.RootCA
    issuerCertBytes = certChain.Cert
  } else {
    // 不存在时创建
    issuerCreds, rootCertBytes, issuerCertBytes, err = c.generateRootAndIssuerCerts()
  }

  // load trust anchors
  trustAnchors, err := certs.CertPoolFromPEM(rootCertBytes)

  return &trustRootBundle{
    issuerCreds:   issuerCreds,
    trustAnchors:  trustAnchors,
    trustDomain:   c.config.TrustDomain,
    rootCertPem:   rootCertBytes,
    issuerCertPem: issuerCertBytes,
  }, nil
}
```

此函数在证书存在时直接 load, 不存在时会自动创建出证书.

由于根证书在 dapr 两种运行环境下保存的位置不一样, 所以 `shouldCreateCerts` 函数会根据运行环境来检验是否已有证书存在. k8s 环境下会通过函数 `certs.CredentialsExist` 额外检查 k8s secrets 中是否存在, 否则会继续检查文件系统.

sentry grpc server 由 `pkg/sentry/server/server.go` 实现. 需要注意的是 grpc server 的 TLS 配置也是基于上一步的 `trustRootBundle` 生成的 `tlsOpt := s.tlsServerOption(trustBundler)` . 后续的 `server.SignCertificate` 方法实现都是证书签发相关, 不做过多说明.

### dapr runtime

sentry 服务作为证书的签发者, 而 dapr runtime 则是证书的消费者.

之前文章说过, dapr sidecar 之间通过 grpc 交流, 而 mTLS 就是加密 dapr sidecar 之间的流量, 所以 dapr runtime 需要做的事情就是为 internal grpc server 和 internal grpc client 设置 TLS, 并在必要时更新证书.

首先, 根据上文我们知道 dapr runtime 获取证书也是通过 grpc 调用 sentry, 他们之间也需要 TLS 配置, 也就是信任链 cert. 在 k8s 环境下, sentry 启动时会将这些 cert 存储在 k8s secrets 中, 并且会在 injector 创建 dapr sidecar 时通过环境变量 `DAPR_TRUST_ANCHORS`, `DAPR_CERT_CHAIN`, `DAPR_CERT_KEY` 注入. 本地运行时则是需要手动设置上面三个环境变量.

接着, dapr runtime 会在初始化时, `runtime.FromFlags` 函数调用 `security.GetCertChain`

从上述环境变量中拿到配置, 最终存储在`runtimeConfig.CertChain` 上面.

dapr runtime 通过 `runtime.establishSecurity` 初始化安全模块:

```go
func (a *DaprRuntime) initRuntime(opts *runtimeOpts) error {
  // ...
  err := a.establishSecurity(a.runtimeConfig.SentryServiceAddress)
  if err != nil {
    return err
  }
  // ...
}
```

`runtime.establishSecurity` 最终通过 `security.Authenticator` 来管理证书:

```go
type Authenticator interface {
  GetTrustAnchors() *x509.CertPool
  GetCurrentSignedCert() *SignedCertificate
  CreateSignedWorkloadCert(id, namespace, trustDomain string) (*SignedCertificate, error)
}

// authenticator 实现上述接口
func (a *authenticator) GetTrustAnchors() *x509.CertPool {
  return a.trustAnchors
}

func (a *authenticator) GetCurrentSignedCert() *SignedCertificate {
  a.certMutex.RLock()
  defer a.certMutex.RUnlock()
  return a.currentSignedCert
}

func (a *authenticator) CreateSignedWorkloadCert(id, namespace, trustDomain string) (*SignedCertificate, error) {
  // ...
  // 创建一个调用 sentry 服务的 grpc client
  // TLS 配置通过传入的三个 cert 生成
  conn, err := grpc.Dial(
    a.sentryAddress,
    grpc.WithTransportCredentials(credentials.NewTLS(config)),
    grpc.WithUnaryInterceptor(unaryClientInterceptor))
  if err != nil {
    diag.DefaultMonitoring.MTLSWorkLoadCertRotationFailed("sentry_conn")
    return nil, errors.Wrap(err, "error establishing connection to sentry")
  }
  defer conn.Close()

  c := sentryv1pb.NewCAClient(conn)
  // 发送 SignCertificate 申请证书
  resp, err := c.SignCertificate(context.Background(),
    &sentryv1pb.SignCertificateRequest{
      CertificateSigningRequest: certPem,
      Id:                        getSentryIdentifier(id),
      Token:                     getToken(),
      TrustDomain:               trustDomain,
      Namespace:                 namespace,
    }, grpc_retry.WithMax(sentryMaxRetries), grpc_retry.WithPerRetryTimeout(sentrySignTimeout))
  if err != nil {
    diag.DefaultMonitoring.MTLSWorkLoadCertRotationFailed("sign")
    return nil, errors.Wrap(err, "error from sentry SignCertificate")
  }

  // ...
  // 结果转换
  signedCert := &SignedCertificate{
    WorkloadCert:  workloadCert,
    PrivateKeyPem: pkPem,
    Expiry:        expiry,
    TrustChain:    trustChain,
  }

  // 更新当前证书, 保证 GetCurrentSignedCert 方法获得最新证书
  a.certMutex.Lock()
  defer a.certMutex.Unlock()
  a.currentSignedCert = signedCert
  return signedCert, nil
}
```

简单来说, `Authenticator` 封装了请求 sentry 获取证书的方法和获取保存的最新证书的方法. 可以看到 `CreateSignedWorkloadCert` 函数每次被调用都会建立一个 grpc 连接并在请求完毕关闭它, 这里之所以不用长连接是因为证书更新频率不需要很频繁, 一般都是几十分钟, 所以为了这么低频的操作维护长连接其实是不划算的.

```go
func (a *DaprRuntime) establishSecurity(sentryAddress string) error {
  // ...
  auth, err := security.GetSidecarAuthenticator(sentryAddress, a.runtimeConfig.CertChain)
  if err != nil {
    return err
  }

  a.authenticator = auth
  a.grpc.SetAuthenticator(auth)
  return nil
}
```

接着分析 `establishSecurity` 函数, 将初始化好的 `authenticator` 分别赋值给 `runtime.authenticator` 和作为调用 `runtime.grpc.SetAuthenticator` 的参数. 这其实就是上文说的, 分别供 internal grpc server 和 internal grpc client 使用.

**internal grpc server**

内部 grpc 服务通过 `runtime.startGRPCInternalServer` 来启动, 最终是 `grpc.NewInternalServer` 来创建服务, 并且会将 `runtime.authenticator` 作为参数传递, 再通过 `StartNonBlocking` 方法启动服务.

`StartNonBlocking` 这个方法是 `APIServer` 和 `InternalServer` 的公共方法, TLS 相关代码由 `getGRPCServer` 方法处理:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/server.go#L221-L221
func (s *server) getGRPCServer() (*grpc_go.Server, error) {
  // ...
  // 因为是共享方法, InternalServer 才会有 authenticator
  if s.authenticator != nil {
    // 调用 authenticator.CreateSignedWorkloadCert 更新证书
    err := s.generateWorkloadCert()
    if err != nil {
      return nil, err
    }

    // 创建 tls 配置
    tlsConfig := tls.Config{
      ClientCAs:  s.signedCert.TrustChain,
      ClientAuth: tls.RequireAndVerifyClientCert,
      GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
        return &s.tlsCert, nil
      },
    }
    ta := credentials.NewTLS(&tlsConfig)

    opts = append(opts, grpc_go.Creds(ta))
    // 开启后台定时任务更新证书
    go s.startWorkloadCertRotation()
  }
}

func (s *server) generateWorkloadCert() error {
  signedCert, err := s.authenticator.CreateSignedWorkloadCert(s.config.AppID, s.config.NameSpace, s.config.TrustDomain)

  tlsCert, err := tls.X509KeyPair(signedCert.WorkloadCert, signedCert.PrivateKeyPem)
  if err != nil {
    return errors.Wrap(err, "error creating x509 Key Pair")
  }

  s.signedCert = signedCert
  s.tlsCert = tlsCert
  s.signedCertDuration = signedCert.Expiry.Sub(time.Now().UTC())
  return nil
}

func (s *server) startWorkloadCertRotation() {
  // certWatchInterval 为 3 秒
  ticker := time.NewTicker(certWatchInterval)
  // 定时检查, 在证书有效期过去 70% 时更新证书
  for range ticker.C {
    s.renewMutex.Lock()
    renew := shouldRenewCert(s.signedCert.Expiry, s.signedCertDuration)
    if renew {
      err := s.generateWorkloadCert()
    }
    s.renewMutex.Unlock()
  }
}
```

**internal grpc client**

dapr runtime 中的 grpc client 基本都由 `grpc.Manager` 来管理, 上面 `runtime.grpc.SetAuthenticator` 就是将 authenticator 保存在 manager 中. TLS 相关功能在 `GetGRPCConnection` 函数中:

```go
// http://github.com/zcong1993/dapr-1/blob/a8ee30180e1183e2a2e4d00c283448af6d73d0d0/pkg/grpc/grpc.go#L77-L77
func (g *Manager) GetGRPCConnection(ctx context.Context, address, id string, namespace string, skipTLS, recreateIfExists, sslEnabled bool, customOpts ...grpc.DialOption) (*grpc.ClientConn, error) {
  // ...
  if !skipTLS && g.auth != nil {
    // 简单调用 authenticator.GetCurrentSignedCert 方法拿到缓存的最新证书
    signedCert := g.auth.GetCurrentSignedCert()
    cert, err := tls.X509KeyPair(signedCert.WorkloadCert, signedCert.PrivateKeyPem)
    if err != nil {
      return nil, errors.Errorf("error generating x509 Key Pair: %s", err)
    }

    var serverName string
    if id != "cluster.local" {
      serverName = fmt.Sprintf("%s.%s.svc.cluster.local", id, namespace)
    }

    // nolint:gosec
    ta := credentials.NewTLS(&tls.Config{
      ServerName:   serverName,
      Certificates: []tls.Certificate{cert},
      RootCAs:      signedCert.TrustChain,
    })
    opts = append(opts, grpc.WithTransportCredentials(ta))
    transportCredentialsAdded = true
  }
  // ...
}
```

### 长连接证书过期如何保证安全?

grpc 是长连接, 而且 TLS 握手发生在连接建立时, 那么如果一个长连接在证书没过期时建立连接, 哪怕证书现在过期只要连接不断开其实是仍然能够正常使用的.

dapr 通过设置 `grpc.KeepaliveParams` option 来解决这个问题, grpc server 端`grpc.KeepaliveParams(keepalive.ServerParameters{MaxConnectionAge: *s.maxConnectionAge}` 参数控制连接最长保持时间, 当一个底层连接时长达到了设置值, server 端会强制关闭连接, client 端会自动重连. dapr 的`maxConnectionAge` 参数设置为 30 秒. 所以上面的情况哪怕发生, 也最多可以存在 30 秒.

此参数也是为了解决另一个问题, dapr 在 k8s 环境 nameresolution 直接使用的是 k8s service, 本质是 DNS, grpc dns resolver 对于 dns 记录缓存时间长达 30 分钟, 所以此时 pod 发生增减 grpc 是感知不到的(详情可见我之前博客文章: [https://blog.cong.moe/post/2021-03-15-grpc-go-discovery-in-k8s](https://blog.cong.moe/post/2021-03-15-grpc-go-discovery-in-k8s/)). 使用 `MaxConnectionAge` 强制重新建立连接可以解决这个问题.

## **参考资料**

- [https://github.com/dapr/dapr](https://github.com/dapr/dapr)
- [https://docs.dapr.io](https://docs.dapr.io)

![wxmp](/wxmp_tiny_1.png)
