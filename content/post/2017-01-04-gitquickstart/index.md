---
title: Git入门教程3-快速上手
date: '2017-01-04'
categories:
  - Git
draft: false
---

## 快速上手

---

经过前两步安装和配置之后我们就可以开始使用 git 的基本操作了。

### 创建版本仓库

git 的项目都是以项目文件夹作为一个版本管理仓库，现在我们就开始创建一个版本仓库，使用的命令是`git init`。

<!--more-->

```sh
# mkdir
$ mkdir gitstart && cd gitstart
$ git init
Initialized empty Git repository in /path/to/your/project/gitstart/.git/
```

如果此时你用的是拥有 git 插件的命令行（如 OSX 下的`zsh`或 Windows 下的`git bash`）就可以看到项目路径后面多了个`master`，这是 git 项目的默认分支，后面章节会介绍。

其实使用如下命令会在当前目录下创建一个`.git`的隐藏文件夹，这是 git 进行版本管理所必须的东西，上一节我们介绍单项目特殊化配置时有介绍到`.git/config`文件，这也是 git 项目需要的配置文件。这里的文件都是核心文件，所以不建议对此目录下的任何文件做修改。

此时，此项目文件变动就被 git 监听了。

### 提交版本更改

由于我们文件夹现在除了 git 自己的文件外没有其他的，所以我们的工作区是干净的，我们创建一个文件。

```sh
# unix创建test.txt并写入单词'test', windows下请确保在git bash中使用
$ echo 'test'>test.txt
```

然后我们使用`git status`查看一下工作区状态：

```sh
On branch master

Initial commit

Untracked files:
(use "git add <file>..." to include in what will be committed)

test.txt
# 没有任何可以提交的内容，但是发现了没有追踪的文件
nothing added to commit but untracked files present (use "git add" to track)
```

可以看到 git 提示我们这些信息，并且建议我们使用`git add <file>`命令让我们建立文件追踪。这样 git 就能监听我们的`test.txt`文件了。

```sh
$ git add test.txt
```

没有报错就表明添加成功了，当然我们可以再次使用`git status`查看现在的工作区状态：

```sh
On branch master

Initial commit

Changes to be committed:
(use "git rm --cached <file>..." to unstage)

new file: test.txt
```

git 提示我们新文件`test.txt`将会被提交，下面我们使用`git commit`命令来提交更改了。

运行此命令会发现我们跳到了`vim`编辑器中，而编辑器下的文件和我们上面的那些提示信息很像，此时 git 需要我们添加一些这个版本的注释信息，比如我们在头部添加`add test.txt`信息，然后保存。此时就会看到以下信息：

```sh
[master (root-commit) 7fd424d] add test.txt
1 file changed, 1 insertion(+)
create mode 100644 test.txt
```

表明我们这个版本添加成功了，`7fd424d`就是我们的版本号，后面的`add test.txt`就是我们的版本注释。

### 总结

git 建立版本库只需在相应目录使用`git init`命令， 当然目录可以是已经存在项目文件的目录，这时候只需提交一次版本就行。

git 提交版本主需要 3 步：

1.  `git status`查看工作区状态(可以省略)
2.  `git add <file>`添加修改文件，可以多次使用此命令，当然可以使用`git add .`或`git add -A`添加所有改动
3.  `git commit`编辑版本注释并提交本次修改，我们可以使用`git commit -m "your description"`命令快速添加注释并提交(建议每次都认真填写版本注释，一是方便回滚版本时确定回滚的位置，二是方便队友或自己查看版本更新记录，毕竟人的记忆不如电脑)

### 注意

一般来说 git 是用来检测文本文件更改变动的，对于像图片这种二进制文件，git 可能只能监测到它的添加删除。

顺便说一下，**强烈**建议你在所有代码都使用`utf-8`编码格式保存文件，这样既可以很好的国际化又能很好地跨平台，维护成本会很低，减少不必要的麻烦。

---

如果想要更优雅地使用 git 就赶快结合上一节内容为这些命令配置别名吧。

本系列文章使用`Gitbook`编写，并发布在 [http://gitstart.zcong.win](http://gitstart.zcong.win)
