# Scripts 目录说明

这里的脚本按运行入口、构建、质量治理、迁移/离线、视觉物料、发布和归档分目录管理。不是所有脚本都会在启动时执行；迁移和审计脚本通过显式命令或人工复验使用。

## 运行入口

| 文件 | 用途 |
| --- | --- |
| `runtime/setup.mjs` | `npm run setup` 的安装与环境初始化向导 |
| `runtime/check-env.mjs` | 工作台启动前环境检查，由 `runtime/start-workbench.*` 和 `runtime/setup.mjs` 调用 |
| `runtime/ensure-node.ps1` / `runtime/ensure-node.sh` | Windows 与 Linux/macOS 的 Node.js 引导 |
| `runtime/setup-workbench.ps1`、根目录 `setup-workbench.sh` | 跨平台安装入口 |
| `runtime/start-workbench.ps1` / `runtime/start-workbench.sh` | 跨平台启动入口 |
| `runtime/stop-workbench.ps1` / `runtime/stop-workbench.sh` | 跨平台停止入口 |
| `runtime/rsshub-start.ps1` / `runtime/rsshub-stop.ps1` | RSSHub 生命周期脚本，由 RSSHub 配置和采集器调用 |
| `runtime/install-skill-deps.mjs` | 根 `postinstall`，级联安装技能包依赖 |

## 构建、测试与持续校验

这些脚本有 `package.json`、CI、Git hook 或文档入口，不应按“没有业务代码 import”判断为废弃：

- `build/build.mjs`、`build/build-styles.mjs`、`build/test-fast.mjs`
- `quality/license-scan.mjs`、`quality/secret-scan.mjs`
- `quality/validate-skill-package.mjs`、`quality/validate-tool-plugin.mjs`、`quality/verify-plugin-distribution.mjs`
- `quality/audit-plugin-boundaries.mjs`、`quality/check-consumer-capability-gates.mjs`、`quality/check-legacy-configuration-guidance.mjs`
- `quality/snapshot-consumer-capability-baseline.mjs`、`quality/snapshot-plugin-boundary-baseline.mjs`、`quality/snapshot-tool-call-baseline.mjs`、`quality/snapshot-legacy-configuration.mjs`

常用入口见根目录 `package.json`，CI 还会直接执行许可证扫描、秘密扫描和示例包校验。

## 发布

- `release/release.mjs`：从当前 Git HEAD 生成发布包和 `SHA256SUMS.txt`，入口为 `npm run release`。

## 迁移与离线工具

这些脚本不属于日常启动链，但仍承担明确的一次性或按需运维职责：

- `migration/backfill-event-resolution.mjs`：事件解析历史产物回填，`npm run event-resolution:backfill`
- `migration/migrate-capability-routes.mjs`：旧信息槽位迁移，`npm run capability:migrate-routes`
- `migration/migrate-legacy-configuration.mjs`：旧配置迁移，`npm run config:migrate`
- `migration/replay-topic-score.mjs`：历史评分快照离线双跑，`npm run topic-score:replay`

迁移脚本不能从正常运行路径删除；完成迁移后仍需保留，直到确认所有存量工作区完成升级。

## 可重复的人工审计与物料生成

这些脚本不参与生产请求，但用于视觉复验或重新生成仓库展示物：

- `quality/audit-theme-contrast.mjs`
- `media/render-theme-review.mjs`
- `media/render-cover-samples.mjs`
- `media/render-demo-cover.mjs`
- `media/render-ui-shots.mjs`

它们属于开发工具，不属于废弃代码。输出通常写入 `output/` 或文档截图目录。

## 归档工具

- `archive/cold-start-acceptance.sh`：历史冷启动验收脚本。它用于一次性发布前验收，不再作为日常 CI 或启动入口。

## 目录边界

业务实现和插件内部实现不应继续放在这里。比如 URL 抓取 Python 实现位于 `plugins/url-fetch/scripts/`；根目录不保留重复副本。新增脚本应同时补充本索引，并在 `package.json`、CI 或对应文档中登记入口。
