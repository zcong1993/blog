const fs = require('fs')

const argv = process.argv.slice(2)

if (argv.length < 1) {
  console.log(`node ./tools/complete-image-url.js [post] [type] [output]
  type: 1 gitee, 2 github, default blog`)
  process.exit(1)
}

let PUBLIC_URL
switch (argv[1]) {
  case '1':
    PUBLIC_URL = 'https://gitee.com/zcong1993/blog/raw/master/static'
    break
  case '2':
    PUBLIC_URL = 'https://github.com/zcong1993/blog/raw/master/static'
    break
  default:
    PUBLIC_URL = 'https://blog.cong.moe'
}

const write = argv[2]

const file = argv[0]
const content = fs.readFileSync(file, 'utf8')

const processedContent = content.replace(
  /(!\[.*\])\((.*)\)/g,
  `$1(${PUBLIC_URL}$2)`
)

if (write) {
  fs.writeFileSync(`${write}.md`, processedContent)
} else {
  console.log(processedContent)
}
