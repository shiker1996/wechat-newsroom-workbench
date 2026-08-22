# Social 图文模板严格渲染与新主题匹配：Phase 0 基线

状态：已完成

基线日期：2026-08-21

本阶段只盘点和验证，不修改模板回退、主题创建或历史数据。

## 1. 基线结论

1. 当前共有 5 个 Social 模板包：`standard-v1`、`neon-v1`、`brutalist-v1`、`editorial-v1`、`clean-v1`。
2. 除 `standard-v1` 外的 4 个专用模板都声明 `fallbackTemplate: standard-v1`。
3. 图文生成首轮布局审计失败时，管线会先执行模板级整组回退，再尝试安全构图、密度调整和内容修复。
4. AI 创建 Social 主题目前不会生成 `social.templatePack`；主题编辑器和 resolver 会把缺少模板包的主题按 `standard-v1` 处理。
5. 当前数据库有 73 条 Social 编辑会话，其中 72 条没有有效模板快照；这些是历史故事板，不做批量迁移。
6. 候选 787 已验证“请求专用模板、实际标准模板”的真实回退案例；候选 767 是迁移前产物，HTML 和主题快照没有模板包元数据。

## 2. 模板注册与回退链

| 模板包 | renderer | 当前自动回退 |
|---|---|---|
| `standard-v1` | `current-deterministic-renderer` | 无 |
| `neon-v1` | `neon-v1` | `standard-v1` |
| `brutalist-v1` | `brutalist-v1` | `standard-v1` |
| `editorial-v1` | `editorial-v1` | `standard-v1` |
| `clean-v1` | `clean-v1` | `standard-v1` |

当前触发顺序：

```text
专用模板首次布局审计
  ├─ valid=true → 保持专用模板
  └─ valid=false 且存在 fallbackTemplate
       → 整组切换 standard-v1
       → 再执行安全构图 / 密度调整 / 内容修复
```

相关实现：

- `lib/rendering/social-card-template-registry.mjs`
- `lib/llm/social-card-pipeline.mjs`
- `lib/rendering/social-card-template-resolver.mjs`

## 3. 新主题创建入口

| 入口 | 当前模板行为 | Phase 0 判断 |
|---|---|---|
| 复制内置主题 | 继承源主题 `social.templatePack` | 合理，保留 |
| AI 创建 Social 主题 | AI 只生成 Token、recipes、components；不生成模板包 | 需要增加程序匹配 |
| 导入 Social 主题 | 缺少模板包仍可保存，resolver 默认 `standard-v1` | 需要增加兼容提示/发布门禁 |
| 主题编辑器手动选择 | 可以从模板包目录选择并预览 | 保留，调整 standard 文案 |

当前用户 Social 主题共 7 个，均未绑定模板包：

```text
tool1
ai-social-771e4de7
ai-social-eecbb410
ai-social-715267e1
ai-social-1a3d39d0
ai-social-fabcd1f4
color-probe-2
```

当前实现中，`social.templatePack` 在主题校验层仍是可选字段，因此“自定义主题 Token + 标准模板”是合法路径。

## 4. 真实候选产物

### 候选 787

- 主题：`charcoal`
- 请求模板：`brutalist-v1`
- 实际模板：`standard-v1`
- HTML：`data-template-source="fallback"`
- 模板指标：`fallback=true`
- 最终布局审计：通过
- 额外处理：P4 安全构图、P4 expanded density

产物：

`social-cards/2026-08-19-6ca7ed6d35-c009/`

### 候选 767

- 主题：`ai-social-fabcd1f4`
- 主题为用户/AI 创建主题，当前定义没有模板包
- 主题快照没有模板包字段
- HTML 没有模板包元数据，属于迁移前产物
- 当前历史文件不做批量迁移

产物：

`social-cards/2026-08-18-d7896cd847-c005/`

## 5. 测试基线

执行了当前 Social 图文相关测试：

```text
test/social-card-p1.test.mjs
test/social-card-p2.test.mjs
test/social-card-storyboard-p0.test.mjs
test/social-card-template-phase1.test.mjs
test/social-card-template-phase2.test.mjs
test/social-card-template-phase3.test.mjs
test/social-card-template-phase4.test.mjs
test/social-card-template-phase5.test.mjs
test/social-card-template-phase6.test.mjs
```

结果：

```text
tests: 96
pass: 96
fail: 0
```

本阶段没有修改生产代码，`git diff --check` 无新增格式错误。

## 6. Phase 1 实施约束

- 不删除 `standard-v1` 注册、默认 resolver 和显式手动选择路径。
- 只取消专用模板失败后的自动整组回退。
- 严格模式失败时保留安全构图、密度调整和受控内容修复。
- 最终失败必须记录请求模板、失败页、审计问题和已尝试的修复轮次。
- 新建 Social 主题必须由程序产生模板匹配结果；AI 不直接写模板 ID。
- 历史故事板和已发布图文不做批量迁移。

