# 第三方材料清单（Third-Party Notices）

> 2026-07-31 首次盘点。本文件列出随仓库分发或被运行时引用的第三方材料及其许可证。项目自身代码按根目录 `LICENSE`（MIT）授权。

## 一、随仓库分发的第三方内容

| 材料 | 位置 | 来源 | 许可证 | 说明 |
|---|---|---|---|---|
| markdown-it | `public/vendor/markdown-it.min.js` | https://github.com/markdown-it/markdown-it | MIT | 许可文本已随附（`public/vendor/markdown-it.LICENSE`），min.js 头部保留 `@license` 注释 |
| humanizer-zh 技能 | `skills/humanizer-zh/` | [blader/humanizer](https://github.com/blader/humanizer)（经 [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh) 中文翻译） | MIT（上游，许可文本见 `skills/humanizer-zh/LICENSE`） | 内容模式源自维基百科 [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)（CC BY-SA 4.0），已在技能 LICENSE 中注明归属 |
| tokyo-night / solarized 配色命名与部分色值 | `skills/xiaohongshu-article-generator/DESIGN_SYSTEM.md` | [enkia/tokyo-night](https://github.com/enkia/tokyo-night)、[altercation/solarized](https://github.com/altercation/solarized) | MIT | 仅借用主题命名与色值，署名已写入该文件头部 |

## 二、运行时依赖（不随仓库分发，按各自许可证使用）

| 依赖 | 引入方式 | 许可证 |
|---|---|---|
| markdown-it | 根 `package.json` dependencies | MIT |
| @mermaid-js/mermaid-cli（含 puppeteer 25.x、mermaid 11.x 传递依赖） | 根 `package.json` devDependencies | MIT（puppeteer 为 Apache-2.0） |
| echarts | `skills/wechat-echarts-blocks-to-images/package.json` | Apache-2.0 |
| puppeteer | `skills/html-pages-to-images`、`skills/xiaohongshu-article-generator` | Apache-2.0 |
| @aws-sdk/client-s3、dotenv | `skills/upyun-upload-image/package.json` | Apache-2.0、BSD-2-Clause |
| Noto Sans SC 字体 | 渲染模板运行时从 Google Fonts 加载（不分发字体文件） | SIL OFL 1.1 |
| RSSHub | 本地外部服务（`RSSHub/` 为独立克隆，已被 `.gitignore` 排除，不随本仓库发布） | AGPL-3.0 |

## 三、明确不分发的内容

- `RSSHub/`：AGPL-3.0 copyleft，但它是独立运行的外部服务，未进 git 跟踪、未内嵌代码，AGPL 不传染本仓库。**不要**把 RSSHub 源码拷入本仓库或改为 submodule/subtree。
- `data/`：全部本地运行时数据（含可能存在的第三方技能安装包），`.gitignore` 整体排除。

## 四、其余部分

`plugins/`（7 个薄适配器）、`public/` 前端（除 vendor）、`docs/examples/`、其余全部技能均为项目原创，按根目录 MIT 许可证发布。前端运行时通过 Google Fonts 加载字体，不产生字体文件的再分发。
