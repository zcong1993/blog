---
title: Git入门教程7-解决冲突
date: '2017-01-10'
categories:
  - Git
draft: false
---

## 解决冲突

---

上一节提到了分支的创建和合并，现实中我们的代码往往是互相联系的。比如我们在 bug 修复分支和 dev 分支开发功能时，同时修改了某个文件，之后修复 bug 分支结束的时候需要合并到主分支，之后 dev 分支合并到 master 分支的时候，这时这个文件的版本和 dev 分支分出去的状态不一样，很可能同一部分的代码会相互冲突。

这时，我们就需要解决冲突，因为 git 并不知道我们真正需要保留的是哪个版本，有时可能需要结合两个版本修正出第三个版本，所以这只能由我们自己判断了。多人合作时往往会需要冲突的两个人商讨得出最终保留版本。请记住，无论如何都不要擅自修改或丢弃他人的代码。

<!--more-->

### 代码如何发生冲突

模拟一下代码冲突：

```sh
# 创建dev分支
$ git branch dev
# 在master分支提交一次版本, 更改test.txt文件
$ echo 'test master'>test.txt
$ git commit -am 'master change'
# 切换到dev版本，更改test.txt文件
$ git checkout dev
$ echo 'test dev'>test.txt
$ git commit -am 'dev change'
# 尝试合并dev分支到master
$ git checkout master
$ git merge dev
Auto-merging test.txt
CONFLICT (content): Merge conflict in test.txt
Automatic merge failed; fix conflicts and then commit the result.
```

可以看到 git 提示我们合并分支失败，由于`test.txt`文件发生了冲突，我们需要解决冲突才能继续解决冲突。

### mergetool

解决冲突首先你可能需要选择一款适合你的`mergetool`，这里我推荐大家使用`sublime text 3`编辑器的`Sublimerge`插件,可以查看插件[官网](http://www.sublimerge.com)。原因是，我很喜欢这个轻量级的编辑器，它也有很强大的插件，扩展性极强，而且插件能够完成的事情，安装一个软件显得有点浪费。

安装完插件，我们需要配置 git，参考[官方文档](http://www.sublimerge.com/sm3/docs/vcs-integration.html#git)配置：

```ini
[merge]
tool = sublimerge

[mergetool "sublimerge"]
cmd = subl -n --wait \"$REMOTE\" \"$BASE\" \"$LOCAL\" \"$MERGED\" --command \"sublimerge_diff_views\"
trustExitCode = false

[diff]
tool = sublimerge

[difftool "sublimerge"]
cmd = subl -n --wait \"$REMOTE\" \"$LOCAL\" --command \"sublimerge_diff_views {\\\"left_read_only\\\": true, \\\"right_read_only\\\": true}\"
```

最好顺便把`git diff`工具也配置了。

此时，我们解决冲突就可以使用`git mergetool`解决冲突了。如果我们配置正确，那么我们输入这个命令就会自动调出`sublime txt`编辑器，我们可以根据插件快捷键，快速解决冲突，此时我们需要再次提交一个解决冲突的版本。这样冲突就解决了。

#### 冲突文件

原生冲突到底长什么样呢？我们可以在冲突发生的时候，使用 vim 查看一下冲突文件：

```txt
dev
test dev

<<<<<<< HEAD # master分支状态
master
======= # 分隔符
>>>>>>> dev # dev分支状态
```

我们也可以根据自己的状态手动修改文件，比如我们只留下 master 分支的版本，我们需要额外手动删除这些 git 为我们生成的标识符。当然有时冲突非常复杂，所以就会有好多上面的那种代码块，所以还是建议使用工具解决冲突。

---

实际中的冲突解决还是非常复杂的，详细内容请阅读[官方文档](https://git-scm.com/book/zh/v2/Git-%E5%88%86%E6%94%AF-%E5%88%86%E6%94%AF%E7%9A%84%E6%96%B0%E5%BB%BA%E4%B8%8E%E5%90%88%E5%B9%B6)。最后还是提醒大家一句：不要擅自更改或丢弃别人的代码！

本系列文章使用`Gitbook`编写，并发布在 [http://gitstart.zcong.win](http://gitstart.zcong.win)
