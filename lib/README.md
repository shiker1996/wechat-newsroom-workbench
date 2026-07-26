# 服务端模块边界

`lib/` 只存放 Node.js 服务端代码；浏览器端代码统一位于 `public/src/`。

- `core/`：配置、环境变量、数据存储和工作目录。
- `domain/`：不依赖外部服务的业务规则与事实模型。
- `integrations/`：GitHub、Firecrawl、订阅和来源抓取等外部集成。
- `artifacts/`：产物索引、预览、压缩和备份。
- `jobs/`：非 AI 后台任务编排。
- `llm/`：模型网关、提示词、上下文管理，以及所有直接调用或编排 LLM 的流水线。

顶层 `server.mjs` 是 HTTP 服务入口，`collectors/` 是采集器适配层，`public/` 是客户端静态应用。
