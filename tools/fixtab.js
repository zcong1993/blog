const fs = require('fs')

const argv = process.argv.slice(2)

if (argv.length < 1) {
  console.log('need one arg for process file!')
  process.exit(1)
}

const file = argv[0]

const content = fs.readFileSync(file, 'utf-8')

const newContent = content.replace(/\t/g, '  ')

console.log(newContent)

fs.writeFileSync(file, newContent)
