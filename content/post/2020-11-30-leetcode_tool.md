---
title: leetcode-tool 一个让你更方便刷题的工具
date: 2020-11-30T21:51:01+08:00
cover: /leetcode/cover.jpeg
description: 现在程序员招聘越来越注重算法之类的考核了, 所以刷算法题也就成了程序员日常生活的一部分了. 今天介绍一个工具 -- leetcode-tool, 帮助大家更轻松的刷题, 沉淀知识.
categories:
  - Leetcode
  - Tool
tags:
  - Leetcode
  - Tool
draft: true
---

现在程序员招聘越来越注重算法之类的考核了, 所以刷算法题也就成了程序员日常生活的一部分了. 今天介绍一个工具: [leetcode-tool](https://github.com/zcong1993/leetcode-tool), 帮助大家更轻松的刷题, 沉淀知识.

<!--more-->

## 为什么需要她

`LeetCode` 网站刷题时往往遇到下面这些痛点:

- leetcode 网页 IDE 太弱了, 我需要本地解题
- 网页题解难以沉淀, 例如一道题我希望整理多种解法
- 我想根据自己需要, 组织题目做专题之类的总结

这是困扰我的一些问题, 虽然 LeetCode 也做了很多功能, 比如: 收藏, 笔记本之类, 但是对于程序员来说最方便总结和分享的地方永远是 `GitHub` (GitHub 永远滴神).

然而, 使用 GitHub 记录刷题有很多无聊的重复劳动, 比如:

1. 新建题目文件, 写出题解
1. 为了方便复习, 往往会在源码文件里面加上对应的题目链接, 或者写在题目相应文件夹的 readme 中
1. 将题目更新到相应的汇总分类 readme 里面

这些事情其实很费时间, 而且汇总之类的 readme 大多还要更新表格. 对于一个很懒的程序员来说, 重复性的劳动永远是想着使用程序解放自己, 于是我就写了个工具做这些事情.

## 功能介绍

刷题 flow (本文使用 Go 语言举例)

### 0. 初始化项目

一个普通的刷题项目核心两个文件夹, `solve` 和 `toc`:

```bash
# 创建题解文件夹
❯ mkdir solve
# 创建分类汇总文件夹
❯ mkdir toc
```

toc 文件夹也是通过我们程序初始化的:

```bash
❯ leetcode-tool tags
❯ tree -L 2
.
├── solve
│   └── solve0001
└── toc
    ├── all.md
    ├── array.md
    ├── backtracking.md
    ...
    └── union-find.md
```

这样项目就初始化好了.

### 1. 初始化题目

刷题之前先得有目标, 要去 LeetCode 上面找一道题目, 找到它的序号(必须是前端页面看到的). 然后运行:

```bash
❯ leetcode-tool new --lang go 1
```

此步骤会创建一个题解文件夹和三个文件:

```bash
❯ tree solve/solve0001
solve/solve0001
├── problem.md # 题目描述文件
├── solve_0001.go # 题解源码文件
└── solve_0001_test.go # 测试文件
```

`problem.md` 文件为 LeetCode 网页上的题目描述, 在 GitHub 上面显示完全正常, 代码块和图片都可正常显示;

![problem](/leetcode/problem.png)

`solve_0001.go` 为初始化的源码文件:

```go
package solve0001

/**
 * @index 1
 * @title 两数之和
 * @difficulty 简单
 * @tags array,hash-table
 * @draft false
 * @link https://leetcode-cn.com/problems/two-sum/
 * @frontendId 1
 */

func twoSum(nums []int, target int) []int {

}
```

文件中间的注解是后面生成汇总文件表格所需要的信息, 都是通过 api 获取到的题目信息.

`solve_0001_test.go` 相对很简陋:

```go
package solve0001_test

```

以上, 题目初始化就完成了.

_注意:_ 刷题基本是只会选择一门语言, 所以 `--lang` 这个参数略显繁琐, 我们可以在项目根文件创建一个内容为 `{ "lang": "go" }` 的 `.leetcode.json` 文件, 此参数就可以省略了.

### 2. 解题

工具再好也不可能帮你解题, 所以解题还是要靠自己.

入门题目直接搞定, 并且完成测试文件:

```go
// solve_0001.go
func twoSum(nums []int, target int) []int {
	mp := make(map[int]int, 0)
	for i, num := range nums {
		if idx, ok := mp[target-num]; ok {
			return []int{idx, i}
		}
		mp[num] = i
	}
	return []int{}
}
```

```go
// solve_0001_test.go
func TestTwoSum(t *testing.T) {
	assert.Equal(t, []int{0, 1}, twoSum([]int{2, 7, 11, 15}, 9))
	assert.Equal(t, []int{}, twoSum([]int{2, 7, 11, 15}, 4))
}
```

搞定题目.

### 3. 更新题目分类汇总

更新这些东西当然不是我们手动操作, 仅需要简单命令即可:

```bash
❯ leetcode-tool update
# 查看一下 diff
❯ git diff
```

![update](/leetcode/update.png)

### 4. 提交

这一步不用多说了吧, git 操作一把梭就完事儿了. 后续可以自己白嫖一些 `GitHub Action` 自动运行测试.

## 其他命令介绍

其实只剩下一个命令了:

```bash
❯ leetcode-tool meta 1

&{Index:1 Title:两数之和 Difficulty:简单 Tags:[array hash-table] Link:https://leetcode-cn.com/problems/two-sum/ Content: Code: CodeSnippets:}
```

此命令就是简单抓取题目元信息并打印出来, 其实就是让你在初始化之前看看是不是自己想要的题目.

## 安装

安装为什么放在最后呢? 因为安装起来太简单了, 推荐使用 `homebrew`.

```bash
$ brew tap zcong1993/homebrew-tap
$ brew install zcong1993/homebrew-tap/leetcode-tool

# show help
$ leetcode-tool help
```

## 最后

此项目完全源于个人需求, 使用可以参考本人刷题项目 [https://github.com/zcong1993/algo-go](https://github.com/zcong1993/algo-go). 由于我熟悉的语言是 `Go` 和 `Javascript`, 所以此工具现在支持 `go`, `js` 和 `ts` 这三种类型.

如果你使用 ts 刷题, 可以使用此模板项目初始化: [https://github.com/zcong1993/leetcode-ts-template](https://github.com/zcong1993/leetcode-ts-template).
