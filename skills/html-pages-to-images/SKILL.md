---
name: html-pages-to-images
description: 使用本地 Chromium/Puppeteer 将可信 HTML 文件中匹配 CSS 选择器的多个元素逐一截图为 PNG。适用于图表、卡片、页面或公众号内联模块批量转图，并由 wechat-inline-modules-to-images 或 wechat-echarts-blocks-to-images 间接调用。不上传图片、不改写 Markdown，不应渲染不可信 HTML。
---

# HTML 元素批量截图

只渲染来自当前任务或可信模板的本地 HTML。HTML 可执行脚本并加载远程资源，不要对未知来源文件使用本技能。

## 执行

```powershell
node index.js --htmlFile <input.html> --outputDir <output-dir> --selector <css-selector> --pageWidth 375 --pageHeight 667 --deviceScaleFactor 3
```

所有路径应显式传入，不依赖目录内的示例文件或默认 `output`。输出目录应位于当前任务工作目录，避免不同文章互相覆盖。

## 参数

- `htmlFile`：必填，本地 HTML
- `outputDir`：必填，PNG 输出目录
- `selector`：必填，只截图匹配元素
- `pageWidth/pageHeight`：CSS 视口尺寸
- `deviceScaleFactor`：默认 2–3，控制清晰度与内存

## 门禁

截图前确认选择器至少匹配一个元素。完成后确认图片数量等于匹配数、每个 PNG 非空、文件名唯一且输出尺寸合理。若字体、图表或远程资源未加载完成，等待明确的完成标志；超时则失败，不输出空白图冒充成功。

该技能只返回本地图片路径；公网化必须由单独上传技能在用户授权后执行。
