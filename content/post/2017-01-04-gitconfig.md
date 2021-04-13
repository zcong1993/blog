---
title: Git入门教程2-配置
date: '2017-01-04'
categories:
  - Git
draft: false
---

## 配置

---

上一节安装的结尾我们配置了两项信息：

```sh
$ git config --global user.name "your username"
$ git config --global user.email "your email"
```

也就是我们的用户名和邮箱，这也是我们信息的标识符，也就是 git 最基本的配置项。

<!--more-->

git 的配置以作用域划分可以分为`全局`和`单项目`，从配置方式可以分为`命令配置`和`修改文件`配置。

全局 git 配置文件就是我们个人用户目录下的`.gitconfig`文件，OSX 用户在`/Users/yourUsername`，Windows 则在`C:\用户\yourUsername`目录中。

单项目配置是我们项目目录下面的`.git/config`文件。

### 配置方式

- 文件配置

```ini
[user]
name = your username
email = your email
[color]
ui = auto
[alias]
ll = log --pretty=format:\"%h - %an, %ar : %s\"
pushos = push origin master
pullos = pull origin master
subpush = subtree push --prefix=app origin gh-pages
subpushd = subtree push --prefix=dist origin gh-pages
st = status
adda = add -A
comb = commit -m "make it better"
```

可以看到是一个`ini`文件，我们配置的用户名和邮箱信息出现在这里了。`user`是我们的用户信息，`color`是让 git 在终端高亮显示信息，`alias`则是我配置的指令别名，比如此时输入`git st`就是`git status`了，能够更方便快捷的使用 git 命令。需要增加配置时，在相应属性下面增加键值对就行。

- 命令配置

```sh
# git config 全局	属性.配置键 配置值
$ git config --global alias.st "status"
```

`--global`参数表示我们是全局配置，指令很简单。如果指令没有报错，我们就可以看到配置文件中相应的属性值改变或增加了。需要配置项目配置时，不要加`--global`参数，需要保证你在需要配置的项目文件夹下运行指令。

### 配置作用域

有时候我们需要在某些项目中有特殊需求，需要特别配置，这时我们如果改全局配置，使用完之后再把配置更改回去显得非常麻烦。好在 git 支持每个项目自定制配置。

几乎所有有配置文件的软件或者工具的配置生效都是`就近原则`，所以我们在项目中的特殊配置优先级才会更高。

项目中的配置文件是`.git/config`：

```ini
[core]
repositoryformatversion = 0
filemode = true
bare = false
logallrefupdates = true
ignorecase = true
precomposeunicode = true
[alias]
zc = status
```

**注意：**看到`core`这个关键字你也应该清楚这是这个项目的核心配置，git 根据项目状态生成的，所以我们**不要更改**，以免出现不必要的麻烦。

你也可以选择编辑或者命令配置。

---

这时，我相信你已经了解了 git 的配置了，所以赶快为你的常用指令定义别名来提高效率吧！

本系列文章使用`Gitbook`编写，并发布在 [http://gitstart.zcong.win](http://gitstart.zcong.win)
