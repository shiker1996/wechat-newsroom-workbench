---
name: wechat-html-to-preview
description: 将已通过门禁的公众号 HTML 默认以 UTF-8 JSON POST 到用户自有的 edit.shiker.tech 预览服务，验证返回的 HTTPS 复制页 URL，并写入 wechat-preview-url.txt。适用于生成公众号复制页、预览链接或由 wechat-article-typeset 默认调用；支持 dry-run 仅做本地检查，不负责 Markdown 转换、规范化、图片上传或发布。
---

# 公众号 HTML 复制页预览

该技能的默认行为是把完整 HTML 发送到用户自有的 `edit.shiker.tech` 服务。调用本技能即视为允许生成预览；若只需本地检查，使用 `--dry-run`。

## 前置门禁

- `article.ai.html` 存在、非空且为 UTF-8
- 已通过 `wechat-html-check-no-div`
- 所有需要显示的图片使用可访问的 HTTPS URL
- 不包含密钥、私密材料或不应上传的内部注释

## 执行

```powershell
node scripts/html-to-preview.mjs article.ai.html
```

脚本默认向 `https://edit.shiker.tech/api/copy` 发送 `{ "html": "..." }`。可通过环境变量 `WECHAT_PREVIEW_ENDPOINT` 或 `--endpoint` 使用同协议的其它自有服务。

只做本地读取与前置检查、不发起网络请求：

```powershell
node scripts/html-to-preview.mjs article.ai.html --dry-run
```

成功条件：HTTP 成功、响应表示成功、`data.url` 是 HTTPS URL。成功后将 URL 以 UTF-8 无 BOM 写入同目录 `wechat-preview-url.txt`，文件仅一行。失败时非零退出，不创建或覆盖已有成功 URL 文件。

不要在日志中打印完整 HTML、响应令牌或敏感头。预览生成不等于发布到微信公众号。
