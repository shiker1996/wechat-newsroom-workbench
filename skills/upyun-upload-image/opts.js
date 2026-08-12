function stripSlashes(s) {
  return String(s || '').replace(/^\/+|\/+$/g, '')
}

function normalizeDomain(domain) {
  // 去掉协议，保持与后续 URL 拼接一致
  return String(domain || '').replace(/^https?:\/\//, '').replace(/\/+$/g, '')
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const args = [...argv]
  const opts = {}
  let file

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        opts[key] = next
        i++
      } else {
        opts[key] = true
      }
      continue
    }
    if (!file) file = a
  }

  return { file, opts }
}

export function resolveUpyunConfig({ file, opts }) {
  const bucket = opts.bucket
  const operator = opts.operator
  const password = opts.password
  const domain = opts.domain ?? 'img.shiker.tech'
  const prefix = stripSlashes(opts.prefix ?? 'weedit')

  const inputFile = opts.file ?? file
  const contentType = opts.contentType ?? opts['content-type'] ?? undefined

  if (!inputFile) throw new Error('缺少图片路径：请传入 <path> 或使用 --file <path>')
  return { inputFile, bucket, operator, password, domain, prefix, contentType }
}

export function getImageExt(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  if (['png', 'jpg', 'gif', 'webp'].includes(ext)) return ext
  return 'jpg'
}

export function guessContentType(filePath, ext) {
  // 这里仅为兜底使用，具体 mime 可能更复杂；外部可通过 --content-type 覆盖。
  return `image/${ext === 'jpg' ? 'jpeg' : ext}`
}

export function normalizeContentType(explicitContentType, filePath, ext) {
  if (explicitContentType) return explicitContentType
  return guessContentType(filePath, ext)
}

export { normalizeDomain }

