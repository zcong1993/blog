---
title: 北大肖臻《区块链技术与应用》公开课学习笔记
date: 2022-01-13T14:07:07+08:00
cover: /blockchain.png
description: 学习区块链总结了一些基础知识.
categories:
  - Blockchain
tags:
  - Blockchain
keywords:
  - Blockchain
  - BTC
  - ETH
  - NFT
draft: false
js:
  - js/prism-solidity.min.js
---

本文是学习北京大学肖臻老师《区块链技术与应用》公开课时总结出的一些简单笔记, 也是在公司内部分享的资料, 并且在最后增加了本人学习智能合约和 NFT 的一些资料. 强烈建议想要了解区块链技术的朋友们去看肖老师公开课视频, 肖老师是带着大家一步一步推导出各种数据结构和技术方案的选用, 让你知其然并知其所以然.

<!--more-->

**注意:** 肖老师的视频发布于 2018 年 11 月 30 日, 所以本文不保证相关知识时效性. NFT 部分是我近期学习的.

## BTC

### 1.1 密码学基础

#### 哈希

范围足够大 `2**256`

需要符合以下三条性质:

- **collision resistance** 抗哈希碰撞能力
- **hiding** 能够隐藏输入信息, 也就是没法从哈希结果反向推导出输入或者输入的规律
- **puzzle friendly** 保证挖矿的难度, 除了暴力穷举没有捷径, pow 工作量证明

#### 非对称加密

交易时 私钥签名, 公钥验证

### 1.2 私钥和地址

随机生成私钥, 然后通过椭圆曲线乘法可以生成一系列公钥.

比特币不直接用公钥作为地址, 而是做了一系列变换:

```c
A = RIPEMD160(SHA256(K))

A: 地址
K: 公钥
```

后续会再进行 base58 之类的编码. 总之公钥和地址是一对一的, 从公钥能够计算出地址, 反之不行.

### 1.3 核心数据结构

哈希指针: H 不光保存指向结构的地址, 还需要保存目标的哈希值.

#### 区块链

就是使用**哈希指针**的**区块**组成的**链表**.

![blockchain](/blockchain/148488609-f7512dd9-54fc-47a3-b5c9-f3df3a5be389.png)

##### 区块

表 7-1 区块结构

| Size               | Field               | Description                                           |
| ------------------ | ------------------- | ----------------------------------------------------- |
| 4 bytes            | Block Size          | The size of the block, in bytes, following this field |
| 80 bytes           | Block Header        | Several fields form the block header                  |
| 1–9 bytes (VarInt) | Transaction Counter | How many transactions follow                          |
| Variable           | Transactions        | The transactions recorded in this block               |

表 7-2 区块头结构

| Size     | Field               | Description                                                           |
| -------- | ------------------- | --------------------------------------------------------------------- |
| 4 bytes  | Version             | A version number to track software/protocol upgrades                  |
| 32 bytes | Previous Block Hash | A reference to the hash of the previous (parent) block in the chain   |
| 32 bytes | Merkle Root         | A hash of the root of the merkle tree of this block’s transactions    |
| 4 bytes  | Timestamp           | The approximate creation time of this block (seconds from Unix Epoch) |
| 4 bytes  | Difficulty Target   | The Proof-of-Work algorithm difficulty target for this block          |
| 4 bytes  | Nonce               | A counter used for the Proof-of-Work algorithm                        |

区块头是 80 字节, 而区块要包含交易, 所以一般来说区块比区块头大小大**成百上千倍**.

可以发现每个区块头总是包含**上一个区块的哈希值**, 所以任何区块的修改都会导致后续区块的哈希值改变, 所以只要检查最新块哈希值就可以确定之前所有区块数据有没有被篡改.

当前块的哈希就是矿工计算出来的, 不存在区块链系统内部, 节点接到新区块广播时, 只需要计算出当前块哈希然后验证是否符合难度就行, 不需要矿工提供. 但是应用层为了能够高效查询数据, 会在应用层维护区块哈希到区块数据的索引.

