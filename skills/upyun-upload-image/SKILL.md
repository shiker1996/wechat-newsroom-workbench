---
name: upyun-upload-image
description: 在用户明确授权外部上传后，将本地 PNG、JPEG、GIF 或 WebP 图片上传到已配置的又拍云 S3 兼容存储，并以 JSON 返回 HTTPS URL 和对象键。适用于公众号预览所需的本地图片公网化或单独上传图片；不负责扫描文章、改写 Markdown、排版或发布，不得回显凭据。
---

# 又拍云图片上传

该技能会产生外部写入。只有用户明确要求上传、公网图片或复制页预览时执行。

## 前置

从环境变量读取 `UPYUN_BUCKET`、`UPYUN_OPERATOR`、`UPYUN_PASSWORD`、可选 `UPYUN_DOMAIN` 和 `UPYUN_PREFIX`。不要在命令参数、日志、文章或最终回复中传递或显示密码。目录中的本地 `.env` 若存在也视为敏感文件，不读取或回显其内容。

## 执行

```powershell
node upyun-upload-image.js <image-path>
```

上传前检查文件存在、非空且扩展名受支持。成功 stdout 必须是：

```json
{"success":true,"data":{"url":"https://...","key":"..."}}
```

失败时非零退出并返回不含凭据的错误。只有 `success: true`、URL 使用 HTTPS 且对象键非空时才更新调用方文档。

批量上传逐张执行并记录原路径到 URL 的映射；任一失败时保留原引用，不用占位 URL 伪装成功。上传后不自动删除本地文件。
