import 'dotenv/config'
import fs from 'fs/promises'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import path from 'path'
import {
  parseCliArgs,
  resolveUpyunConfig,
  getImageExt,
  normalizeContentType,
  normalizeDomain,
} from './opts.js'

function toErrorMessage(err) {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  return err.message || String(err)
}

async function main() {
  const { file, opts } = parseCliArgs()
  const config = resolveUpyunConfig({ file, opts })
  const { inputFile, bucket, operator, password, domain, prefix, contentType } = config

  if (!bucket || !operator || !password) {
    console.log(
      JSON.stringify({
        success: false,
        message: '缺少 UPYUN 配置：需要 UPYUN_BUCKET / UPYUN_OPERATOR / UPYUN_PASSWORD（可用命令行参数覆盖）',
      }),
    )
    process.exitCode = 1
    return
  }

  const ext = getImageExt(inputFile)
  const finalContentType = normalizeContentType(contentType, inputFile, ext)

  const body = await fs.readFile(inputFile)
  const key = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`

  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://s3.api.upyun.com',
    credentials: { accessKeyId: operator, secretAccessKey: password },
    forcePathStyle: true,
  })

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: finalContentType,
      ACL: 'public-read',
    }),
  )

  const cleanDomain = normalizeDomain(domain)
  const url = `https://${cleanDomain}/${key}`

  console.log(JSON.stringify({ success: true, data: { url, key } }))
}

// 兼容 node 直接执行
main().catch((err) => {
  console.log(JSON.stringify({ success: false, message: toErrorMessage(err) }))
  process.exitCode = 1
})