创世纪块: 第一个区块, 区块链的头, 写死在代码中

区块高度: 创世纪块为 0, 后续每产生一个新区块高度加一

挖矿: 简单来说就是通过尝试不同的 **Nonce**(Timestamp 和 Merkle Root 也可以用, 后续说明), 使得当前区块哈希 `H(block header) <= target`, 即前面必须有一定数目个 0(例如 000000000000000000040b38097e0a61ef1ad31b184c908a738cfff013c094b2).

#### merkle tree

保存区块中的交易数据.

和 binary tree 类似, 但是有两点不同:

1. 使用哈希指针
2. 只有叶节点存储交易信息, 中间节点存储左右子节点哈希的哈希

![merkle tree](/blockchain/148488855-737cd051-3806-44af-bb16-4471c9dd747a.png)

Merkle Root 也会存到区块头中, 和区块链类似, 校验 Merkle Root Hash 就能检测出区块中交易是否有被篡改.

##### merkle proof

轻节点: 只保存区块头, 所以相较于全节点本地数据量会少非常多.

为了方便**轻节点**验证交易是否存在.

![merkle proof](/blockchain/148489405-9939cca4-eab5-4666-89aa-e37feb6f5678.png)

效率为 O(lgN), N 为交易数量.

### 1.4 协议

#### 共识机制

比特币网络节点之间通过用**算力**投票来争取记账权. 也就是矿工同时基于当前最长链都在本地构建一个本地最新区块, 谁先计算出符合要求的区块, 相当于谁获得了当前区块的记账权.

假如多个节点同时计算出同一高度的区块, 则区块链会在短时间分叉, 每个节点会接收自己收到的第一个合法节点作为最长合法链, 它也会基于这个区块来计算下一个区块, 也就相当于投了这个区块一票, 最终肯定会有一条成为最长合法链(胜出), 剩下的链就会被淘汰.

挖矿奖励: 挖矿消耗大量算力来保证区块链安全, 所以每个区块产生都会奖励区块创造者一定量的比特币. 最初为 50BTC, 每经过 21W 个区块, 奖励减半, 目前为 6.25BTC.

### 1.5 交易

比特币使用 Transcation-based ledger (基于转账记录的账本). 区块链中只记录转账信息, 没有所谓的账户余额.

全节点需要在本地维护 UTXO (unspent transaction outputs, 未花费的交易输出).

![transcation](/blockchain/148499592-48e0d70d-61ba-49a0-a195-7513c7cf273e.png)

为了防止双花攻击, 转账交易时需要提供资金来源. 为了提高矿工打包你这笔交易的积极性, 需要支付一定的手续费.

交易确认数: 假如某笔交易被写在了高度为 100 的区块中, 确认数为 1, 当前链每增加一个后续区块则确认数加一. 一般等 6 个以上确认才认为安全.

每一笔交易都包含一个或多个输入(vin)和输出(vout)(出块奖励没有输入).

```json
{
  "version": 1,
  "locktime": 0,
  "vin": [
    {
      "txid": "7957a35fe64f80d234d76d83a2a8f1a0d8149a41d81de548f0a65a8a999f6f18",
      "vout": 0,
      "scriptSig": "3045022100884d142d86652a3f47ba4746ec719bbfbd040a570b1deccbb6498c75c4ae24cb02204b9f039ff08df09cbe9f6addac960298cad530a863ea8f53982c09db8f6e3813[ALL] 0484ecc0d46f1918b30928fa0e4ed99f16a0fb4fde0735e7ade8416ab9fe423cc5412336376789d172787ec3457eee41c04f4938de5cc17b4a10fa336a8d752adf",
      "sequence": 4294967295
    }
  ],
  "vout": [
    {
      "value": 0.015,
      "scriptPubKey": "OP_DUP OP_HASH160 ab68025513c3dbd2f7b92a94e0581f5d50f654e7 OP_EQUALVERIFY OP_CHECKSIG"
    },
    {
      "value": 0.0845,
      "scriptPubKey": "OP_DUP OP_HASH160 7f9b1a7fb68d60c536c2fd8aeaa53a8f3cc025a8 OP_EQUALVERIFY OP_CHECKSIG"
    }
  ]
}
```

