# Social-card Phase 0 基线

> 状态：已完成  
> 范围：仅 `social-card` 主题与图文生成基线  
> 基线日期：2026-08-20  
> 运行时行为：本阶段未修改

## 1. Phase 0 交付物

- [social-card-phase0-capability-matrix.json](./social-card-phase0-capability-matrix.json)：角色、内容块、构图变体、主题 recipe、模板能力和回退规则。
- [social-card-phase0-2026-08-20](../archive/audits/social-card-phase0-2026-08-20/)：14 个内置 social 主题的固定样稿 HTML、PNG 截图、布局报告和生成清单。
- 本文档：测试基线、主题覆盖基线和已知问题。

## 2. 当前流程基线

当前 social-card 仍是：

```text
事实与编辑设置
  → AI 故事板
  → 故事板清洗/结构修复
  → 文案生成
  → role 推断与 composition 选择
  → 通用 storyboard HTML/CSS
  → 主题 Token/recipe 编译
  → 布局审计、密度调整和安全回退
```

当前还没有独立的主题模板注册表，也没有在故事板生成前注入模板能力约束。Phase 0 只冻结这个现状，不提前实现模板层。

## 3. 内置主题视觉基线

当前 social 主题共 14 个，固定样稿均为 5 页：封面、3 个内容页和结尾页。默认主题为 `ice-blue`。

| ID | 标签 | 版本 | surface | skeleton | frame | 页面 | 平均利用率 | 最低/最高利用率 | 审计问题 |
|---|---|---:|---|---|---|---:|---:|---:|---:|
| bone-white | 月白清灰 | 1.0.1 | palette | editorial-split | palette-frame | 5 | 68.0% | 33.9% / 81.4% | 0 |
| brutalist | 野兽派 | 1.0.0 | brutalist | impact-band | brutalist-frame | 5 | 71.9% | 47.1% / 81.4% | 0 |
| charcoal | 极简炭黑 | 1.0.1 | palette | impact-band | palette-frame | 5 | 68.4% | 43.0% / 79.7% | 0 |
| crimson | 赤焰硬核 | 1.0.1 | palette | impact-band | palette-frame | 5 | 68.4% | 43.0% / 79.7% | 0 |
| ice-blue | 冰川冷调 | 1.1.0 | base | stacked | soft-orbit | 5 | 69.0% | 44.3% / 79.7% | 0 |
| lavender | 芋泥暮色 | 1.1.0 | palette | stacked | palette-frame | 5 | 69.2% | 44.3% / 79.7% | 0 |
| mocha | 摩卡原木 | 1.0.1 | palette | stacked | palette-frame | 5 | 68.4% | 43.0% / 79.7% | 0 |
| neon | 霓虹终端 | 1.0.0 | neon | terminal-rail | neon-frame | 5 | 68.4% | 43.0% / 79.7% | 0 |
| orange | 落日橙界 | 1.0.1 | palette | impact-band | palette-frame | 5 | 70.0% | 45.0% / 80.0% | 0 |
| paper-craft | 纸艺暖调 | 1.0.1 | palette | paper-offset | palette-frame | 5 | 70.3% | 45.3% / 80.1% | 0 |
| peach | 雾桃白桃 | 1.1.0 | palette | stacked | palette-frame | 5 | 70.0% | 45.3% / 79.7% | 0 |
| retro-terminal | 复古终端 | 1.0.0 | palette | terminal-rail | palette-frame | 5 | 69.2% | 44.0% / 79.7% | 0 |
| solarized | 极光配色 | 1.0.1 | palette | editorial-split | palette-frame | 5 | 67.2% | 32.9% / 80.4% | 0 |
| tokyo-night | 东京之夜 | 1.0.1 | palette | terminal-rail | palette-frame | 5 | 70.0% | 45.0% / 80.0% | 0 |

说明：利用率来自固定主题样稿和真实浏览器布局审计，不代表真实仓库图文的最终密度。最低值通常来自结尾页，后续模板改造需要单独关注结尾页的视觉填充和行动承接。

## 4. 测试基线

执行命令：

```text
npm test
```

结果：

```text
tests: 1102
pass: 1100
fail: 2
cancelled: 0
skipped: 0
duration: 37.6s
```

### 当前失败项

| 测试 | 结果 | 原因 | 是否 Phase 0 引入 |
|---|---|---|---|
| `test/api-docs-routes.test.mjs` | fail | 代码存在 `POST /api/candidates/:param/card-pages/:param/ai`，API.md 尚未登记 | 否，当前工作树已有漂移 |
| `test/theme-production-preview.test.mjs` | fail | 图文固定样稿断言仍期待 `--page:#f9fcff`，当前主题编译输出格式/值已变化 | 否，当前工作树已有断言漂移 |

这两个失败需要在后续独立修复或明确基线豁免；Phase 0 不修改 API 文档、主题生产逻辑或文章/封面逻辑。

## 5. 基线结论

1. 当前已有 10 个页面语义 role、10 种渲染内容块和每个 role 两个 smart composition 变体，但它们仍由通用 renderer 统一输出。
2. 当前主题 recipe 能改变视觉表现，但不能独立声明每个 role 的页面结构和内容承载能力。
3. 固定主题样稿的布局审计全部通过，没有 overflow、clipped、horizontal overflow 或 overfilled；结尾页利用率最低，是下一阶段视觉模板重点。
4. 当前内容预算会对超量 block 和 list item 进行确定性裁剪，因此模板能力接入时必须优先做兼容校验，避免静默丢失事实。
5. 第一阶段模板实现应优先建立能力矩阵和回退链，不直接让 AI 输出 HTML/CSS。

## 6. Phase 0 后续约束

- 后续改动只能新增 social 模板能力，不得改变文章主题和封面主题行为。
- 新模板必须继续通过 `375×667` 固定画布和真实浏览器布局审计。
- 新模板必须记录版本、页面 role、模板 ID 和 fallback 状态。
- 故事板生成前应注入模板能力摘要；故事板生成后必须做兼容性校验。
- 不得为了适配模板静默删除事实点或内容块。
