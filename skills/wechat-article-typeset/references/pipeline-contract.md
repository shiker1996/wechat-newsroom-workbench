# 项目排版流水线契约

## 规范阶段

阶段顺序固定为：

```text
rendered → design → images → draft → normalized → gate
```

| 阶段 ID | 执行技能 | 输入 | 规范输出 | 必须通过的门禁 |
|---|---|---|---|---|
| `rendered` | `wechat-md-render` | `09-FINAL.md` | `09-FINAL.rendered.md` | UTF-8、非空，正文和结构未丢失 |
| `design` | `magazine-design-advisor` | rendered | `09-FINAL.design-scheme.md`、`magazine-design-tokens.json` | 方案非空，tokens 符合 schema 1 |
| `images` | 总编排及条件转图子技能 | rendered、图片清单、tokens | `09-FINAL.images.md` | 正文未变化；未静默丢图；Mermaid/ECharts 围栏经确定性脚本转图，失败或无执行器的视觉模块必须阻断 |
| `draft` | `wechat-md-to-draft` | images、scheme、tokens | `article.ai.draft.html` | 标题、章节、链接和图片数量未减少。默认确定性渲染（按 tokens 直接输出内联样式，不调模型）；`draftMode: 'llm'` 为模型实验路径 |
| `normalized` | `wechat-html-normalizer` | draft | `article.ai.html` | 确定性初稿已是内联样式，直接采用；仅 llm 路径执行规范化脚本，要求脚本成功、内容完整 |
| `gate` | `wechat-html-check-no-div` | `article.ai.html` | 有效门禁结果 | `valid=true` |

## 设计 Tokens

`magazine-design-tokens.json` 使用以下最低结构：

```json
{
  "schema_version": 1,
  "colors": {
    "background": "#FFFFFF",
    "text": "#222222",
    "muted": "#666666",
    "accent": "#B42318"
  },
  "typography": {
    "body_px": 16,
    "line_height": 1.75,
    "h2_px": 24
  },
  "spacing": {
    "section_px": 28,
    "paragraph_px": 14
  },
  "image": {
    "radius_px": 0,
    "caption_px": 13
  }
}
```

颜色必须是六位十六进制；正文不得小于 15px。执行器可以把非法或越界值校正到安全默认值，但必须写入最终规范 tokens 文件。

## 最终 HTML 门禁

`article.ai.html` 必须同时满足：

- 文件非空并可按 UTF-8 读取
- 标题、主要章节、来源链接和图片未无故丢失
- 不含未处理的 Mermaid、ECharts 或支持的内联视觉模块
- 不含 `div`、`style`、脚本、事件属性或外部 stylesheet
- 读者可见样式已内联
- 正文流元素没有像素固定宽高
- 根级 `main`、`article` 或替代容器没有桌面居中固定外边距
- 不含审稿、SEO 或工作流内部报告

## 运行记录

每次排版写入：

```text
typeset-skill-manifest.json
typeset-stage-executions.json
```

阶段执行清单必须使用本契约规定的六个阶段 ID。技能清单必须记录项目内技能文件、内容哈希和 fallback 状态。

## 失败与外部操作边界

- 每一步先生成并验证当前阶段产物，再进入下一阶段。
- 不删除源 Markdown 或已经通过的上游产物。
- 失败时保留最后一个有效文件，并记录失败阶段及原因。
- 本契约没有外部预览或复制页阶段。
- 不自动上传图片、HTML 或未发布内容，不登录或发布到微信公众号。
