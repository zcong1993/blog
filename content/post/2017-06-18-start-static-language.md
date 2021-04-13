---
title: 入坑静态语言
date: '2017-06-18'
categories:
  - Golang
draft: false
---

> 静态语言和动态语言差别远远没有有无 type 那么简单

接触编程一年多一点，最早的时候只会`PHP`，接着学了`JavaScript`写了些`nodejs`，看了看前端的框架，了解了了解前端的构建工具（深坑）。最终成功将最熟悉的语言编程了 JavaScript，虽然现在的工作还是 PHP，但是下一个工作将是 nodejs。

基于 nodejs 也写了一些 cli 工具，因为我用后端语言就是 cli 和 web，前端出了 css 我其实还可以的。。。

<!--more-->

## go

我是一天太闲了，觉得趁机学学静态语言应该对自己挺有帮助的，但是我不太喜欢 Java，一是觉得它太繁琐， 二是不喜欢 xml 这种配置格式。

然后看到了 go，它宣称自己很快，我想试试。

一开始，肯定是 type 不适应， namespace 不适应，还有指针不适应。

type 基本类型好说，只是复杂类型的问题，struct 和 map，而且 go 没有泛型，只能用 interface{}，然后里面还需要做推断。。

namespace 一开始搞得我很混乱，Java 也一样，他们都有自己的`PATH`，包都装在相应的地方，不像 nodejs 这样可以装在自己目录下的`node_modules`中。开始的时候我不明白包名和 namespace 的关系，改放在哪里，改取什么名。还有用别的包的函数时，它返回的复杂类型都是自己包里的 struct，竟然不知道可以用`包名.struct`来使用。。

指针有一个问题困扰了我很久。就是函数接收一个 struct 的指针，在函数中可以不用解引用，或者说解不解引用效果相同。这时 go 自己做的操作，我还以为自己指针这块记错了。。

## path

开始写 cli 的时候，我还是 nodejs 那套思维，比如说我有一个模板文件放在子文件下，然后有个 go 文件想拿到与之它自己上层目录的模板文件，我就在查 go 怎么拿到运行时脚本自己的路径。结果找不到，go 运行时相对路径永远是性对于调用它的 terminal 的目录。

我当时在想，只能拿到入口文件的目录那要怎么得到模板的目录，难道每一个都要用这个路径拼成绝对路径吗？

之后想通的时候发现自己忽略了一个很简单的问题。就是 go 最终会打包成可执行二进制文件，都成二进制了还去哪里找什么路径啊。。。

nodejs 就算是 cli 工具也没什么特殊的，只是装在了全局的 node_modules 目录，然后帮你生成一个脚本文件，大概是`node path/bin/entry.js`，这个脚本执行时就是调用 node 运行这个包的 package.json 中的 bin 选项配置的入口文件，所以你包是什么样子，安装之后还是什么样子，因为 js 就没有编译。

但是 go 会编译成二进制，所以模板文件最简单的方法就是作为字符串存为变量，但是多了就会造成命名混乱，而且很占空间。于是就有了很好的库[go-bindata](https://github.com/jteeuwen/go-bindata)，可以将目录所有文件转换成压缩的字符串，自动生成一个 go 文件，并且有 get 函数，你只需要提供处理前的路径和文件名就能拿到解压缩的文件内容。

这个问题解决了，就可以写写简单的 cli 工具了。

## cli 工具

- [gcommitter](https://github.com/zcong1993/gcommitter) 将 git 基本的几条命令封装成一条
- [gist](https://github.com/zcong1993/gist) github gist 服务的 cli
- [git-release](https://github.com/zcong1993/git-release) 根据 git commit 历史信息生成 release 信息的 cli