vin 用于说明币的来源. 验证来源时则是需要将 vin 中的每笔来源的 vin 脚本和它指向的交易的 vout 脚本执行, 不出错则表示合法.

![image](/blockchain/148528728-e354e65d-2a0d-4707-a90e-6d369621d136.png)

#### 比特币脚本

比特币脚本非常简单, 基于栈只支持几个指令, 用于验证交易合法性.

交易类型

1. P2PK (pay to public key) 给公钥地址转账
2. P2PKH (pay to public key hash) 付款至公钥哈希
3. P2SH (pay to script hash)

![image](/blockchain/148716285-19c4dcb0-f9bb-4210-be95-b2ac274a2dee.png)

### 1.6 挖矿

difficult to solve, but easy to verify.

挖矿就是构造出符合 `H(block header) <= target`.

难度: 简单来说就是要求计算出来的哈希值前面 N 为都为 0.

#### 难度调整

负反馈调节, 比特币期望出块时间稳定在 10 分钟(这是写死的设定). 协议要求每过 2016 个区块就重新计算一次难度, 计算公式为:

```markup
New Difficulty = Old Difficulty * (20160 minutes / Actual Time of Last 2016 Blocks)
过去 2016 个块实际出块时间 < 2016 * 10 (期望时间), 难度增大, 反之减小
```

并且为了防止未考虑到的情况, 单次难度调整幅度最大为 4 倍.

难度调整都是由节点自己根据规则独立计算, 假如某些节点不按照规则调整难度, 则它产生的区块会被正常节点认定为不合法区块丢弃掉.

#### 节点类型

![image](/blockchain/148513749-ee6cfcca-f220-4cbf-9f5c-7ad63d35402e.png)

![image](/blockchain/148513808-07d1072c-184b-4253-84fa-3be8d569e689.png)

挖矿需要全节点, 需要承担维护区块链系统功能的职责.

#### 挖矿设备

- CPU
- GPU
- ASIC 芯片 (专用芯片)

#### 矿池

矿池就是多个矿工联合在一起, 共同分享收益(均摊风险), 解决收益不稳定的问题. 并且 pool manager 负责维护全节点的工作, 矿工只负责接收 manager 发放的挖矿题目并暴力求解哈希.

1. 收益如何公平分配收益?

   参考区块链难度, 统计每个矿工提交的 almost valid block 数量作为工作量证明, 按照这个比例分配. almost valid block 为降低难度的 target, 例如当前区块链难度要求为前面 76 个 0, 可以选择 60 个 0 作为 almost valid block. 这就是变相的局部算力证明.

2. 如何防止矿工偷取出块奖励?

   任务是由 pool manager 分配的, 所以矿主已经将出块奖励地址写进去了, 没办法改成自己的地址.

   假如他修改成自己地址, 则他提交给 pool manager 的 almost valid block 会被检测出不合法.

#### 矿池的危害

- 降低了 51% 攻击的难度
- 可以封锁某些地址, 故意不把某些地址的交易信息打包

### 1.7 分叉

state fork: 一条链暂时出于多个分支的状态. 例如: 多个节点同时挖出区块, 分叉攻击

protocol fork: 因为协议修改导致不同版本同时存在导致的分叉, 类似与软件的前后兼容性, 又分为**软分叉**和**硬分叉**.

#### 硬分叉

协议更改导致的永久性分叉, 除非所有节点更新软件(去中心化系统几乎不可能). 经常会导致主链分叉产生另一种数字货币, 例如 BTC/BCH, ETH/ETC.

![image](/blockchain/148686229-b55d824e-86c1-49b9-a15b-2748f04be7e3.png)

