# 服务端模块边界

`server/` 只存放 Node.js 服务端代码；浏览器端代码统一位于 `public/src/`。顶层只允许 `features/`、`platform/`、`shared/`。

- `features/`：按业务能力垂直组织的入口与用例（当前已覆盖 `research/`、`social-cards/`、`articles/`、`collection/`、`batches/`）。
- `platform/`：平台基础设施，包含 `core/`、`http/`、`persistence/`、`jobs/`、`integrations/`、`artifacts/`、`llm/`、`skills/`、`tools/` 和插件运行时；jobs 与 Agent runtime 不承载业务编排。
- `shared/`：跨业务纯规则与输出基础，包含 `domain/`、`rendering/`、`themes/`；不得反向依赖具体业务入口。

采集模块有明确的内外边界：`platform/collectors/` 只放插件协议、注册和运行时；采集源服务、统一 Runner、Store 适配和静态页面助手位于 `features/collection/application/`。

顶层 `server.mjs` 是 HTTP 服务入口，内置采集器位于根目录 `plugins/`，`public/` 是客户端静态应用。
