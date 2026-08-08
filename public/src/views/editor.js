import { $, $$ } from "../core/dom.js";
import { request } from "../core/http.js";
import { escapeHtml, toast, providerOptions, withLoading, confirmAction, ensureModelOptions } from "../core/ui.js";
import { state } from "../core/state.js";
import { AUTOSAVE_DELAY_MS } from "../core/constants.js";

let markdownRenderer;
let ignoredScrollTarget = null;
let editorDirty = false;
let lastCandidateValue = "";
let lastDocKind = "draft";
let currentDocument = null;
let selectedRevision = null;
let autoSaveTimer = null;
let saveSequence = 0;
let editGeneration = 0;
let visualPlan = null;

// 自定义撤销/重做栈：替代已废弃的 document.execCommand。
// 输入事件按时间窗合并快照（每 800ms 至多入栈一次），工具栏/替换等程序化修改在改动前入栈。
const undoStack = [];
const redoStack = [];
let lastEditorValue = "";
// 标题输入框上一次同步时的值：仅当正文 H1 与之相同才联动改写，避免覆盖用户刻意不同的 H1
let lastTitleValue = "";
let lastSnapshotAt = 0;
const HISTORY_LIMIT = 100;
const HISTORY_SNAPSHOT_MS = 800;

function pushHistory(value) {
  if (value === undefined || undoStack[undoStack.length - 1] === value) return;
  undoStack.push(value);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function resetHistory(value) {
  undoStack.length = 0;
  redoStack.length = 0;
  lastEditorValue = value;
}

function applyHistoryCommand(command) {
  const from = command === "undo" ? undoStack : redoStack;
  const to = command === "undo" ? redoStack : undoStack;
  if (!from.length) { toast(command === "undo" ? "没有可撤销的操作" : "没有可重做的操作"); return; }
  const editor = document.getElementById("markdown-editor");
  to.push(editor.value);
  editor.value = from.pop();
  lastEditorValue = editor.value;
  markDocumentDirty();
  renderMarkdown();
}

function setFocusMode(enabled,{persist=true}={}) {
  document.body.classList.toggle("editor-focus",enabled);
  const button=document.getElementById("editor-focus-mode");
  if(button){
    button.setAttribute("aria-pressed",String(enabled));
    button.textContent=enabled?"退出专注":"专注模式";
    button.title=enabled?"退出专注模式（Esc）":"进入专注模式";
  }
  if(persist)try{localStorage.setItem("editor-focus-mode",enabled?"on":"off");}catch{}
}

function setSaveState(stateValue,message) {
  const node=document.getElementById("document-save-state");
  if(!node)return;
  node.className=`document-save-state ${stateValue}`;
  node.textContent=message;
}

function clearAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer=null;
}

function markDocumentDirty() {
  editorDirty=true;
  editGeneration+=1;
  clearAutoSave();
  renderPreflightSummary();
  if(selectedDocKind()!=="draft"){setSaveState("dirty","未保存 · 终稿需手动保存");return;}
  setSaveState("dirty","未保存 · 即将自动保存");
  const candidateId=String(document.getElementById("writing-candidate")?.value||"");
  autoSaveTimer=setTimeout(()=>{
    if(!editorDirty||selectedDocKind()!=="draft"||String(document.getElementById("writing-candidate")?.value||"")!==candidateId)return;
    saveDocument({automatic:true}).catch(()=>{});
  },AUTOSAVE_DELAY_MS);
}

function confirmDiscardEdits() {
  if (!editorDirty) return true;
  return confirmAction("当前文稿有未保存的修改，切换后将丢失。仍要切换吗？", { confirmText: "放弃修改并切换" });
}

function getMarkdownRenderer() {
  if (markdownRenderer) return markdownRenderer;
  if (typeof window.markdownit !== "function") return null;

  markdownRenderer = window.markdownit({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });
  const defaultLinkOpen = markdownRenderer.renderer.rules.link_open
    || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  markdownRenderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
  return markdownRenderer;
}