举个例子, 假如 BTC 协议将区块大小限制从 1MB 更改为 4MB, 并且一半以上算力已升级:

- 升级后的软件会挖出大于 1MB 的区块, 并且认为合法
- 没升级的软件不认为大于 1MB 的区块合法, 所以永远会从第一个大块前面的分叉开始挖
- 升级后的软件认为两边都合法, 因为新版本算力多, 所以最长合法链肯定会变成大区块那边, 导致新旧版本彻底分叉

##### 硬分叉导致过的问题

硬分叉导致一条链分叉成两条链, 并且共享分叉前的状态和历史, 所以除了数字货币名称外, 分叉前的地址和私钥还有余额都是一模一样的. 假如你在 ETH 分叉前 xxx 地址有 10 个 ETH, 则分叉后你这个相同的地址也会有 10 个 ETC, 并且私钥也是一样的. 所以会出现**重放攻击**, 私钥都一样所以签名也一样. 后续为了防止这种事情发生, 每条链都有了全局唯一的 chainID, 会在签名时使用.

#### 软分叉

因协议更改导致的临时分叉.

![image](/blockchain/148686851-f06f3fc4-a45b-4005-a78d-7f224fc41e90.png)

举个例子, 假如 BTC 协议将区块大小限制从 1MB 更改为 0.5MB, 并且一半以上算力已升级:

- 升级后的软件会挖出小于 1MB 的区块, 并且认为大于 0.5MB 的区块非法, 所以他永远会选择小区块的链, 并且由于算力优势, 小区块链会变成最长合法链
- 升级前的软件会认为两边都合法, 所以也会选择小区块链作为最长合法链, 但是它发布的大于 0.5MB 的大区块永远不会被认可, 所以每次它提交一个大区块, 升级后的软件就会分叉出一个小的链把大区块忽略掉

实际中出现的例子: 扩展协议 BTC coinbase 字段含义(作为 UTXO 根哈希); BTC P2SH 扩展.

## ETH

### 2.1 账户模型

和 BTC 不同, ETH 是基于账户的账本. 并且账户分为外部账户和合约账户.

ETH 是基于账户余额的, 所以天然不会出现双花攻击, 但是为了防止重放攻击, 每个账户都会有一个自增的交易序号表名是第几次交易.

### 2.2 核心数据结构

状态树, 交易树, 收据树. 数据结构使用 MPT(Modified-Merkle-Paricia-Trie).

#### 状态树

![image](/blockchain/148688127-1bc268d3-8787-4d79-8e99-dfbeb408b925.png)

![image](/blockchain/148688218-8466c106-0831-4576-a2a9-0e132fdac2fb.png)

每个新区块都会产生新的状态树, 但是没有发生改变的节点会共享, 只有改变了的节点会产生新的分支.

为什么不原地修改一个树, 而是保留多个历史版本?

为了回滚方便, 因为智能合约表达能力非常强, 所以状态回滚没办法通过程序逆向计算出来.

#### 交易树和收据树

交易和收据记录一一对应.

交易搜索: 区块头, 交易树和收据树都包含一个布隆过滤器. 查找时先检测区块头过滤器找到区块再查找交易树收据树中的过滤器.

### 2.3 共识机制 GHOST 协议

ETH 的出块速度为十几秒.

出块时间果断导致分叉为常态, 并且极易出现多分支状态.

为了鼓励矿工在出现分叉后快速达成一致, ETH 引入了 uncle block 奖励机制.

![image](/blockchain/148688915-5ffa6f31-4151-4311-85fe-9d275d80be13.png)

- 叔父区块定义为七代以内的有共同祖先的区块, 并且必须是分叉的第一个区块
- 每个区块最多可包含两个叔父区块, 当前获取记账权的节点每提交一个叔父区块可以额外获得 1/32 出块奖励(出块奖励目前为 3ETH)的 ETH
- 被提交的叔父区块会根据所处的代数获得 7/8 - 2/8 出块奖励的 ETH

