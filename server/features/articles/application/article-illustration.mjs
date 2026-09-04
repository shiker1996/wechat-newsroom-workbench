import { planArticleVisuals, insertVisualFences } from '../llm/visual-planner.mjs';
import { planImagePlaceholders } from './image-workflow.mjs';

// 三类成稿链共用的配图编排：先自动配图（Mermaid/ECharts 围栏直接插入正文），
// 再规划必须由编辑手动提供的来源图/资料图占位。图表规划失败不阻断成稿，
// 只记录警告并继续手动配图规划。
export async function illustrateArticle({
  gateway, store, provider, batchId, candidateId = null, markdown, factBase = '',
  workspaceRoot = process.cwd(), maxOutputTokens = 5000, imageSkillPrompt = '',
  onProgress = () => {},
}) {
  let visualPlan = { summary:'', placements:[], rejections:[] };
  let output = String(markdown || '');
  try {
    visualPlan = await planArticleVisuals({
      gateway, provider, batchId, candidateId, markdown:output, factBase,
      workspaceRoot, maxOutputTokens,
    });
    if (visualPlan.placements.length) {
      output = insertVisualFences(output, visualPlan.placements);
      onProgress(`已自动插入 ${visualPlan.placements.length} 张 Mermaid/ECharts 图表`);
    }
  } catch (error) {
    onProgress(`图表自动配图失败，跳过该环节：${error.message}`);
  }
  output = await planImagePlaceholders({
    gateway, store, batchId, candidateId, provider, markdown:output,
    maxOutputTokens:Math.min(5000, maxOutputTokens), skillPrompt:imageSkillPrompt,
  });
  return { markdown:output, visualPlan };
}
