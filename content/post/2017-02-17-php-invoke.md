---
title: php __invoke
date: '2017-02-17'
categories:
  - PHP
  - 扯淡
draft: false
---

> php 类魔术方法`__invoke`, 当class定义此方法时，使用函数方式调用类的实例化时，此方法就会被调用。

<!--more-->

## 简单例子

```php
class Test
{
  public function __invoke()
  {
    echo 'invoke is called';
  }
}
$test = new Test;
$test();// invoke is called
var_dump(is_callable($test));// true
```
当我们以执行函数的方式执行`$test`时，可以看到`__invoke`方法被执行了，用`is_callable()`函数检测`$test`，返回是`true`，也证明了这一点。

### 带参数

```php
class Test
{
  public function __invoke($msg)
  {
    echo 'invoke is called,'.'msg is: '.$msg;
  }
}
$test = new Test;
$test();// invoke is called,msg is: msg shown
```

它就是一个正常函数。

## invoke和construct

```php
class Test
{
  protected $name;
  public function __construct($name)
  {
    $this->name = $name;
  }
  public function __invoke($msg)
  {
    echo 'invoke is called,'.'msg is: '.$msg.', name is: '.$this->name;
  }
}
$test = new Test('zcong');
$test('msg shown');// invoke is called,msg is: msg shown, name is: zcong
```

`construct`函数是在实例化时触发，而`invoke`是在调用时触发，所以`invoke`可以使用类的属性。

## 用途

### 1. 单例类

也就是说类只有一个方法，这时使用`__invoke`就可以像使用函数那样使用此方法了。但是仍然可以使用`继承`等类的属性；

### 2. 当做`get`方法使用

可以自定制类的`get`方法返回的信息，一般类的属性都是声明为`protected`，此时你可以根据情况，将不危险的属性暴露给用户。