### 2.4 挖矿算法

ASIC resistance, memory hard mining puzzle. 增加对内存的消耗.

ETH 的挖矿算法参考了 LiteCoin, 并且做了改进.

会有一个 16M 的 cache, 对给定 seed 进行迭代求哈希填满, 1G 的 dataset (DAG). dataset 是通过 cache 生成出来的, 并且每过 30000 个块这两个数据都会重新生成, 并且大小增加初始值的 1/128.

cache 用于轻节点验证, DAG 用于矿工加速挖矿.

挖矿就是改变 nonce 得到 block header hash, 对应 DAG 中的某个 index, 每次取这个 index 和 index+1 两个元素, 然后根据选取的这个 index 元素计算出下一次迭代对应的 index, 一共进行 64 次循环, 得到最终的哈希值再检查是否符合难度要求.

![image](/blockchain/148716837-5f15486d-a47b-47ea-90af-20ac8b5edf99.png)

![image](/blockchain/148716698-e22c47eb-905a-4ece-b25c-6158a8203643.png)

![image](/blockchain/148716714-a6420b97-0b28-4414-a27d-e473733145ba.png)

![image](/blockchain/148720059-0203b78d-518d-4943-9271-6b1081a2e990.png)

![image](/blockchain/148720304-ffb1a536-edfc-4a3f-b9b4-203bb4cfc375.png)

ETH 没出现专用矿机, 另一方面原因在于一直在鼓吹要从 POW 转向 POS(proof of stake 权益证明, 现在仍未实装), 矿机开发商受到恐吓不敢开发矿机.

ETH pre mining: 项目早期预留一部分 ETH 给开发者, 但是这部分比例非常高.

![image](/blockchain/148720820-e58e0546-a0a3-40c6-a6aa-9acc8b073398.png)

#### 难度调整

ETH 挖矿难度不同于 BTC, 每个区块都有可能引起难度调整, 具体调整规则非常复杂, 而且进行过多次修改.

简单描述下就是和 出块时间, 是否有叔父区块, 难度炸弹 都有关系.

![image](/blockchain/148721352-58132742-d4f6-4349-82bf-b03898331618.png)

![image](/blockchain/148721214-ef1998fc-6f10-4291-a1ee-a6626195dd25.png)

![image](/blockchain/148721499-a6f29f9f-34bd-4992-9dc9-e6192866449d.png)

### 2.5 权益证明

核心思想是不在比拼算力, 而是比拼 ETH 资产. 仍然需要矿工构建区块. 但是现在还非常不成熟, 并且没有实装.

引入验证者角色, 验证者需要锁定一部分 ETH 资产作为保证金, 并且投票权重与保证金比例有关. 并且每过一段时间需要轮换.

![image](/blockchain/148723041-f662856b-9cdb-40d3-988d-dfab7bd11bd7.png)

投票过程类似于 two-phase commit, 每过 50 个区块(记作一个 epoch)投一次票, 并且需要超过 2/3 验证者投票才算有效, 投票对于前一个 epoch 为 commit message, 对于后一个 epoch 为 prepare message.

假如发现某些验证者不作为或者作恶, 会销毁掉他的所有锁定 ETH 资产.

### 2.6 智能合约

![image](/blockchain/148723966-80a3c0ba-f80a-49c7-96c2-cb4cff0833de.png)

solidity 是和 JavaScript 语法相近的面向对象的静态语言.

外部账户如何调用只能合约?

类似于转账, 需要对合约账户转账, 并且要在 data 域填写要调用的函数以及参数编码. 并且支持设置此次调用愿意支付的 gas fee 上限(gas limit).

合约也可以调用合约, 但是一个只能合约调用的触发者必须是外部账户.

合约支持 fallback 函数声名, 如果转账没有说明调用函数或者调用函数找不到, 会自动调用 fallback 函数.

智能合约编写完成后要编译成 bytecode, 并且需要运行在 EVM 虚拟机.

