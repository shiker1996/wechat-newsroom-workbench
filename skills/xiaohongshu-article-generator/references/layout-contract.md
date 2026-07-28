# 小红书图文布局契约

## 页面盒模型

```css
* { box-sizing: border-box; }
.page {
  width: 375px;
  height: 667px;
  overflow: hidden;
  position: relative;
}
.page-inner {
  width: 100%;
  height: 100%;
  padding: 28px 16px 34px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.page-body {
  min-height: 0;
  display: grid;
  align-items: center;
  overflow: hidden;
}
.page-body[data-valign="start"] { align-items: start; }
.page-content-stack {
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

`.page-inner` 必须恰好有三名直接布局子元素：header、main、footer。分隔线必须放进 header，不能成为第四个直接子元素，否则 CSS Grid 会生成隐式行，把正文推向页面下方。不要在 `.page-body` 上使用固定高度、伪元素占位、`space-between` 或 `transform:scale()`。

内容页默认 `data-valign="center"`。当内容栈超过正文可用高度的 90%，或居中后可能溢出时，使用 `data-valign="start"` 并优先拆页；不得用底部空白块修正视觉位置。

## 实测指标

审计以 `.page-body` 的 bounding box 为可用区域，以 `.page-content-stack` 内可见子元素（eyebrow、标题、内容块）的并集边界为已用区域——stack 自身可能带 `min-height` 等装饰性高度，直接测其边界会掩盖稀疏内容；装饰均为伪元素，不参与测量。居中页的上下留白差应不超过 `max(8px, 正文区高度的 3%)`；超出标记 `vertical_imbalance`。刻意顶部或底部锚定的构图（如 hero、data 及 `comp-align-start/end`）不做居中平衡要求。

| 页面类型 | 合理利用率 | 说明 |
|---|---:|---|
| `cover` | 45%–90% | 允许较多刻意留白 |
| `content` | 50%–96% | 真实内容至少占正文区一半 |
| `ending` | 20%–90% | CTA 或总结页以留白为设计意图 |

硬失败条件：

- `.page-body.scrollHeight > .page-body.clientHeight + 1`
- 可见后代超出 `.page-body` 或 `.page` 超过 1px
- 页面缺少 `.page-body` 或有效内容
- 正文小于 11px，辅助文字小于 9px

低于合理区间标记 `underfilled`，高于区间但尚未溢出标记 `overfilled`。

## 重排优先级

### 内容过多

1. 将最后一个完整原子块移到下一页
2. 按语义拆分步骤组、长列表或对比表
3. 删除重复说明和纯装饰组件
4. 将 gap 或 padding 每次最多缩小 2px
5. 最后才小幅调字号，正文不得低于 11px

### 内容不足

1. 与相邻同主题页面合并
2. 补充素材中已有的示例、限制条件、操作步骤或图示
3. 放大一个有价值的主视觉或数据组件
4. 允许封面和结尾保留有意留白

禁止用空白卡、无意义 emoji、重复卖点或 `space-between` 把少量内容撑满。

## 原子块

默认不可跨页：单张卡片、数据行、短引用、CTA、代码块、图片及其说明。列表、步骤组和长表格只有在拆分后仍保留标题和上下文时才能跨页。
