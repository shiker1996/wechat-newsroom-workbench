# 产物契约

所有 Markdown 文件使用 UTF-8。每个阶段只读取已声明的上游产物，不依赖隐含聊天记忆。

## 目录

```text
articles/<topic-slug>/
  00-skill-manifest.json
  00-stage-executions.json
  00-article-brief.md
  01-personal-materials.md
  02-fact-base.json
  02-outline.md
  03-titles.md
  04-draft.md
  04-quality-gate.json
  05-humanized.md
  06-reviewed.md
  07-seo-keywords.md       # SEO 关闭时不存在
  08-seo-optimized.md      # SEO 关闭时不存在
  08-quality-gate.json
  09-FINAL.md
```

## 最低字段

### 00-skill-manifest.json / 00-stage-executions.json

技能清单记录总技能、写作子技能和阶段子技能的项目内文件、内容哈希与 fallback 状态。阶段执行清单严格使用 `runtime-stage-contracts.md` 声明的阶段顺序，记录输入、输出、执行技能和门禁结果。

### 00-article-brief.md

来自选题编排链时复制或引用其 `article-brief.md`；直接成稿时在本目录建立。至少包含：

- `brief_status: LOCKED`
- `candidate_id`（直接调用可省略）
- `experience_required: true|false`
- `decision_source: explicit-user|public-analysis`
- `final_readiness: WRITE_NOW`
- `topic`
- `locked_thesis`
- `target_reader`
- `reader_job`
- `distribution_lane: 推荐池|通知池|实验池`
- `reader_stake`
- `confirmed_public_facts`
- `confirmed_author_opinions`
- `confirmed_experiences`
- `counterevidence_and_limits`
- `final_package`
- `forbidden_claims`
- `remaining_gaps`

`experience_required: true` 时 `confirmed_experiences` 不得为空，并须记录材料或证据来源。`remaining_gaps` 中只要仍有会影响核心命题成立的项目，就不得标为 `LOCKED`。

### 01-personal-materials.md

- `topic`
- `angle`
- `article_brief_path`
- `brief_status: LOCKED`
- `experience_required: true|false`
- `audience`
- `distribution_lane: 推荐池|通知池|实验池`
- `reader_stake`
- `content_role: 拉新|沉淀|搜索`
- `expected_action`（1-2 个：评论、分享、收藏、关注或搜索）
- `practical_increment`
- `conversion_bridge`
- `follow_reason`
- `growth_fields_inferred: true|false`
- `inferred: true|false`
- `experience`
- `emotional_quote`
- `insider_context`
- `avoid`

保留用户原话时使用引用块；推断内容不得放进引用块。

### 02-outline.md

- `## 核心判断`
- `## 目标读者`
- `## 内容角色`
- `## 分发池与读者利益`
- `## 事实基座`
- `## 结构大纲`
- `## 信息增量`
- `## 实用增量`
- `## 增长承接`

事实基座每条记录：`id`、`claim`、`status`、`source_title`、`source_url`、`published_at`、`checked_at`。无 URL 的来源不能标为 `verified`，用户提供的内部材料除外；内部材料须标记为用户提供。

### 02-fact-base.json

保存根据锁定事实、作者观点和来源正文建立的结构化事实基座。每条 claim 包含 `claim`、`status`、`evidence`、`sourceUrl` 和 `boundary`；`status` 只能是 `verified`、`disputed`、`unverified` 或 `opinion`。

### 03-titles.md

- `core_keywords`
- `distribution_lane: 推荐池|通知池|实验池`
- `reader_stake`
- 候选标题及评分理由
- 唯一一行 `SELECTED_TITLE: ...`
- `writer_skill: ...`

### 04-draft.md / 05-humanized.md

第一行是唯一 H1 标题。正文引用事实时使用脚注、Markdown 链接或就近的来源括注，并保持全篇一致。

`04-quality-gate.json` 保存初稿语义门禁结果，不进入正文。

### 06-reviewed.md

先写可发布修订稿，再在文末 HTML 注释中记录审稿摘要，避免内部报告进入最终正文：

```markdown
<!-- REVIEW
result: pass|needs-revision
verified_facts: 0
citation_coverage: 100%
content_role: 拉新|沉淀|搜索
expected_action: 评论|分享|收藏|关注|搜索
practical_increment: pass|needs-revision
follow_reason: pass|needs-revision
conversion_bridge_status: verified|type-only|none|needs-revision
remaining_risks: none
-->
```

`conversion_bridge_status: verified` 只用于已提供真实标题或链接的具体推荐；只有后续内容类型、没有具体历史内容时使用 `type-only`。转化字段任一为 `needs-revision` 时，不得进入 SEO 或终稿阶段。

### 07-seo-keywords.md

记录核心词、评分、相关词、采用与弃用理由。该文件是报告，不进入终稿。

### 08-seo-optimized.md

只包含优化后的文章和可移除的 HTML 元数据注释，不添加 SEO 报告头。

`08-quality-gate.json` 保存终稿语义门禁结果，不进入最终正文。

### 09-FINAL.md

只包含读者可见的标题、正文、必要来源说明和手动配图占位符。不得包含工作流状态、评分、审稿意见或 SEO 分析。
