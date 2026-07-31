# 发布流程

本项目以源码仓库分发（不发布 npm 包），发布物为带校验和的源码归档。版本号唯一来源是 `package.json` 的 `version`（`lib/version.mjs` 统一读取），遵循语义化版本，兼容政策见 [CHANGELOG.md](../CHANGELOG.md)「兼容政策」一节。

## 发布新版本

1. 确认 `master` 全绿：`npm run build && npm test`（CI 也必须通过）。
2. 更新 `CHANGELOG.md`：把 `[Unreleased]` 内容归入新版本号并写日期，同步更新文件底部的比较链接。
3. 修改 `package.json` 的 `version` 为新版本号（只改这一处，技能 / 插件的 `compatibleApp` 判定会自动跟随）。
4. 提交并打 tag：`git tag <version>`（如 `0.2.0`，与 `version` 字段完全一致，不加 `v` 前缀）。
5. 推送：`git push origin master --tags`。
6. 生成发布包与校验和：

   ```powershell
   node scripts/release.mjs
   ```

   产物在 `dist/`：`<name>-<version>.zip`（`git archive HEAD` 生成）与 `SHA256SUMS.txt`。脚本只打包已提交的 HEAD，工作区有未提交改动时会警告。
7. 在 GitHub 创建 Release：选择刚推送的 tag，把 zip 与 `SHA256SUMS.txt` 作为附件上传，正文粘贴 CHANGELOG 对应段落。
8. 用户侧校验下载完整性：`certutil -hashfile <zip> SHA256`（Windows）或 `shasum -a 256 <zip>`，与 `SHA256SUMS.txt` 比对。

## 升级

- 从源码升级：`git pull && npm ci && npm run build`，然后重启工作台。数据库 Schema 迁移是幂等、只增式的，启动时自动执行，旧库直接启动即可（见 CHANGELOG 兼容政策）。
- 从发布包升级：解压新包到新目录，`npm ci && npm run build`，把旧目录的 `data/`、`articles/`、`topics/`、`social-cards/`、`.env`、`config.local.json`、`account-context.json` 复制过去后启动。
- 升级前建议先在「设置与数据」页面导出一次备份。

## 降级

- 数据库迁移只增不回退：新版本打开过的数据库可能含有旧版本不认识的表 / 列。降级前必须恢复升级前的备份（旧版本不保证能读懂新库）。
- 降级步骤：停止服务 → 用升级前的备份包恢复（或重新克隆旧 tag 后复制数据目录）→ 启动旧版本。

## 备份与恢复

- 备份：「设置与数据」页面导出备份包，内含数据库快照、运行配置状态、技能包与插件目录；清单逐文件记录大小与 SHA-256（`schemaVersion: 1`）。
- 恢复：恢复是显式破坏性操作——服务端强制校验备份清单版本与逐文件哈希，恢复前自动保存当前快照，校验或恢复失败可回滚；界面需提交确认头才会执行。
- 手动兜底：停止服务后直接复制 `data/` 等运行目录；彻底删除数据则停止服务后删除上述目录与根目录 `.env`（LLM 与插件凭据不写入数据库）。
