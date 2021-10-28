const fs = require('fs')

const argv = process.argv.slice(2)

if (argv.length < 1) {
  console.log('need one arg for process file!')
  process.exit(1)
}

const PUBLIC_URL = argv.length > 1 ? 'https://gitee.com/zcong1993/blog/raw/master/static' : 'https://blog.cong.moe'

const file = argv[0]
const content = fs.readFileSync(file, 'utf8')

const processedContent = content.replace(
  /(!\[.*\])\((.*)\)/g,
  `$1(${PUBLIC_URL}$2)`
)

console.log(processedContent)
