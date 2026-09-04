import { parseRepositoryUrl } from './repository-url.mjs';

// capability-call: cap_content_repository_inspect

function decodeContent(value) {
  try{return Buffer.from(String(value||'').replace(/\s/g,''),'base64').toString('utf8');}catch{return '';}
}

function extractInstallation(readme='') {
  const lines=String(readme).split(/\r?\n/); const commands=[];
  let relevant=false;
  for(const line of lines){
    if(/^#{1,4}\s+(install|installation|quick ?start|getting started|使用|安装|快速开始)/i.test(line)) relevant=true;
    else if(/^#{1,4}\s+/.test(line)) relevant=false;
    const command=line.match(/^\s*(?:```(?:bash|sh|shell)?\s*)?(npm (?:i|install)[^`]*|pnpm (?:i|add)[^`]*|yarn add[^`]*|pip(?:3)? install[^`]*|uv add[^`]*|cargo install[^`]*|go install[^`]*|docker (?:run|compose)[^`]*)/i)?.[1];
    if(relevant&&command&&!commands.includes(command.trim()))commands.push(command.trim());
  }
  return commands.slice(0,8);
}

function extractReadmeKnowledge(readme='') {
  const normalized=String(readme).replace(/<!--[^]*?-->/g,'').replace(/<img\b[^>]*>/gi,'').trim();
  const sections=[]; let current={title:'Overview',lines:[]};
  for(const line of normalized.split(/\r?\n/)){
    const heading=line.match(/^#{1,4}\s+(.+)/);
    if(heading){if(current.lines.some((item)=>item.trim()))sections.push(current);current={title:heading[1].replace(/[*_`]/g,'').trim(),lines:[]};continue;}
    if(line.trim())current.lines.push(line.trim());
  }
  if(current.lines.length)sections.push(current);
  const useful=sections.filter((section)=>!/^(license|contributing|contributors|acknowledg|star history)/i.test(section.title)).slice(0,16)
    .map((section)=>({title:section.title,content:section.lines.join('\n').slice(0,2400)}));
  const featureSections=useful.filter((section)=>/(feature|capabilit|what|why|overview|how it works|use case|功能|特性|能力|介绍)/i.test(section.title));
  const capabilities=featureSections.flatMap((section)=>section.content.split('\n')).map((line)=>line.replace(/^[-*+]\s+/,'').replace(/^\d+[.)]\s+/,'').trim())
    .filter((line)=>line.length>=12&&line.length<=240&&!/^https?:\/\//i.test(line)&&!/^```/.test(line)).slice(0,12);
  return {readmeMarkdown:normalized.slice(0,18000),readmeSections:useful,capabilities};
}

export async function inspectRepository(sourceUrl,{fetchImpl=fetch,token=process.env.GITHUB_ACCESS_TOKEN,cacheDir=null,requestGitHubJson}={}) {
  requestGitHubJson ||= async(apiPath,options={})=>{const response=await fetchImpl(`https://api.github.com${apiPath}`,options);if(!response.ok){if(options.optional&&response.status===404)return null;throw new Error(`GitHub API ${response.status}`);}return response.json();};
  if(typeof requestGitHubJson!=='function')throw new Error('GitHub 宿主服务未注入');
  const parsed=parseRepositoryUrl(sourceUrl); if(!parsed)throw new Error('候选来源不是有效的 GitHub 仓库地址');
  const get=(apiPath,options={})=>requestGitHubJson(apiPath,{fetchImpl,token,cacheDir,...options});
  const base=`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
  const [repo,readme,license,release]=await Promise.all([get(base),get(`${base}/readme`,{optional:true}),get(`${base}/license`,{optional:true}),get(`${base}/releases/latest`,{optional:true})]);
  const readmeText=decodeContent(readme?.content); const topics=repo.topics||[]; const knowledge=extractReadmeKnowledge(readmeText);
  const coreCapabilities=[repo.description,...knowledge.capabilities,...topics.slice(0,5).map((topic)=>`项目主题：${topic}`)].filter(Boolean).filter((item,index,all)=>all.indexOf(item)===index).slice(0,15);
  const checkedAt=new Date().toISOString();
  return {repository:parsed.repository,sourceUrl:parsed.sourceUrl,description:repo.description||'',homepage:repo.homepage||'',stars:{value:repo.stargazers_count??null,checkedAt,source:repo.html_url},forks:{value:repo.forks_count??null,checkedAt,source:repo.html_url},
    license:{type:license?.license?.spdx_id||repo.license?.spdx_id||'UNKNOWN',source:license?.html_url||`${parsed.sourceUrl}/blob/${repo.default_branch}/LICENSE`},
    latestRelease:{version:release?.tag_name||'',publishedAt:release?.published_at||'',source:release?.html_url||`${parsed.sourceUrl}/releases`},
    installation:extractInstallation(readmeText),supportedPlatforms:topics.filter((x)=>/windows|linux|macos|android|ios|web/i.test(x)),coreCapabilities,
    readme:{source:readme?.html_url||'',markdown:knowledge.readmeMarkdown,sections:knowledge.readmeSections},limitations:[],permissions:[],networkAccess:[],
    maturity:repo.archived?'archived':release?.prerelease?'prerelease':release?'released':'unknown',defaultBranch:repo.default_branch,language:repo.language||'',topics,archived:Boolean(repo.archived),verifiedSources:[repo.html_url,readme?.html_url,license?.html_url,release?.html_url].filter(Boolean),warnings:[...(!readme?['README 缺失']:[]),...(!license?['LICENSE 未确认']:[]),...(!release?['未找到正式 Release']:[])]};
}

export function repositoryFactMarkdown(fact) {
  return `# ${fact.repository} · 仓库事实基座\n\n- 核验时间：${fact.stars?.checkedAt||''}\n- 仓库：${fact.sourceUrl}\n- 简介：${fact.description||'未提供'}\n- Star：${fact.stars?.value??'未知'}\n- License：${fact.license?.type||'UNKNOWN'}\n- 最新 Release：${fact.latestRelease?.version||'未发现'}\n- 成熟度：${fact.maturity||'unknown'}\n\n## 核心能力\n${(fact.coreCapabilities||[]).map((x)=>`- ${x}`).join('\n')||'- 待核验'}\n\n## README 章节\n${(fact.readme?.sections||[]).map((x)=>`### ${x.title}\n${x.content}`).join('\n\n')||'- README 未提取到有效章节'}\n\n## 安装入口\n${(fact.installation||[]).map((x)=>`- \`${x}\``).join('\n')||'- README 未提取到明确安装命令'}\n\n## 风险与未知\n${(fact.warnings||[]).map((x)=>`- ${x}`).join('\n')||'- 暂无显式警告；仍需编辑人工复核'}\n`;
}
