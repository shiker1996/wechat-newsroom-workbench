# R5.4 大文件拆分实施记录

## 目标

让入口文件聚焦流程编排和路由注册，把稳定、可复用、可独立验证的职责移入边界清晰的模块，同时保持现有导出和调用方式兼容。

## 已实施

### 文章流水线

- 新增 `server/platform/llm/article-pipeline-contract.mjs`。
- 迁移规划结果归一化、阶段输出门禁、来源拼接与一致性检查、事实基座检查、写作技能路由、文章长度契约和初稿提示词构造。
- `article-pipeline.mjs` 保留模型调用、阶段顺序、返工和产物落盘，并重新导出原有公共 API，调用方无须迁移。

### 系统路由

- 新增 `server/platform/http/routes/system-restore-transactions.mjs`。
- 迁移写作技能和扩展包备份恢复的 staging、swap、commit、rollback 事务。
- `system-routes.mjs` 只负责识别恢复请求并编排事务。

### 主题管理前端

- 新增 `public/src/views/theme-manager-fields.js`。
- 迁移颜色角色、字段分组、选择项标签、目标名称和社交图文数值限制。
- `theme-manager.js` 保留视图状态、DOM 渲染、预览请求及交互绑定。

### Server 与社交图文流水线复核

- `server.mjs` 当前约 358 行，路由已由各 `server/platform/http/routes/*` 模块注册，继续拆分会削弱上下文可读性，因此本阶段不做机械拆分。
- `social-card-pipeline.mjs` 已把渲染职责交给 `social-card-rendering.mjs` 等模块；主文件保留流水线阶段控制，本阶段不重复迁移。

## 兼容性与依赖边界

- 文章流水线原公共导出保持不变。
- 新模块均为单向依赖：入口依赖子模块，子模块不反向依赖入口。
- 主题字段模块不访问 DOM，可在 Node 测试环境直接导入。
- 恢复事务模块不依赖 HTTP context，可独立测试提交和回滚。

## 验收

- 新增 `test/r5-large-file-splitting.test.mjs`，覆盖契约模块、恢复事务和主题字段元数据。
- 通过 Node 语法检查、定向测试和全量测试后视为完成。
