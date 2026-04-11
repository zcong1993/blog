---
title: Git入门教程6-分支起步
date: '2017-01-10'
categories:
  - Git
draft: false
---

## 分支起步

分支的概念和树枝差不多，从某一主干分成多个分支。git 的分支也是这样的，但是 git 的分支更强大的一点就是可以合并，这样我们就可以并行开发。这在多人合作中尤为突出。每个人都有一个从主干分出来的分支，完成各自负责的开发最后合并到主干，这样效率就非常高了，或者创建 debug 分支和 feature 分支在解决 bug 的同时不影响新功能的开发。

分支有时也可以保存不同版本，一般主分支`master`都是保存的比较稳定的版本，开发会放在`dev`分支，历史版本有时也会保留在分支中比如`1.0`分支。

<!--more-->

### 创建分支

git 默认分支为`master`分支，使用`git init`命令创建会默认自动帮我们建立此分支。

现在我们可以使用`git branch <name>`创建分支：

```sh
$ git branch dev
# 查看分支列表
$ git branch --list
dev
* master
# 显示我们有2个分支，并且当前在master分支
```

此时我么可以使用`git checkout dev`切换到`dev`分支：

```sh
$ git checkout dev
Switched to branch 'dev'
# 此时已经切换到了dev分支了
```

上面两个命令可以用`git checkout -b dev`命令代替，此命令会帮我们创建 dev 分支并切换到该分支。

此时，我们相当于得到了 master 的一个复制副本，我们在分支的操作将不会影响到 master 分支，并且可以在不同分支间自由切换。

不同分支切换，你会发现工作区的文件也会改变成分支自己的状态，此时如果出现意外状态文件无法被修改，则切换分支会失败。

#### 例子：在分支中提交一次版本

```sh
# 切换到dev分支
$ git checkout dev
# 进行版本提交
$ echo 'dev branch'>dev.txt
$ git add .
$ git commit -m "dev commit"
# 切换到master分支查看
$ git checkout master
# 此时我们会发现dev.txt消失了
```

查看版本提交记录，发现没有这一次提交的记录，此时我们可以用`git log --all`来查看所有分支的记录。

如果我们切换回 dev 分支，就会发现`dev.txt`又回来了。这样我们就可以在并行工作了。

### 分支合并

当然，我们在分支解决好问题之后需要把分支做的修改合并到主分支，使用的命令是`git merge <branch>`。

合并分支一般只需要下面两步，复杂情况有第三步，也就是下节要讲的解决代码冲突问题。

```sh
# 切换到主分支（接受分支代码的分支）
$ git checkout master
# 合并分支
$ git merge dev
```

这样我们分支的文件更改就合并到了主分支了。

当然，真是合并时很可能会有冲突，下节会详细说明。

### 分支删除

许多分支的功能可能仅仅是修复某个 bug，它在修复 bug 之后便没有了价值，如果分支比较多时代码也会比较混乱，所以我们需要删除一些已经完成使命的无用分支。

需要使用命令`git branch -d <branch>`。

```sh
$ git branch --list
dev
* master
test
$ git branch -d test
Deleted branch test (was 901c8e5).
$ git branch --list
dev
* master
# 只剩2个分支了
```

---

分支在修复`bug`，多人开发，开发新功能，保留历史稳定版本，`github`开源项目`pull request`都是非常使用的功能。

本系列文章使用`Gitbook`编写，并发布在 [http://gitstart.zcong.win](http://gitstart.zcong.win)