function markdownHtml(text) {
  if (!text.trim()) return '<p class="markdown-empty">在左侧输入 Markdown，预览会实时显示在这里。</p>';
  const renderer = getMarkdownRenderer();
  if (renderer) return renderer.render(text);
  return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

function renderVisualPlan() {
  const summary=document.getElementById("visual-plan-summary");
  const list=document.getElementById("visual-plan-list");
  if(!summary||!list)return;
  summary.textContent=visualPlan ? `${visualPlan.summary}${visualPlan.themeLabel?` · 图表主题：${visualPlan.themeLabel}`:""}` : "终稿确认后，可在这里检查哪些段落值得用图表达。";
  const items=visualPlan?.placements||[];
  document.getElementById("visual-planner")?.classList.toggle("has-results",Boolean(items.length));
  list.innerHTML=items.length?items.map((item)=>`<article class="visual-plan-card" data-visual-id="${escapeHtml(item.id)}" data-kind="${item.type.toUpperCase()}">
    <h4>${escapeHtml(item.purpose||item.afterHeading)}</h4>
    <div class="visual-plan-meta"><span>插入到「${escapeHtml(item.afterHeading)}」</span><span class="${item.complexity?.mobileReady?"mobile-ready":"mobile-warning"}">${item.complexity?.mobileReady?"移动端可读":escapeHtml(item.complexity?.warning||"需要精简")}</span>${(item.sourceRefs||[]).map((ref)=>"<span>"+escapeHtml(ref)+"</span>").join("")}</div>
    <p>${escapeHtml(item.reason||"将复杂关系改为更易扫读的视觉表达")}</p>
    <textarea class="visual-code-editor" data-visual-code="${escapeHtml(item.id)}" spellcheck="false">${escapeHtml(item.code)}</textarea>
    <div class="visual-preview-frame" data-visual-preview="${escapeHtml(item.id)}"><span>点击预览生成主题化图片</span></div>
    <div class="visual-plan-actions"><button type="button" class="ghost-button" data-ignore-visual="${escapeHtml(item.id)}">忽略</button><button type="button" class="ghost-button" data-preview-visual="${escapeHtml(item.id)}">预览</button><button type="button" class="ghost-button" data-insert-visual="${escapeHtml(item.id)}">插入文章</button></div>
  </article>`).join(""):`<div class="image-stage-empty">${escapeHtml(visualPlan?.rejections?.length?visualPlan.summary:"当前文章没有必须增加的图表，保持文字表达即可。")}</div>`;
}

async function previewVisual(id) {
  const item=visualPlan?.placements?.find((entry)=>entry.id===id);
  const card=document.querySelector(`[data-visual-id="${CSS.escape(id)}"]`);
  if(!item||!card)return;
  const code=card.querySelector("[data-visual-code]")?.value.trim()||"";
  const result=await request("/api/visual-preview",{method:"POST",body:JSON.stringify({type:item.type,code,theme:visualPlan?.theme})});
  item.code=code;
  item.fence=`\`\`\`${item.type}\n${code}\n\`\`\``;
  item.complexity=result.complexity||item.complexity;
  item.previewedCode=code;
  const preview=card.querySelector("[data-visual-preview]");
  if(preview)preview.innerHTML=`<img src="${result.image}" alt="${escapeHtml(item.purpose||item.type)} 预览">`;
}

async function planVisuals() {
  const candidateValue=String(document.getElementById("writing-candidate")?.value||"");
  const daily=candidateValue==="daily";
  const candidateId=Number(candidateValue);
  if(!daily&&!candidateId)return toast("请先选择文章");
  const content=document.getElementById("markdown-editor")?.value||"";
  if(!content.trim())return toast("文章内容为空");
  const provider=document.getElementById("draft-provider")?.value||state.models?.defaultProvider;
  visualPlan=await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/visual-plan`,{
    method:"POST",body:JSON.stringify({provider,candidateId:daily?null:candidateId,documentKind:daily?"daily-final":null,content}),
  });
  renderVisualPlan();
}

function insertVisual(id) {
  const item=visualPlan?.placements?.find((entry)=>entry.id===id);
  const editor=document.getElementById("markdown-editor");
  if(!item||!editor)return;
  const editedCode=document.querySelector(`[data-visual-id="${CSS.escape(id)}"] [data-visual-code]`)?.value.trim();
  if(editedCode){
    if(item.type==="mermaid"&&!/^(?:flowchart\s+(?:TB|LR)|sequenceDiagram|stateDiagram-v2)\b/i.test(editedCode))return toast("Mermaid 支持流程图、时序图和状态图");
    if(item.type==="echarts"){try{JSON.parse(editedCode);}catch{return toast("ECharts 配置必须是严格 JSON");}}
    item.code=editedCode;item.fence=`\`\`\`${item.type}\n${editedCode}\n\`\`\``;
  }
  if(item.previewedCode!==item.code)return toast("请先预览当前代码，通过移动端复杂度门禁后再插入");
  if(item.complexity&&!item.complexity.mobileReady)return toast(`移动端复杂度门禁未通过：${item.complexity.warning}`);
  if(editor.value.includes(item.fence))return toast("该图表已经插入文章");
  const escaped=item.afterHeading.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const heading=new RegExp(`^(#{1,3})\\s+${escaped}\\s*$`,"m").exec(editor.value);
  if(!heading)return toast(`未找到章节「${item.afterHeading}」`);
  const sectionStart=heading.index+heading[0].length;
  const rest=editor.value.slice(sectionStart);
  const next=/\n#{1,3}\s+/.exec(rest);
  const insertAt=next?sectionStart+next.index:editor.value.length;
  pushHistory(editor.value);
  editor.value=`${editor.value.slice(0,insertAt).trimEnd()}\n\n${item.fence}\n${editor.value.slice(insertAt)}`;
  lastEditorValue=editor.value;markDocumentDirty();renderMarkdown();
  const card=document.querySelector(`[data-visual-id="${CSS.escape(id)}"]`);
  card?.classList.add("inserted");
  card?.querySelector("[data-insert-visual]")?.setAttribute("disabled","");
  toast("图表围栏已插入文章，请检查后保存终稿");
  recordVisualDecision(item,"inserted");
}

function recordVisualDecision(item,action) {
  const value=String(document.getElementById("writing-candidate")?.value||"");
  request("/api/visual-decisions",{method:"POST",body:JSON.stringify({
    batchId:state.activeBatchId,candidateId:value==="daily"?null:Number(value),
    visualType:item.type,action,heading:item.afterHeading,purpose:item.purpose,
  })}).catch(()=>{});
}

function ignoreVisual(id) {
  const item=visualPlan?.placements?.find((entry)=>entry.id===id);
  const card=document.querySelector(`[data-visual-id="${CSS.escape(id)}"]`);
  if(!item||!card)return;
  recordVisualDecision(item,"ignored");
  card.remove();
  toast("已忽略该建议，后续推荐会参考这个选择");
}

function scrollProgress(element) {
  const distance = element.scrollHeight - element.clientHeight;
  return distance > 0 ? element.scrollTop / distance : 0;
}

function syncScroll(source, target) {
  if (ignoredScrollTarget === source) return;
  const targetDistance = target.scrollHeight - target.clientHeight;
  ignoredScrollTarget = target;
  target.scrollTop = scrollProgress(source) * Math.max(0, targetDistance);
  requestAnimationFrame(() => {
    if (ignoredScrollTarget === target) ignoredScrollTarget = null;
  });
}

function setupSynchronizedScrolling() {
  const editor = document.getElementById("markdown-editor");
  const preview = document.getElementById("markdown-preview");
  if (!editor || !preview || editor.dataset.scrollSyncBound === "true") return;
  editor.dataset.scrollSyncBound = "true";
  editor.addEventListener("scroll", () => syncScroll(editor, preview), { passive: true });
  preview.addEventListener("scroll", () => syncScroll(preview, editor), { passive: true });
}