#### gas fee

因为没法判断任意合约会不会出现死循环.

![image](/blockchain/148724712-54b86ed7-0d7b-4e80-bb73-ebf6f9dca2ee.png)

#### 错误处理

![image](/blockchain/148724936-b1d6189b-413f-477d-b558-94b229d4acf2.png)

发生错误并不会退回已经使用的 gas fee.

![image](/blockchain/148725035-aac0d17d-d947-457a-a546-d863f94a8d25.png)

block header 头会设置 gas limit 即整个块的 gas fee 使用上限, 因为 gas fee 非常大意味着合约调用执行复杂度很高, 这样一个大区块会增加整个系统的压力, 并且获取记账权的矿工可以对当前块的 gas limit 自行调整 1/1024.

节点在执行用户对智能合约调用时, 需要先将此次调用的 gas limit 从调用方账户扣除(在内存中进行), 最后执行完毕后假如根据实际情况退还多余的部分, 这个过程都是在内存中进行的所以不是转账. 对于多个矿工来说有可能同时在本地执行同一个合约, 但是最终链上面确认的合法区块永远只有一个被认可.

每个智能合约的调用最终都会在所有全节点执行, 因为所有节点都需要通过交易和合约调用驱动, 到达一致的状态. 所以智能合约执行的东西必须是确定的, 因此智能合约没法支持真正的随机吗, 也不能进行系统调用.

![image](/blockchain/148726339-cb54ea95-2d81-4308-821e-975ea909ab34.png)

![image](/blockchain/148726429-aff75bf2-5ae1-46d6-90b2-7262c82bdd7d.png)

message.sender 为调用者, 可以是合约, 而 tx.origin 则是触发这一系列调用的最外层外部账号转账者.

#### 智能合约开发注意事项

- 区块链不可篡改, 发生 bug 没法修改
- 合约代码公开, 谁都能看, 容易被从源码找到漏洞
- 多测试, 多在测试链上面验证
- 开发支持能够接收转账和退款的智能合约时, 不要忽略合约也可以参与

几个有 bug 合约的例子:

1. 黑客使用合约参加竞拍, 导致拍卖结束后没法退钱给竞拍者

   ![image](/blockchain/148727811-74367911-0f0a-4b88-a826-e3b5f7e670bc.png)

   向合约地址转账相当于没有指明方法的合约调用, 由于黑客合约没有 fallback 函数, 所以会报错导致整个 `auctionEnd` 函数回滚.

2. 黑客使用合约参与竞拍, 导致重复取钱

   ![image](/blockchain/148728381-b2f6b5fd-1be6-4069-bbbb-e89ddd77e040.png)

   ![image](/blockchain/148728436-0fba15dc-46f0-47d3-9345-3ed7314f664c.png)

   先调用转账再将可取回余额置零, 所以黑客可以在合约 fallback 函数中递归调用原合约 withdraw 方法导致重复取钱.

### 2.7 基于 ETH 发行山寨币和 NFT

#### 山寨币

山寨币其实就是借助 ETH 区块链来实现一个不可篡改的账本, 并且只需要支持转账. 所以 ETH 出了个 ERC20 协议, 制定了标准化.

