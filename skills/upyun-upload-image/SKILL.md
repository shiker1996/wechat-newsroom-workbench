---
name: upyun-upload-image
description: 在用户明确授权外部上传后，将本地 PNG、JPEG、GIF 或 WebP 图片上传到已配置的又拍云 S3 兼容存储，并以 JSON 返回 HTTPS URL 和对象键。适用于公众号预览所需的本地图片公网化或单独上传图片；不负责扫描文章、改写 Markdown、排版或发布，不得回显凭据。
---

# 又拍云图片上传

该技能会产生外部写入。只有用户明确要求上传、公网图片或复制页预览时执行。

## 前置

图片上传配置统一由工作台“系统与配置中心”的 `upyun-image-upload` 工具资源维护，并在调用 `image.cdn.upload` 时由工具运行时注入。技能不得读取项目或技能目录中的 `.env`，也不得直接读取 `UPYUN_*` 环境变量；日志、文章和最终回复不得显示凭据。

## 执行

```powershell
图片上传由 `image.cdn.upload` 工具能力执行。Bucket、域名与凭据统一在工作台“系统与配置中心”维护；技能不读取或回显凭据。配置未完成时工具返回 `needs_configuration`，请先完成“又拍云图片上传”配置。

仅用于工具适配器的底层脚本必须显式接收完整参数，不会读取 `.env`：

```bash
node upyun-upload-image.js <image-path> --bucket <bucket> --operator <operator> --password <password> --domain <domain> [--prefix uploads]
```
```

上传前检查文件存在、非空且扩展名受支持。成功 stdout 必须是：

```json
{"success":true,"data":{"url":"https://...","key":"..."}}
```

失败时非零退出并返回不含凭据的错误。只有 `success: true`、URL 使用 HTTPS 且对象键非空时才更新调用方文档。

批量上传逐张执行并记录原路径到 URL 的映射；任一失败时保留原引用，不用占位 URL 伪装成功。上传后不自动删除本地文件。
