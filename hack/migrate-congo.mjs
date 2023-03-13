import fs from 'fs'
import path from 'path'
import {globSync} from 'glob'
import fm from 'front-matter'

const files = globSync('./content/post/*.md')

for (const f of files) {
  const content = fs.readFileSync(f, 'utf-8')
  const fmm = fm(content)
  if (!fmm.attributes?.cover) {
    continue
  }
  const cover = fmm.attributes?.cover
  const bn = path.basename(f)
  const fn = path.join('./content/post', bn.replace(/\.md$/, ''))
  console.log(fn)
  // console.log(path.join(fn, `feature-${cover.replace(/^\//, '')}`))
  fs.mkdirSync(fn)
  fs.renameSync(f, path.join(fn, 'index.md'))
  fs.cpSync(path.join('assets', cover), path.join(fn, `feature-${cover.replace(/^\//, '')}`))
}
