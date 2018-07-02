---
title: 登录系统密码升级
date: '2017-08-15'
categories:
  - 安全
  - 逻辑
  - PHP
draft: false
---

> 由于工作的原因，没想到又开始使用PHP了。。。稍微说一下密码加密吧。

只要有登录系统，就会有密码加密。之前的加密惯用 md5，随着计算机性能的提高 md5 早已不是安全的加密算法了，比如某些网站就 md5 到源字符串查询的功能，简单的单词都可以查出来。当然，也有自造盐值 md5 加密，但是复杂度决定了它还是不够安全，为何不用 bcrypt 呢？虽然慢，但是网站的注册量并发量不会很大的，所以完全没压力。

当然，也有一个原因是维护一些远古时期的代码。其实，非常简单就可以替用户升级的。

<!--more-->

#### 学习WordPress

早先使用 WordPress 时，发现它既支持 md5 又支持 bcrypt，而且在数据库插入的 md5 密码，可以登录，但在登录之后会变成 bcrypt 加密，很好奇，而且之前工作迁移用户到 WordPress 时也修改了 WordPress 登录验证的代码。

其实很简单，WordPress 验证登录时，会先判断密码是不是 bcrypt 加密（简单来说，通过长度和前几位就可以判断），如果不是，会先被当做 md5 验证是否正确，如果正确，则用 bcrypt 加密，并更新数据库用户信息。

此处的逻辑更改为自己的加密逻辑就可以给用户一个更安全的体验了。

#### laravel框架该怎么做？

当然也是这种思路。开始我的想法是改写 laravel 的 Auth，最后感觉没有必要，这里只是 Hash 的工作，加一个自己的 Hash 就行了。


```php
// app/Libiraries/CustomHasher.php
<?php

namespace App\Libraries;
use App\User;
use Illuminate\Hashing\BcryptHasher;

class CustomHasher extends BcryptHasher
{
    // override check method
    public function check($value, $hashedValue, array $options = [])
    {
        if (!password_verify($value, $hashedValue)) {
            $user = User::wherePassword($hashedValue)->first();
            if ($user && $this->old_hash_check($value, $hashedValue)) {
                // password use old hash method, update it
                $user->password = \Hash::make($value);
                $user->save();
                return true;
            }
        }
        return password_verify($value, $hashedValue);
    }
    // old hash logic
    protected function old_hash_check($value, $stored_hash) {
        // your old check logic, return boolean
    }
}
```

接着我们需要写一个自己的`HashServiceProvider`，然后注册：

```php
// app/Providers/HashServiceProvider.php
<?php

namespace App\Providers;
use App\Libraries\CustomHasher;
use Illuminate\Hashing\HashServiceProvider as Provider;


class HashServiceProvider extends Provider
{
    public function register ()
    {
        $this->app->singleton('hash', function () {
            return new CustomHasher;
        });
    }

    public function provides ()
    {
        return ['hash'];
    }
}
```
```php
// config/app.php
<?php
...
'providers' => [
    // custom hash provider
    App\Providers\HashServiceProvider::class,
]
...
```
现在，我们自己的 Hash 会替代原来的工作，用户的密码会在第一次登录时被更新。
