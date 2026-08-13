function stripSlashes(s) {
  return String(s || '').replace(/^\/+|\/+$/g, '')
}

function normalizeDomain(domain) {
  // 鍘绘帀鍗忚锛屼繚鎸佷笌鍚庣画 URL 鎷兼帴涓€鑷?
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

  if (!inputFile) throw new Error('缂哄皯鍥剧墖璺緞锛氳浼犲叆 <path> 鎴栦娇鐢?--file <path>')
  return { inputFile, bucket, operator, password, domain, prefix, contentType }
}

export function getImageExt(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  if (['png', 'jpg', 'gif', 'webp'].includes(ext)) return ext
  return 'jpg'
}

export function guessContentType(filePath, ext) {
  // 杩欓噷浠呬负鍏滃簳浣跨敤锛屽叿浣?mime 鍙兘鏇村鏉傦紱澶栭儴鍙€氳繃 --content-type 瑕嗙洊銆?
  return `image/${ext === 'jpg' ? 'jpeg' : ext}`
}

export function normalizeContentType(explicitContentType, filePath, ext) {
  if (explicitContentType) return explicitContentType
  return guessContentType(filePath, ext)
}

export { normalizeDomain }



