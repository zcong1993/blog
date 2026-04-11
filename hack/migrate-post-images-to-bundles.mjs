import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const CONTENT_POST_DIR = path.join(ROOT, 'content', 'post')
const STATIC_DIR = path.join(ROOT, 'static')

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i
const SKIP_URL_RE = /^(https?:)?\/\/|^data:|^#|^mailto:/i

function collectMarkdownFiles(dir) {
  const results = []
  const entries = fs.readdirSync(dir, {withFileTypes: true})

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_index.md') {
      results.push(fullPath)
    }
  }

  return results
}

const files = collectMarkdownFiles(CONTENT_POST_DIR)

let changedFiles = 0
let convertedToBundles = 0
let copiedImages = 0

function normalizePathSep(p) {
  return p.split(path.sep).join('/')
}

function tryCopyStaticAsset(staticRel, bundleDir) {
  const source = path.join(STATIC_DIR, staticRel)
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return null
  }

  const destRel = normalizePathSep(staticRel)
  const dest = path.join(bundleDir, destRel)
  fs.mkdirSync(path.dirname(dest), {recursive: true})

  if (!fs.existsSync(dest)) {
    fs.copyFileSync(source, dest)
    copiedImages += 1
  }

  return destRel
}

function updateBodyLinks(body, bundleDir) {
  let next = body

  // Markdown image links: ![alt](url)
  next = next.replace(/(!\[[^\]]*\]\()([^\)\s]+)(\))/g, (full, before, url, after) => {
    const raw = url.trim()
    if (SKIP_URL_RE.test(raw)) {
      return full
    }

    if (raw.startsWith('/')) {
      const clean = raw.replace(/^\//, '').split(/[?#]/)[0]
      const ext = path.extname(clean)
      if (!IMAGE_EXT_RE.test(ext)) {
        return full
      }
      const destRel = tryCopyStaticAsset(clean, bundleDir)
      if (!destRel) {
        return full
      }
      return `${before}${destRel}${after}`
    }

    return full
  })

  // HTML img tags: <img src="...">
  next = next.replace(/(<img[^>]*\ssrc=["'])([^"']+)(["'][^>]*>)/gi, (full, before, src, after) => {
    const raw = src.trim()
    if (SKIP_URL_RE.test(raw)) {
      return full
    }

    if (raw.startsWith('/')) {
      const clean = raw.replace(/^\//, '').split(/[?#]/)[0]
      const ext = path.extname(clean)
      if (!IMAGE_EXT_RE.test(ext)) {
        return full
      }
      const destRel = tryCopyStaticAsset(clean, bundleDir)
      if (!destRel) {
        return full
      }
      return `${before}${destRel}${after}`
    }

    return full
  })

  return next
}

function updateFrontMatter(frontMatter, bundleDir) {
  return frontMatter.replace(/^(cover\s*:\s*)(.+)$/m, (line, prefix, rawValue) => {
    const trimmed = rawValue.trim()

    const quote = trimmed.startsWith('"') && trimmed.endsWith('"')
      ? '"'
      : trimmed.startsWith("'") && trimmed.endsWith("'")
        ? "'"
        : ''

    const value = quote ? trimmed.slice(1, -1) : trimmed
    if (SKIP_URL_RE.test(value)) {
      return line
    }

    let staticRel = null

    if (value.startsWith('/')) {
      staticRel = value.replace(/^\//, '')
    } else if (IMAGE_EXT_RE.test(path.extname(value))) {
      // Keep compatibility for old entries such as: cover: docker-image.jpg
      staticRel = value
    }

    if (!staticRel) {
      return line
    }

    const clean = staticRel.split(/[?#]/)[0]
    if (!IMAGE_EXT_RE.test(path.extname(clean))) {
      return line
    }

    const destRel = tryCopyStaticAsset(clean, bundleDir)
    if (!destRel) {
      return line
    }

    const nextValue = quote ? `${quote}${destRel}${quote}` : destRel
    return `${prefix}${nextValue}`
  })
}

for (const originalFile of files) {
  const absFile = path.resolve(originalFile)
  const isBundle = path.basename(absFile) === 'index.md'

  const bundleDir = isBundle
    ? path.dirname(absFile)
    : path.join(path.dirname(absFile), path.basename(absFile, '.md'))

  let fileToWrite = absFile
  let content = fs.readFileSync(absFile, 'utf-8')

  if (!isBundle) {
    fs.mkdirSync(bundleDir, {recursive: true})
    const bundleIndex = path.join(bundleDir, 'index.md')
    fs.renameSync(absFile, bundleIndex)
    fileToWrite = bundleIndex
    content = fs.readFileSync(fileToWrite, 'utf-8')
    convertedToBundles += 1
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/)

  let next = content
  if (fmMatch) {
    const fmRaw = fmMatch[1]
    const body = content.slice(fmMatch[0].length)
    const nextFm = updateFrontMatter(fmRaw, bundleDir)
    const nextBody = updateBodyLinks(body, bundleDir)
    next = `---\n${nextFm}\n---\n\n${nextBody.replace(/^\n+/, '')}`
  } else {
    next = updateBodyLinks(content, bundleDir)
  }

  if (next !== content) {
    fs.writeFileSync(fileToWrite, next)
    changedFiles += 1
  }
}

console.log(`Processed markdown files: ${files.length}`)
console.log(`Converted to bundles: ${convertedToBundles}`)
console.log(`Updated markdown files: ${changedFiles}`)
console.log(`Copied images from static: ${copiedImages}`)
