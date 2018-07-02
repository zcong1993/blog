---
title: 不要将思考方式带入别的语言
date: '2017-12-03'
categories:
  - Golang
draft: false
---

> 不同的编程语言不仅仅是语法层次上的差别,所以说会用只是一个开始.

惯用语言往往影响你的思考方式,比如习惯 JAVA 的人喜欢封装工厂类, 我当前最熟悉的语言是 js, 所以在学习 go 语言的时候对我的思路造成了不少干扰.

因为 js 和 go 语言的差别远远不止一个是静态语言一个是动态语言. js 是异步单线程, go 则是多线程(goroutine). 所以用 js 的方式编写 go 程序就不会发挥出 go 的威力.

<!--more-->

### 重连问题

编写可靠性代码时,对于长连接例如 websocket 我们都会考虑连接中断重连的问题, js 语言的 ws 库是基于事件的, 所以连接中断时会触发`close`事件,在这里处理重连操作就好了.

```js
const WebSocket = require('ws')

const url = 'ws://demos.kaazing.com/echo'

const connect = () => {
  const ws = new WebSocket(url)
  ws.on('open', () => console.log('open'))
  ws.on('message', msg => {
    console.log(`rec msg: ${msg}`)
  })
  ws.on('error', err => console.log(err))
  // ticker
  const interval = setInterval(() => {
    ws.send('hello')
  }, 1000)
  ws.on('close', () => {
    // stop send
    clearInterval(interval)
    // reconnect after 1s
    setTimeout(() => connect(), 1000)
  })
}

connect()
```
也就是带有延迟的递归操作, 因为它是单线程, 所以我们无法脱离这个上下文, 重连也是重新执行整个操作流程.

如果用这种方式写 go 就会是这样:

```go
package main

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

func run() {
	url := "ws://demos.kaazing.com/echo"
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		log.Fatal("dial:", err)
	}
	defer c.Close()
	done := make(chan struct{})

	go func() {
		defer c.Close()
		defer close(done)
		for {
			_, message, err := c.ReadMessage()
			if err != nil {
				log.Println("read:", err)
        log.Println("reconnecting...")
        // reconnect after 1s
				time.Sleep(time.Second)
				run()
			}
			log.Printf("recv: %s", message)
		}
	}()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case t := <-ticker.C:
			err = c.WriteMessage(websocket.TextMessage, []byte(t.String()))
			if err != nil {
				log.Println("write:", err)
        log.Println("reconnecting...")
        // reconnect after 1s
				time.Sleep(time.Second)
				run()
			}
		}
	}
}

func main() {
	run()
}
```

遇到问题出错就重新连接递归执行整个函数.

既然 go 是多线程的, 那么其实不必这样, 我们使用一个线程处理整个连接, 如果连接挂掉了, 那么我们丢弃这个连接, 然后重新启动一个连接就好了, 那样代码就会变成这样:

```go
package main

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

func run1(ch chan<- struct{}) {
	url := "ws://demos.kaazing.com/echo"
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		log.Fatal("dial:", err)
	}
	defer c.Close()
	done := make(chan struct{})

	go func() {
		defer c.Close()
		defer close(done)
		for {
			_, message, err := c.ReadMessage()
			if err != nil {
				log.Println("read:", err)
				// notify
				ch <- struct{}{}
				return
			}
			log.Printf("recv: %s", message)
		}
	}()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case t := <-ticker.C:
			err = c.WriteMessage(websocket.TextMessage, []byte(t.String()))
			if err != nil {
				log.Println("write:", err)
				// notify
				ch <- struct{}{}
				return
			}
		}
	}
}

func main() {
	ch := make(chan struct{})
	go run1(ch)
	for {
		select {
		case <-ch:
			log.Println("recreate...")
			time.Sleep(time.Second)
			go run1(ch)
		}
	}
}
```

我们的 main 函数相当于一个管理者, run 方法接收一个 channel, 出错时通知上层管理者, 管理者收到消息, 重新开启一个线程, 这样的代码就不再有递归, 而且也可以轻松驾驭 pool, run 那里可以并发, 相当于 pool 然后连接断开都会被管理者收到, 每收到一次就重新开启一个线程, 如果服务不是很可靠 channel 可以 make 多个.