[https://eips.ethereum.org/EIPS/eip-20](https://eips.ethereum.org/EIPS/eip-20)

本质就是利用智能合约维护了 `mapping(address => uint256) private _balances;` 地址到余额的账簿.

```solidity
// 实现 ERC20 需要实现的接口
// 只选取了部分
interface IERC20 {
    /**
     * @dev Returns the amount of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the amount of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves `amount` tokens from the caller's account to `recipient`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address recipient, uint256 amount) external returns (bool);
}
```

#### NFT

NFT 其实非常简单, 非同质化货币意味着一个合约支持多种货币, 因此需要多个账簿. ETH 有两个 NFT 相关的协议 ERC721 和 ERC1155.

[https://eips.ethereum.org/EIPS/eip-721](https://eips.ethereum.org/EIPS/eip-721)

[https://eips.ethereum.org/EIPS/eip-1155](https://eips.ethereum.org/EIPS/eip-1155)

以 ERC1155 为例, 本质就是利用智能合约维护 `mapping(uint256 => mapping(address => uint256)) private _balances;` 多重账簿, 外层的 key 为 token id, 内层就是地址到余额的账簿.

```solidity
interface ERC1155 /* is ERC165 */ {
    function safeTransferFrom(address _from, address _to, uint256 _id, uint256 _value, bytes calldata _data) external;

    function safeBatchTransferFrom(address _from, address _to, uint256[] calldata _ids, uint256[] calldata _values, bytes calldata _data) external;

    function balanceOf(address _owner, uint256 _id) external view returns (uint256);

    function balanceOfBatch(address[] calldata _owners, uint256[] calldata _ids) external view returns (uint256[] memory);
}
```

发行方需要提供每个 token id 到 metadata 元信息的关系.

```solidity
interface ERC1155Metadata_URI {
    function uri(uint256 _id) external view returns (string memory);
}
```

ERC1155 规定 uri 函数需要返回 `https://token-cdn-domain/{id}.json` 格式的 metadata 资源地址, 而客户端需要将 id 替换成 token id, 并且是 64 位 hex , 例如: `https://token-cdn-domain/000000000000000000000000000000000000000000000000000000000004cce0.json` 就是 token id 为 `314592/0x4CCE0` 的最终元信息地址.

而元信息需要包含资源地址和名称等信息:

```json
{
  "title": "Token Metadata",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Identifies the asset to which this token represents"
    },
    "decimals": {
      "type": "integer",
      "description": "The number of decimal places that the token amount should display - e.g. 18, means to divide the token amount by 1000000000000000000 to get its user representation."
    },
    "description": {
      "type": "string",
      "description": "Describes the asset to which this token represents"
    },
    "image": {
      "type": "string",
      "description": "A URI pointing to a resource with mime type image/* representing the asset to which this token represents. Consider making any images at a width between 320 and 1080 pixels and aspect ratio between 1.91:1 and 4:5 inclusive."
    },
    "properties": {
      "type": "object",
      "description": "Arbitrary properties. Values may be strings, numbers, object or arrays."
    }
  }
}
```

例如:

```json
{
  "name": "Gymbo Collection 7",
  "description": "Gymbo gymbo7.png.",
  "image": "https://public-images-zcong.vercel.app/images/gymbo7.png"
}
```

资源和元数据严格一点需要存储在不可篡改的区块链存储系统中, 例如 ipfs. 但是现在大多 NFT 都是使用中心化的 OSS 之类的产品.

## 一些常见问题

1. 私钥丢失怎么办?

   无解.

   因为区块链的去中心化性质和私钥的重要性, 钱包软件也没有在线账户系统, 你的账户私钥都是在**本地**, 所以尽量备份好助记词, 不要使用截图等方式, 最好抄在纸上.

2. 私钥泄漏怎么办?

   火速创建一个安全的账户地址, 并将所有余额转入.

3. 作为智能合约开发者或用户, 发生被黑客攻击怎么办?

   如果是类似于上面示例中的拍卖重入攻击, 尽快使用相同的方法攻击合约, 但是你是作为正义的一方减少损失. 将合约余额转移到安全地址.

4. 不要用切分私钥的方式使用共有财产账号

   BTC 应使用 multi sig 多重签名的方式. 切分私钥会极大降低安全性, 例如切一半, 会将复杂度从 2 ^ 256 降低到 2 ^ 128.

## 参考资料

- [https://www.bilibili.com/video/BV1Vt411X7JF](https://www.bilibili.com/video/BV1Vt411X7JF)
- [https://github.com/tianmingyun/MasterBitcoin2CN](https://github.com/tianmingyun/MasterBitcoin2CN)

![wxmp](/wxmp_tiny_1.png)
