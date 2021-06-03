---
title: 滑动窗口计数器
date: 2021-06-03T11:47:21+08:00
cover: /ferris-wheel-2210x1473.jpeg
description: 一种只记录最近一段时间的某些数据指标的数据结构
categories:
  - DataStructure
  - Golang
  - TypeScript
tags:
  - DataStructure
  - Golang
  - TypeScript
draft: false
---

## 基本概念

一种只记录`最近一段时间`的某些数据指标的数据结构. 例如: 最近 30 秒请求成功数, 失败数, 总数.

类似于简单的时序数据库, 但是保留很少数据. 适用于需要统计最近某些数字指标的场景. 例如:

- 自适应断流
- 熔断器

## 基本思路

将整个时间区间 `totalInterval` 划分为 `n` 个桶, 每个桶的时间区间为 `totalInterval/n` 记作 `interval`, 桶使用长度为 `n` 的`环形数组`存放.

now 时刻增加指标的目标桶 index 为 `((now - initTime) / interval) % n`.

增加读取时, 重置过期的桶.

![image1](/120444164-f57e6700-c3b9-11eb-95c3-08702a81e1d3.png)

## 实现

```go
type (
	// RollingWindowOption let callers customize the RollingWindow.
	RollingWindowOption func(rollingWindow *RollingWindow)

	// RollingWindow defines a rolling window to calculate the events in buckets with time interval.
	RollingWindow struct {
		lock          sync.RWMutex
		// bucket 数量
		size          int
		// 存储 bucket, 环形数组 offset % size 将操作映射到范围内
		win           *window
		// 每个桶时间间隔
		interval      time.Duration
		// 上一个 add 时桶的偏移量
		offset        int
		// reduce 取数据时是否忽略当前还未结束的桶
		ignoreCurrent bool
		// 上次 add 时的时间
		lastTime      time.Duration // start time of the last bucket
	}
)

// Add adds value to current bucket.
func (rw *RollingWindow) Add(v float64) {
	rw.lock.Lock()
	defer rw.lock.Unlock()
	// 这里处理偏移量
	// 1. reset 掉过期的桶
	// 2. 计算当前偏移量 rw.offset
	// 3. 更新 rw.lastTime
	rw.updateOffset()
	// 使用上一步算好的 offset
	rw.win.add(rw.offset, v)
}

// Reduce runs fn on all buckets, ignore current bucket if ignoreCurrent was set.
func (rw *RollingWindow) Reduce(fn func(b *Bucket)) {
	rw.lock.RLock()
	defer rw.lock.RUnlock()

	// 由于 reset 过期桶操作只在 add 中的 updateOffset 中调用
	// Reduce 读取时不做 reset 操作, 但是只返回还没过期的桶
	var diff int
	// span 函数返回当前时间距离上次 add 时间过了几个 interval
	// 也就是过期几个桶
	span := rw.span()
	// rw.ignoreCurrent 为 true 时, 忽略当前桶
	if span == 0 && rw.ignoreCurrent {
		diff = rw.size - 1
	} else {
		// size - span 表示还未过期的桶, 也就是要取的数据
		diff = rw.size - span
	}
	// <= 0 时表示都过期了
	if diff > 0 {
		// 过期的桶为 [rw.offset+1, rw.offset+span], diff 为没过期的桶数量
		offset := (rw.offset + span + 1) % rw.size
		// 所以从 rw.offset+span+1 开始拿 diff 个桶
		rw.win.reduce(offset, diff, fn)
	}
}

// span 函数返回当前时间距离上次 add 时间过了几个 interval
// 也就是过期几个桶
func (rw *RollingWindow) span() int {
	offset := int(timex.Since(rw.lastTime) / rw.interval)
	if 0 <= offset && offset < rw.size {
		return offset
	}

	// offset >= rw.size 表示已经过了环形数组一圈了, 返回 size
	return rw.size
}

func (rw *RollingWindow) updateOffset() {
	// span 返回距离上次 add 过了几个 interval
	span := rw.span()
	if span <= 0 {
		return
	}

	// 经过了span 个 interval, 就说明了 span 个桶已经过期, 需要重置
	// offset 指向上次 add 的 bucket
	offset := rw.offset
	// 由于是环形数组, 所以自己前面是最老的数据
	// 因此从 offset + 1 开始 reset span 个桶
	// [rw.offset+1, rw.offset+span]
	for i := 0; i < span; i++ {
		rw.win.resetBucket((offset + i + 1) % rw.size)
	}

	// 计算出当前的偏移量, 后面会使用它来向相应桶添加数据
	// 也会用作下次 add 计算过期桶
	rw.offset = (offset + span) % rw.size
	now := timex.Now()
	// 更新上次更新时间
	rw.lastTime = now - (now-rw.lastTime)%rw.interval
}
```

[https://github.com/tal-tech/go-zero/blob/75a330184dd4b1212187584261e3b33b9c08541b/core/collection/rollingwindow.go](https://github.com/tal-tech/go-zero/blob/75a330184dd4b1212187584261e3b33b9c08541b/core/collection/rollingwindow.go)

ts 实现: [https://github.com/zcong1993/rolling-window](https://github.com/zcong1993/rolling-window)

## 其他

滑动窗口 bucket 也可以存其他任何数据, 例如数组存储对象.

这种滑动窗口, 测试需要测试时间推移, 一些语言 sleep 时间不会那么准, 所以最好实现一个 `mockTimer` 方便测试.

```ts
export interface Timer {
  now(): number // nano
}

export class DefaultTimer implements Timer {
  now() {
    return hr2nano(process.hrtime())
  }
}
```

## 参考资料

- [https://mp.weixin.qq.com/s/OpF4JVWHA9W1v0yefeo56w](https://mp.weixin.qq.com/s/OpF4JVWHA9W1v0yefeo56w)
- [https://github.com/tal-tech/go-zero/blob/75a330184dd4b1212187584261e3b33b9c08541b/core/collection/rollingwindow.go](https://github.com/tal-tech/go-zero/blob/75a330184dd4b1212187584261e3b33b9c08541b/core/collection/rollingwindow.go)