function visibleChars(markdown) {
  return String(markdown || "")
    .replace(/```(?:mermaid|echarts)\b[\s\S]*?```/gi, "")
    .replace(/^```[^\r\n]*$/gm, "")
    .replace(/^#.*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[-#>]\s?/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s/g, "")
    .length;
}

function renderMarkdown() {
  const editor = document.getElementById("markdown-editor");
  const preview = document.getElementById("markdown-preview");
  if (!editor || !preview) return;
  preview.innerHTML = markdownHtml(editor.value);
  requestAnimationFrame(() => syncScroll(editor, preview));
  const count = visibleChars(editor.value);
  const cc = document.getElementById("char-count");
  // 字数计数与写作目标同口径（此前分母是门禁上限 2000，与“目标 1,500 字”并列显示互相矛盾）
  if (cc) cc.textContent = count + " / " + currentWritingGoal().toLocaleString("zh-CN");
  renderDocumentOutline(editor.value);
  renderWritingStats(editor.value);
  renderQualitySummary(editor.value);
}

function qualityIssues(markdown) {
  const text=String(markdown||""),issues=[],headings=markdownHeadings(text);
  if(text.trim()&&!headings.some((item)=>item.level===1))issues.push({type:"结构",message:"缺少一级标题",offset:0});
  const seen=new Map();let previousLevel=0;
  headings.forEach((heading,index)=>{
    const key=heading.text.trim().toLocaleLowerCase();
    if(seen.has(key))issues.push({type:"结构",message:`标题重复：${heading.text}`,offset:heading.offset});
    else seen.set(key,heading.offset);
    if(previousLevel&&heading.level>previousLevel+1)issues.push({type:"结构",message:`标题层级从 H${previousLevel} 跳到 H${heading.level}`,offset:heading.offset});
    previousLevel=heading.level;
    if(heading.level>=2){
      const start=text.indexOf("\n",heading.offset),end=headings[index+1]?.offset??text.length;
      if(visibleChars(text.slice(start<0?end:start+1,end))<10)issues.push({type:"空章节",message:`章节“${heading.text}”缺少正文`,offset:heading.offset});
    }
  });
  let searchOffset=0;
  text.split(/\n\s*\n/).forEach((paragraph)=>{
    const offset=text.indexOf(paragraph,searchOffset);searchOffset=Math.max(searchOffset,offset+paragraph.length);
    if(!/^#{1,6}\s/m.test(paragraph)&&visibleChars(paragraph)>300)issues.push({type:"可读性",message:`段落过长（${visibleChars(paragraph)} 字），建议拆分`,offset:Math.max(0,offset)});
  });
  if(visibleChars(text)>=300&&!/https?:\/\/\S+/.test(text))issues.push({type:"来源",message:"正文尚未包含任何来源链接",offset:0});
  return issues;
}

function renderQualitySummary(markdown) {
  const issues=qualityIssues(markdown),count=document.getElementById("quality-issue-count");
  if(count){count.textContent=String(issues.length);count.classList.toggle("clear",issues.length===0);}
  if(document.getElementById("quality-dialog")?.open)renderQualityIssues(issues);
  renderPreflightSummary(markdown);
}

function preflightChecks(markdown=document.getElementById("markdown-editor")?.value||"") {
  const stats=writingStatistics(markdown),goal=currentWritingGoal(),issues=qualityIssues(markdown);
  const title=document.getElementById("article-title")?.value.trim()||"";
  const kind=selectedDocKind();
  return [
    {id:"save",label:"保存状态",pass:!editorDirty&&Boolean(currentDocument),detail:!currentDocument?"当前文稿尚未保存":editorDirty?"仍有修改等待保存":"当前内容已安全保存",action:"保存"},
    {id:"goal",label:"写作目标",pass:stats.chars>=goal,detail:`${stats.chars.toLocaleString("zh-CN")} / ${goal.toLocaleString("zh-CN")} 字`,action:"设置目标"},
    {id:"quality",label:"内容质量",pass:issues.length===0,detail:issues.length?`有 ${issues.length} 项结构或可读性建议`:"未发现明显质量问题",action:"查看问题"},
    {id:"final",label:"终稿门禁",pass:kind==="final"&&Boolean(title)&&stats.chars>=articleLengthLimit.min&&stats.chars<=articleLengthLimit.max,detail:kind!=="final"?"当前仍是草稿":!title?"缺少文章标题":stats.chars===0?"正文为空":stats.chars>articleLengthLimit.max?`超过 ${articleLengthLimit.max} 字上限（当前 ${stats.chars} 字）`:stats.chars<articleLengthLimit.min?`不足 ${articleLengthLimit.min} 字下限（当前 ${stats.chars} 字）`:"终稿格式与字数符合要求",action:"检查终稿"},
  ];
}

function renderPreflightSummary(markdown) {
  const badge=document.getElementById("preflight-status-count");
  if(!badge)return;
  const checks=preflightChecks(markdown),pending=checks.filter((item)=>!item.pass).length;
  badge.textContent=String(pending);badge.classList.toggle("clear",pending===0);
  if(document.getElementById("preflight-dialog")?.open)renderPreflight();
}

function renderPreflight() {
  const checks=preflightChecks(),pending=checks.filter((item)=>!item.pass);
  document.getElementById("preflight-title").textContent=pending.length?"发布前还有待处理项":"当前文稿已准备就绪";
  document.getElementById("preflight-summary").textContent=pending.length?`${checks.length-pending.length} 项通过 · ${pending.length} 项待处理`:`${checks.length} 项检查全部通过`;
  document.getElementById("preflight-list").innerHTML=checks.map((item)=>`<button type="button" class="preflight-item ${item.pass?"pass":"pending"}" data-preflight-action="${item.id}" ${item.pass?"disabled":""}><i>${item.pass?"✓":"!"}</i><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></span>${item.pass?"":`<em>${escapeHtml(item.action)} →</em>`}</button>`).join("");
  const primary=document.getElementById("preflight-primary");
  primary.textContent=pending.length?"处理第一项":"完成检查";
  primary.dataset.preflightAction=pending[0]?.id||"close";
}

function openPreflight() {
  renderPreflight();
  document.getElementById("preflight-dialog").showModal();
}

function handlePreflightAction(action) {
  const dialog=document.getElementById("preflight-dialog");
  if(action==="close"){dialog.close();return;}
  dialog.close();
  if(action==="save"){saveDocument().catch((error)=>toast(error.message));return;}
  if(action==="goal"){openWritingGoal();return;}
  if(action==="quality"){openQualityCheck();return;}
  if(action==="final"){
    const finalRadio=document.querySelector('input[name="doc-kind"][value="final"]');
    if(finalRadio&&selectedDocKind()!=="final"){finalRadio.checked=true;loadSelectedDocument().catch((error)=>toast(error.message));}
    else document.getElementById("article-title")?.focus();
  }
}

function renderQualityIssues(issues=qualityIssues(document.getElementById("markdown-editor").value)) {
  document.getElementById("quality-summary").textContent=issues.length?`发现 ${issues.length} 项可改进内容。点击问题可定位正文。`:"未发现明显的结构或可读性问题。";
  document.getElementById("quality-issue-list").innerHTML=issues.length?issues.map((issue,index)=>`<button type="button" data-quality-index="${index}" data-quality-offset="${issue.offset}"><span>${escapeHtml(issue.type)}</span><b>${escapeHtml(issue.message)}</b></button>`).join(""):'<div class="quality-clear">当前文稿检查通过</div>';
}

function openQualityCheck() {
  renderQualityIssues();
  document.getElementById("quality-dialog").showModal();
}

function jumpToQualityIssue(button) {
  const editor=document.getElementById("markdown-editor"),offset=Number(button.dataset.qualityOffset);
  document.getElementById("quality-dialog").close();
  editor.focus();editor.setSelectionRange(offset,offset);
  // 与 jumpToHeading 同一精确实现：镜像元素测量实际换行高度，长段落不再跑偏
  editor.scrollTop=Math.max(0,textareaTextOffsetTop(editor,offset)-editor.clientHeight*.18);
}

function writingStatistics(markdown) {
  const chars=visibleChars(markdown);
  const paragraphs=String(markdown||"").split(/\n\s*\n/).filter((block)=>{
    const text=block.replace(/^#{1,6}\s+.*$/gm,"").replace(/```[\s\S]*?```/g,"").trim();
    return visibleChars(text)>=10;
  }).length;
  const headings=markdownHeadings(markdown).filter((item)=>item.level>=2);
  let complete=0;
  for(let index=0;index<headings.length;index+=1){
    const start=String(markdown).indexOf("\n",headings[index].offset);
    const end=headings[index+1]?.offset??String(markdown).length;
    if(visibleChars(String(markdown).slice(start<0?end:start+1,end))>=50)complete+=1;
  }
  return {chars,paragraphs,minutes:chars?Math.max(1,Math.ceil(chars/400)):0,sections:headings.length,complete};
}

function writingGoalKey() {
  const candidate=document.getElementById("writing-candidate")?.value||"none";
  return `writing-goal:${state.activeBatchId||"none"}:${candidate}:${selectedDocKind()}`;
}

function currentWritingGoal() {
  try{
    const value=Number(localStorage.getItem(writingGoalKey()));
    if(value>=200&&value<=10000)return value;
  }catch{}
  return selectedDocKind()==="final"?1600:1500;
}

function renderWritingStats(markdown) {
  const stats=writingStatistics(markdown);
  document.getElementById("stat-chars").textContent=stats.chars.toLocaleString("zh-CN");
  document.getElementById("stat-paragraphs").textContent=String(stats.paragraphs);
  document.getElementById("stat-reading-time").textContent=`${stats.minutes} 分钟`;
  const sections=document.getElementById("stat-sections");
  sections.textContent=stats.sections?`${stats.complete} / ${stats.sections}`:"尚无章节";
  sections.classList.toggle("complete",stats.sections>0&&stats.complete===stats.sections);
  sections.title=stats.sections?`正文达到 50 个可见字符的章节：${stats.complete}/${stats.sections}`:"使用二级或三级标题建立文章章节";
  const goal=currentWritingGoal(),progress=Math.min(100,Math.round(stats.chars/goal*100));
  document.getElementById("stat-goal").textContent=`${progress}%`;
  document.getElementById("stat-goal-label").textContent=`目标 ${goal.toLocaleString("zh-CN")} 字`;
  document.getElementById("writing-stats").style.setProperty("--goal-progress",`${progress}%`);
}

function openWritingGoal() {
  document.getElementById("writing-goal-input").value=String(currentWritingGoal());
  document.getElementById("writing-goal-dialog").showModal();
  requestAnimationFrame(()=>document.getElementById("writing-goal-input").select());
}

function saveWritingGoal(event) {
  event.preventDefault();
  const value=Math.round(Number(document.getElementById("writing-goal-input").value));
  if(value<200||value>10000)return toast("目标字数需要在 200 到 10,000 之间");
  try{localStorage.setItem(writingGoalKey(),String(value));}catch{}
  document.getElementById("writing-goal-dialog").close();
  renderWritingStats(document.getElementById("markdown-editor").value);
  toast("写作目标已更新");
}

function markdownHeadings(markdown) {
  const headings=[];let offset=0,inFence=false;
  for(const line of String(markdown||"").split("\n")){
    if(/^```/.test(line.trim()))inFence=!inFence;
    const match=!inFence&&/^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if(match)headings.push({level:match[1].length,text:match[2].replace(/[*_`[\]]/g,""),offset});
    offset+=line.length+1;
  }
  return headings;
}

function renderDocumentOutline(markdown) {
  const list=document.getElementById("document-outline-list");
  if(!list)return;
  const headings=markdownHeadings(markdown);
  list.innerHTML=headings.length?headings.map((item,index)=>`<button type="button" data-outline-index="${index}" data-outline-offset="${item.offset}" class="level-${item.level}" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</button>`).join(""):'<p>添加一级至三级标题后，将在这里生成导航。</p>';
}

function textareaTextOffsetTop(editor,offset) {
  const style=getComputedStyle(editor);
  const mirror=document.createElement("div");
  mirror.setAttribute("aria-hidden","true");
  Object.assign(mirror.style,{
    position:"fixed",visibility:"hidden",pointerEvents:"none",left:"-10000px",top:"0",
    boxSizing:style.boxSizing,width:`${editor.clientWidth}px`,height:"auto",
    padding:style.padding,border:style.border,font:style.font,letterSpacing:style.letterSpacing,
    lineHeight:style.lineHeight,whiteSpace:"pre-wrap",overflowWrap:"break-word",wordBreak:style.wordBreak,
  });
  mirror.append(document.createTextNode(editor.value.slice(0,offset)));
  const marker=document.createElement("span");
  marker.textContent="\u200b";
  mirror.append(marker,document.createTextNode(editor.value.slice(offset)||"\u200b"));
  document.body.append(mirror);
  const top=marker.offsetTop;
  mirror.remove();
  return top;
}

function jumpToHeading(button) {
  const editor=document.getElementById("markdown-editor"),offset=Number(button.dataset.outlineOffset);
  editor.focus();editor.setSelectionRange(offset,offset);
  editor.scrollTop=Math.max(0,textareaTextOffsetTop(editor,offset)-editor.clientHeight*.18);
  const preview=document.getElementById("markdown-preview");
  const target=preview.querySelectorAll("h1,h2,h3")[Number(button.dataset.outlineIndex)];
  if(target)preview.scrollTop=Math.max(0,preview.scrollTop+target.getBoundingClientRect().top-preview.getBoundingClientRect().top-24);
  document.querySelectorAll("#document-outline-list button").forEach((item)=>item.classList.toggle("active",item===button));
}

function setOutlineVisible(visible) {
  document.getElementById("view-editor").classList.toggle("outline-hidden",!visible);
  const button=document.getElementById("editor-outline-toggle");
  button.setAttribute("aria-pressed",String(visible));button.textContent=visible?"收起大纲":"展开大纲";
  try{localStorage.setItem("editor-outline-visible",visible?"on":"off");}catch{}
}

function selectedDocKind() {
  const el = document.querySelector("input[name=doc-kind]:checked");
  return el?.value || "draft";
}
function isDailyDocument() { return document.getElementById("writing-candidate")?.value==="daily"; }
function storageDocKind() { return isDailyDocument()?`daily-${selectedDocKind()}`:selectedDocKind(); }

function setWritingDeskAvailability(available) {
  const view=document.getElementById("view-editor");
  if(!view)return;
  view.classList.toggle("writing-desk-empty",!available);
  const selectors=[
    "#article-title","#save-document","#document-find","#document-history",
    "#draft-provider","#draft-instructions","#ai-draft",
    ".markdown-toolbar button","#markdown-editor","#writing-goal-open"
  ];
  view.querySelectorAll(selectors.join(",")).forEach((control)=>{control.disabled=!available;});
  view.querySelectorAll('input[name="doc-kind"]').forEach((control)=>{control.disabled=!available;});
  const editor=document.getElementById("markdown-editor");
  if(editor)editor.placeholder=available?"# 标题\n\n从这里开始写作……":"请先从热点全景创建选题，并在文章编辑室锁定候选";
}

async function loadWritingDesk() {
  try{setFocusMode(localStorage.getItem("editor-focus-mode")==="on",{persist:false});}catch{}
  try{setOutlineVisible(localStorage.getItem("editor-outline-visible")!=="off");}catch{}
  setupSynchronizedScrolling();
  await ensureModelOptions();
  const draftProv = document.getElementById("draft-provider");
  if (draftProv && state.models) draftProv.innerHTML = providerOptions(state.models.providers.find((p) => p.configured)?.name || state.models.defaultProvider);
  const batch = state.batches.find((b) => b.id === state.activeBatchId);
  if (!batch) return;
  const [candidates, documents] = await Promise.all([
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/documents`),
  ]);
  state.candidates = candidates.filter(
    (item) => item.brief_status === "LOCKED" || (item.brief_status == null && item.status === "locked")
  );
  state.documents = documents;
  const dailyFinal=documents.find((item)=>item.kind==="daily-final"&&item.candidate_row_id==null);
  const select = document.getElementById("writing-candidate");
  if (!select) return;
  const writingOptions=[
    ...(dailyFinal?[`<option value="daily">早报 · ${escapeHtml(dailyFinal.title||"批次早报")}</option>`]:[]),
    ...state.candidates.map((item) => `<option value="${item.id}">${escapeHtml(item.candidate_id)} · ${escapeHtml(item.hotspot_title)}</option>`),
  ];
  select.innerHTML = writingOptions.length
    ? writingOptions.join("")
    : '<option value="">没有已锁定候选</option>';
  select.disabled = !writingOptions.length;
  if(select.value==="daily"){
    const finalRadio=document.querySelector('input[name="doc-kind"][value="final"]');
    if(finalRadio)finalRadio.checked=true;
  }
  setWritingDeskAvailability(Boolean(writingOptions.length));
  const ctxEl = document.getElementById("draft-context");
  if (ctxEl) ctxEl.innerHTML = writingOptions.length
    ? "事实、观点、禁写项不会被压缩"
    : '当前没有可编辑文稿。<a class="primary-button editor-empty-primary" href="#overview">前往热点全景创建选题</a><small>创建后请在文章编辑室锁定候选，再返回这里写作。</small>';
  await loadSelectedDocument();
}

async function loadSelectedDocument() {
  visualPlan=null;
  renderVisualPlan();
  const candidateValue=document.getElementById("writing-candidate")?.value;
  const candidateId = Number(candidateValue);
  const daily=candidateValue==="daily";
  const kind = selectedDocKind();
  if (!candidateId&&!daily) {
    currentDocument = null;
    editorDirty = false;
    clearAutoSave();
    const titleEl = document.getElementById("article-title");
    const editor = document.getElementById("markdown-editor");
    if (titleEl) titleEl.value = "";
    lastTitleValue = "";
    if (editor) { editor.value = ""; renderMarkdown(); }
    resetHistory(editor?.value || "");
    setSaveState("saved","等待锁定候选");
    renderPreflightSummary("");
    lastCandidateValue = "";
    lastDocKind = kind;
    return;
  }
  let docResult = null;
  try {
    docResult = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/documents?candidateId=${daily?"daily":candidateId}&kind=${daily?`daily-${kind}`:kind}`);
  } catch (error) {
    toast(`文稿加载失败，已保留当前内容：${error.message}`);
    return;
  }
  currentDocument = docResult?.id ? docResult : null;
  const candidate = daily?null:state.candidates.find((item) => item.id === candidateId);
  const titleEl = document.getElementById("article-title");
  const editor = document.getElementById("markdown-editor");
  if (titleEl) titleEl.value = docResult?.title || candidate?.hotspot_title || "";
  lastTitleValue = titleEl?.value || "";
  if (editor) {
    editor.value = docResult?.content || (candidate ? `# ${candidate.hotspot_title}\n\n` : "");
    renderMarkdown();
  }
  resetHistory(editor?.value || "");
  editorDirty = false;
  clearAutoSave();
  setSaveState("saved",docResult?.updated_at?`已保存 · ${new Date(docResult.updated_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}`:"尚未保存");
  renderPreflightSummary(editor?.value||"");
  lastCandidateValue = daily?"daily":String(candidateId || "");
  lastDocKind = kind;
}

function lineDiff(oldText, newText) {
  const oldLines=String(oldText||"").split("\n"),newLines=String(newText||"").split("\n");
  const out=[];
  for(let i=0;i<Math.max(oldLines.length,newLines.length);i+=1){
    if(oldLines[i]===newLines[i]) out.push(`  ${oldLines[i]??""}`);
    else { if(oldLines[i]!==undefined) out.push(`- ${oldLines[i]}`); if(newLines[i]!==undefined) out.push(`+ ${newLines[i]}`); }
  }
  return out.join("\n");
}

function openFindDialog() {
  const dialog=document.getElementById("find-dialog"),editor=document.getElementById("markdown-editor");
  const selected=editor.value.slice(editor.selectionStart,editor.selectionEnd);
  if(selected&&!selected.includes("\n"))document.getElementById("find-text").value=selected;
  if(!dialog.open)dialog.showModal();
  requestAnimationFrame(()=>document.getElementById("find-text").focus());
}

function findNext() {
  const editor=document.getElementById("markdown-editor"),needle=document.getElementById("find-text").value;
  const result=document.getElementById("find-result");
  if(!needle){result.textContent="输入要查找的内容";return false;}
  const sensitive=document.getElementById("find-case-sensitive").checked;
  const haystack=sensitive?editor.value:editor.value.toLocaleLowerCase();
  const query=sensitive?needle:needle.toLocaleLowerCase();
  let index=haystack.indexOf(query,editor.selectionEnd);
  let wrapped=false;
  if(index<0){index=haystack.indexOf(query);wrapped=true;}
  if(index<0){result.textContent="未找到匹配内容";return false;}
  editor.focus();editor.setSelectionRange(index,index+needle.length);
  const before=haystack.slice(0,index),position=before.split(query).length;
  const total=haystack.split(query).length-1;
  result.textContent=`第 ${position} / ${total} 处${wrapped?" · 已从开头继续":""}`;
  return true;
}

function replaceOne() {
  const editor=document.getElementById("markdown-editor"),needle=document.getElementById("find-text").value;
  if(!needle)return findNext();
  const selected=editor.value.slice(editor.selectionStart,editor.selectionEnd);
  const sensitive=document.getElementById("find-case-sensitive").checked;
  if((sensitive?selected:selected.toLocaleLowerCase())!==(sensitive?needle:needle.toLocaleLowerCase())&&!findNext())return;
  pushHistory(editor.value);
  editor.setRangeText(document.getElementById("replace-text").value,editor.selectionStart,editor.selectionEnd,"end");
  lastEditorValue=editor.value;markDocumentDirty();renderMarkdown();findNext();
}

async function replaceAll() {
  const editor=document.getElementById("markdown-editor"),needle=document.getElementById("find-text").value;
  if(!needle)return;
  const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const matcher=new RegExp(escaped,document.getElementById("find-case-sensitive").checked?"g":"gi");
  const matches=editor.value.match(matcher);
  if(!matches?.length){document.getElementById("find-result").textContent="未找到匹配内容";return;}
  if(!await confirmAction(`将把 ${matches.length} 处匹配全部替换，可用工具栏「撤销」回退，也建议先保存版本。是否继续？`,{confirmText:"全部替换"}))return;
  let count=0;
  pushHistory(editor.value);
  editor.value=editor.value.replace(matcher,()=>{count+=1;return document.getElementById("replace-text").value;});
  document.getElementById("find-result").textContent=count?`已替换 ${count} 处`:"未找到匹配内容";
  if(count){lastEditorValue=editor.value;markDocumentDirty();renderMarkdown();}
}

function applyMarkdownCommand(command) {
  const editor=document.getElementById("markdown-editor");
  editor.focus();
  if(command==="undo"||command==="redo"){
    applyHistoryCommand(command);return;
  }
  pushHistory(editor.value);
  const start=editor.selectionStart,end=editor.selectionEnd,value=editor.value,selected=value.slice(start,end);
  let replacement=selected,nextStart=start,nextEnd=end;
  if(command==="bold"){
    replacement=`**${selected||"加粗文字"}**`;nextStart=start+2;nextEnd=start+replacement.length-2;
  }else if(command==="link"){
    replacement=selected?`[${selected}](https://)`:"[链接文字](https://)";
    const urlStart=start+replacement.lastIndexOf("https://");nextStart=urlStart;nextEnd=urlStart+8;
  }else{
    const lineStart=value.lastIndexOf("\n",Math.max(0,start-1))+1;
    const lineEnd=value.indexOf("\n",end);
    const block=value.slice(lineStart,lineEnd<0?value.length:lineEnd);
    const lines=block.split("\n");
    const prefix=command==="heading"?"## ":command==="quote"?"> ":command==="unordered-list"?"- ":"";
    replacement=command==="ordered-list"?lines.map((line,index)=>`${index+1}. ${line}`).join("\n"):lines.map((line)=>prefix+line).join("\n");
    editor.setRangeText(replacement,lineStart,lineEnd<0?value.length:lineEnd,"select");
    lastEditorValue=editor.value;markDocumentDirty();renderMarkdown();return;
  }
  editor.setRangeText(replacement,start,end,"select");
  editor.setSelectionRange(nextStart,nextEnd);
  lastEditorValue=editor.value;markDocumentDirty();renderMarkdown();
}

async function openDocumentHistory() {
  if (!currentDocument) return toast("当前文稿尚未保存，没有版本历史");
  const revisions=await request(`/api/documents/${currentDocument.id}/revisions`);
  document.getElementById("revision-list").innerHTML=revisions.length?revisions.map((item,index)=>`<button class="revision-item" data-revision-id="${item.id}"><b>${index===0?"当前保存版":"历史版本"}</b><span>${new Date(item.created_at).toLocaleString("zh-CN")}</span><small>${item.visible_chars} 字 · ${item.reason==="initial"?"初始保存":"手动保存"}</small></button>`).join(""):'<p class="muted">还没有保存版本</p>';
  selectedRevision=null;
  document.getElementById("revision-diff").textContent="";
  document.getElementById("restore-revision").disabled=true;
  document.getElementById("revision-dialog").showModal();
}

async function selectRevision(id) {
  selectedRevision=await request(`/api/documents/${currentDocument.id}/revisions/${id}`);
  document.getElementById("revision-summary").textContent=`与编辑器当前内容对比 · ${new Date(selectedRevision.created_at).toLocaleString("zh-CN")}`;
  document.getElementById("revision-diff").textContent=lineDiff(selectedRevision.content,document.getElementById("markdown-editor").value);
  document.getElementById("restore-revision").disabled=false;
}

async function restoreRevision() {
  if(!selectedRevision)return;
  if(!await confirmAction("恢复后会覆盖编辑器当前内容，但恢复结果仍会保存为新版本，可继续回退。",{confirmText:"确认恢复"}))return;
  await request(`/api/documents/${currentDocument.id}/revisions/${selectedRevision.id}/restore`,{method:"POST",body:"{}"});
  document.getElementById("revision-dialog").close();
  await loadSelectedDocument();
  toast("已恢复历史版本");
}

async function saveDocument({automatic=false}={}) {
  const candidateValue=document.getElementById("writing-candidate")?.value;
  const candidateId = Number(candidateValue);
  const daily=candidateValue==="daily";
  if (!candidateId&&!daily) return toast("请先选择一篇文稿");
  const content = document.getElementById("markdown-editor")?.value || "";
  const kind = selectedDocKind();
  if (kind === "final") {
    const chars = visibleChars(content);
    // 字数只警告不拦截：超限可在编辑器手动删减
    if (chars > articleLengthLimit.max) toast(`终稿超过 ${articleLengthLimit.max} 可见字符（当前 ${chars}），建议删减后再发布`);
    else if (chars < articleLengthLimit.min) toast(`终稿不足 ${articleLengthLimit.min} 可见字符（当前 ${chars}），建议补充后再发布`);
  }
  // title 统一以正文 H1 为准（与成稿链、封面口径一致）；无 H1 时保留输入框值
  const h1 = content.split("\n").find((line) => line.startsWith("# "))?.slice(2).trim();
  const title = h1 || document.getElementById("article-title")?.value || "";
  const titleEl = document.getElementById("article-title");
  if (h1 && titleEl && titleEl.value !== h1) { titleEl.value = h1; lastTitleValue = h1; }
  const sequence=++saveSequence;
  const savingGeneration=editGeneration;
  clearAutoSave();
  setSaveState("saving",automatic?"自动保存中…":"保存中…");
  try {
    const docResult = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/documents`, {
      method: "PUT",
      body: JSON.stringify({ candidateId:daily?null:candidateId, kind:daily?`daily-${kind}`:kind, title, content, status: kind === "final" ? "finalized" : "draft" }),
    });
    if(sequence!==saveSequence)return docResult;
    currentDocument=docResult;
    if(savingGeneration===editGeneration){
      editorDirty=false;
      setSaveState("saved",`${automatic?"已自动保存":"已保存"} · ${new Date(docResult.updated_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}`);
    }else{
      editorDirty=true;
      setSaveState("dirty","有新修改 · 即将自动保存");
    }
    renderPreflightSummary(content);
    if(!automatic)toast(`已保存 ${docResult.file_path}`);
    return docResult;
  } catch(error) {
    if(sequence===saveSequence){editorDirty=true;setSaveState("error","保存失败 · 点击重试");}
    if(!automatic)throw error;
    toast(`自动保存失败：${error.message}`);
    throw error;
  }
}

async function aiDraft() {
  const candidateId = Number(document.getElementById("writing-candidate")?.value);
  if (!candidateId) return toast("先在编辑室锁定文章简报");
  const provider = document.getElementById("draft-provider")?.value || state.models?.defaultProvider;
  const button = document.getElementById("ai-draft");
  if (button) { button.disabled = true; button.textContent = "模型创作中…"; }
  try {
    const existing = document.getElementById("markdown-editor")?.value || "";
    const instructions = document.getElementById("draft-instructions")?.value.trim() || "";
    const result = await request(`/api/candidates/${candidateId}/ai/draft`, {
      method: "POST",
      body: JSON.stringify({ provider, instructions, existingDraft: existing }),
    });
    const editor = document.getElementById("markdown-editor");
    if (editor) { pushHistory(editor.value); editor.value = result.content; lastEditorValue = editor.value; }
    markDocumentDirty();
    renderMarkdown();
    const ctx = document.getElementById("draft-context");
    if (ctx) ctx.textContent = `${result.provider} · ${result.model} · 输入约 ${result.context.afterTokens} tokens${result.context.compressed ? " · 已压缩历史上下文" : " · 未触发压缩"} · 尚未保存`;
    toast("模型结果已放入编辑器，请审阅后保存");
  } catch (err) { toast(err.message); }
  finally { if (button) { button.disabled = false; button.textContent = "AI 起草"; } }
}


async function pollJob(id) {
  clearTimeout(state.jobTimer);
  try {
    const job = await request(`/api/jobs/${id}`);
    const logs = job.logs ?? [{ at: job.updated_at || new Date().toISOString(), message: job.progress }];
    const output = logs.map((l) => `${l.at.slice(11, 19)}  ${l.message}`).join("\n") || job.progress;
    for (const sel of ["#job-console", "#production-job-console"]) {
      const node = document.querySelector(sel);
      if (node) { node.textContent = output; node.scrollTop = node.scrollHeight; }
    }
    if (job.status === "running") {
      state.jobTimer = setTimeout(() => pollJob(id), 1200);
    } else {
      toast(job.status === "completed" ? (job.type === "article" ? "完整成稿链已完成" : job.type === "typeset" ? "公众号排版 HTML 已完成" : "AI 打标完成") : `任务失败：${job.error || "未取得有效结果"}`);
      if (job.status === "completed" && job.type === "typeset") {
        document.dispatchEvent(new CustomEvent("typeset:completed", { detail: { job } }));
      }
    }
  } catch (err) { toast(err.message); }
}

async function runTypeset() {
  const candidateValue=document.getElementById("typeset-candidate")?.value;
  const daily=candidateValue==="daily";
  const candidateId = Number(candidateValue);
  if (!candidateId&&!daily) return toast("请先选择一篇终稿");
  const provider = document.getElementById("typeset-provider")?.value || state.models?.defaultProvider;
  const theme = document.getElementById("typeset-theme")?.value || "auto";
  try {
    const result = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/ai/typeset`, {
      method: "POST", body: JSON.stringify({ provider, candidateId:daily?null:candidateId, documentKind:daily?"daily-final":null, theme }),
    });
    toast("排版任务已启动");
    // 排版任务数分钟：打开进度弹窗，避免页面上无任何可见反馈
    document.getElementById("production-job-dialog")?.showModal();
    if (result?.id) pollJob(result.id);
  } catch (err) { toast(err.message); }
}

// batch-drawer 的成稿完成跳转依赖该桥接
window.loadSelectedDocument = loadSelectedDocument;
// 成稿链完成后的自动跳转桥接：切换到编辑器并打开指定候选的终稿
window.loadWritingDeskForCandidate = async (candidateId) => {
  const select = document.getElementById("writing-candidate");
  if (!select) return;
  const hasOption = [...select.options].some((option) => option.value === String(candidateId));
  if (!hasOption) await loadWritingDesk();
  if (candidateId == null || ![...select.options].some((option) => option.value === String(candidateId))) return;
  const finalRadio = document.querySelector('input[name="doc-kind"][value="final"]');
  if (finalRadio && !finalRadio.checked) finalRadio.checked = true;
  select.value = String(candidateId);
  await loadSelectedDocument();
};

let bound = false;
function bindEditor() {
  if (bound) return;
  bound = true;
  document.getElementById("writing-candidate").addEventListener("change", async (event) => {
    if (!await confirmDiscardEdits()) { event.target.value = lastCandidateValue; return; }
    loadSelectedDocument().catch((error) => toast(error.message));
  });
  $$("input[name=doc-kind]").forEach((item) => item.addEventListener("change", async () => {
    if (!await confirmDiscardEdits()) {
      const previous = document.querySelector(`input[name=doc-kind][value="${lastDocKind}"]`);
      if (previous) previous.checked = true;
      return;
    }
    loadSelectedDocument().catch((error) => toast(error.message));
  }));
  document.getElementById("markdown-editor").addEventListener("input", () => {
    const now=Date.now();
    if(now-lastSnapshotAt>HISTORY_SNAPSHOT_MS){pushHistory(lastEditorValue);lastSnapshotAt=now;}
    lastEditorValue=document.getElementById("markdown-editor").value;
    markDocumentDirty(); renderMarkdown();
  });
  document.getElementById("article-title").addEventListener("input", () => {
    markDocumentDirty();
    const title = document.getElementById("article-title").value;
    const content = document.getElementById("markdown-editor").value;
    if (content.startsWith("# ")) {
      const sep = content.indexOf("\n");
      const currentH1 = content.slice(2, sep >= 0 ? sep : undefined);
      // 仅当 H1 与标题原本一致时才联动，用户刻意改过的 H1 不再被静默覆盖
      if (currentH1 === lastTitleValue) {
        document.getElementById("markdown-editor").value = "# " + title + (sep >= 0 ? content.slice(sep) : "\n\n");
      }
    }
    lastTitleValue = title;
    renderMarkdown();
  });
  document.getElementById("save-document").addEventListener("click", () => saveDocument().catch((error) => toast(error.message)));
  document.getElementById("document-save-state").addEventListener("click", (event) => {
    if (!event.currentTarget.classList.contains("error")) return;
    saveDocument().catch((error) => toast(error.message));
  });
  document.getElementById("document-history").addEventListener("click",()=>openDocumentHistory().catch((error)=>toast(error.message)));
  document.getElementById("document-find").addEventListener("click",openFindDialog);
  document.querySelector("[data-close-find]").addEventListener("click",()=>document.getElementById("find-dialog").close());
  document.getElementById("find-next").addEventListener("click",findNext);
  document.getElementById("replace-one").addEventListener("click",replaceOne);
  document.getElementById("replace-all").addEventListener("click",replaceAll);
  document.querySelector(".markdown-toolbar").addEventListener("click",(event)=>{const button=event.target.closest("[data-markdown-command]");if(button)applyMarkdownCommand(button.dataset.markdownCommand);});
  document.getElementById("editor-focus-mode").addEventListener("click",()=>setFocusMode(!document.body.classList.contains("editor-focus")));
  document.getElementById("editor-outline-toggle").addEventListener("click",()=>setOutlineVisible(document.getElementById("view-editor").classList.contains("outline-hidden")));
  document.getElementById("editor-quality-check").addEventListener("click",openQualityCheck);
  document.getElementById("editor-preflight").addEventListener("click",openPreflight);
  document.querySelectorAll("[data-close-preflight]").forEach((button)=>button.addEventListener("click",()=>document.getElementById("preflight-dialog").close()));
  document.getElementById("preflight-list").addEventListener("click",(event)=>{const button=event.target.closest("[data-preflight-action]");if(button)handlePreflightAction(button.dataset.preflightAction);});
  document.getElementById("preflight-primary").addEventListener("click",(event)=>handlePreflightAction(event.currentTarget.dataset.preflightAction));
  document.querySelectorAll("[data-close-quality]").forEach((button)=>button.addEventListener("click",()=>document.getElementById("quality-dialog").close()));
  document.getElementById("quality-issue-list").addEventListener("click",(event)=>{const button=event.target.closest("[data-quality-offset]");if(button)jumpToQualityIssue(button);});
  document.getElementById("document-outline-list").addEventListener("click",(event)=>{const button=event.target.closest("[data-outline-offset]");if(button)jumpToHeading(button);});
  document.getElementById("writing-goal-open").addEventListener("click",openWritingGoal);
  document.getElementById("writing-goal-form").addEventListener("submit",saveWritingGoal);
  document.querySelectorAll("[data-close-writing-goal]").forEach((button)=>button.addEventListener("click",()=>document.getElementById("writing-goal-dialog").close()));
  document.getElementById("find-text").addEventListener("keydown",(event)=>{if(event.key==="Enter"){event.preventDefault();findNext();}});
  document.getElementById("revision-list").addEventListener("click",(event)=>{const button=event.target.closest("[data-revision-id]");if(button)selectRevision(button.dataset.revisionId).catch((error)=>toast(error.message));});
  document.getElementById("restore-revision").addEventListener("click",()=>restoreRevision().catch((error)=>toast(error.message)));
  document.querySelector("[data-close-revisions]").addEventListener("click",()=>document.getElementById("revision-dialog").close());
  document.getElementById("ai-draft").addEventListener("click", (event) => withLoading(event.currentTarget, "正在生成…", () => aiDraft().catch((error) => toast(error.message))));
  document.getElementById("plan-article-visuals").addEventListener("click",(event)=>withLoading(event.currentTarget,"正在分析…",()=>planVisuals().catch((error)=>toast(error.message))));
  document.getElementById("visual-plan-list").addEventListener("click",(event)=>{const button=event.target.closest("[data-insert-visual]");if(button)insertVisual(button.dataset.insertVisual);});
  document.getElementById("visual-plan-list").addEventListener("click",(event)=>{const button=event.target.closest("[data-preview-visual]");if(button)withLoading(button,"生成中…",()=>previewVisual(button.dataset.previewVisual).catch((error)=>toast(error.message)));});
  document.getElementById("visual-plan-list").addEventListener("click",(event)=>{const button=event.target.closest("[data-ignore-visual]");if(button)ignoreVisual(button.dataset.ignoreVisual);});
  window.addEventListener("beforeunload",(event)=>{if(!editorDirty)return;event.preventDefault();event.returnValue="";});
  window.addEventListener("keydown",(event)=>{
    if(event.key==="Escape"&&document.body.classList.contains("editor-focus")&&!document.querySelector("dialog[open]")){setFocusMode(false);return;}
    if(!(event.ctrlKey||event.metaKey)||!document.getElementById("view-editor").classList.contains("active"))return;
    if(event.key.toLowerCase()==="s"){event.preventDefault();saveDocument().catch((error)=>toast(error.message));}
    if(event.key.toLowerCase()==="f"&&(document.activeElement===document.getElementById("markdown-editor")||document.getElementById("find-dialog").open)){event.preventDefault();openFindDialog();}
    if(event.key.toLowerCase()==="b"&&document.activeElement===document.getElementById("markdown-editor")){event.preventDefault();applyMarkdownCommand("bold");}
    if(event.key.toLowerCase()==="k"&&document.activeElement===document.getElementById("markdown-editor")){event.preventDefault();applyMarkdownCommand("link");}
  });
}

// 终稿字数门禁：由服务端 /api/system/settings 统一下发（config.local.json articleLength），加载失败回退 1300–2000
let articleLengthLimit = { min: 1300, max: 2000 };
async function loadArticleLengthLimit() {
  try {
    const data = await request("/api/system/settings");
    const al = data?.articleLength;
    if (al) articleLengthLimit = { min: Number(al.minVisibleChars) || 1300, max: Number(al.maxVisibleChars) || 2000 };
  } catch {}
}

export default async function loadWritingDeskView() {
  bindEditor();
  loadArticleLengthLimit().then(() => renderMarkdown());
  return loadWritingDesk();
}
export { runTypeset };
