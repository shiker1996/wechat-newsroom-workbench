import { evaluateEditorialReadiness, selectWriterSkill } from '../../../features/articles/index.mjs';
import { resolveSkillToolPolicy } from '../../skills/pipeline-runtime.mjs';
import { listArticleStageSkillSlots, listEntryWriterSkills, resolveArticleStageSkills, resolveEntryWriterSkill } from '../../skills/entry-routing.mjs';
import { executeCapabilityWithPreference } from '../../tools/capability-slots.mjs';
import { getToolRegistry } from '../../tools/index.mjs';
import { runEditorialAgentTurn } from '../../../features/articles/application/agent/editorial-adapter.mjs';
import { extractLocalProjectPath } from '../../integrations/local-project-reader.mjs';
import { createNdjsonSession } from '../route-helpers.mjs';
import { runWithThinkingSink } from '../../llm/gateway.mjs';

// capability-call: content.passage.retrieve

export async function handleArticleRoutes(context) {
  // agent-callsite: editorial — Phase 0 baseline; current production flow remains bespoke.
  const { request, response, pathname, store, json, body, candidateEventGroups, fetchCandidateSource, config, root, writeUtf8, path, batchWorkdir, lockedBrief, draftArticle, models, aiJobs, localSecurity } = context;
  async function fetchSourceForCandidate(candidate, input = {}) {
    const skillId = selectWriterSkill(candidate).skill;
    const policy = await resolveSkillToolPolicy({ workspaceRoot: root, skillId });
    return fetchCandidateSource({
      store,
      sourceFetch: config.sourceFetch,
      candidateId: candidate.id,
      root,
      ...input,
      toolContext: {
        store,
        batchId: candidate.batch_id,
        candidateId: candidate.id,
        skillId,
        allowedCapabilities: policy.allowedCapabilities,
      },
    });
  }
  // 编辑会摘录检索：经能力槽位偏好调用 content.passage.retrieve（read-only 纯本地计算），
  // 插件缺失或被禁用时返回 null，编辑室自动回退截断注入。
  async function editorialRetrieve(candidate) {
    return async ({ documents, query, ...options }) => {
      const result = await executeCapabilityWithPreference(root, 'content.passage.retrieve', { documents, query, ...options },
        { store, batchId: candidate.batch_id, candidateId: candidate.id });
      return result.status === 'ok' ? result.data.selections : null;
    };
  }
  const editorialMatch = pathname.match(/^\/api\/candidates\/(\d+)\/editorial$/);
  const writerSkillsMatch=pathname.match(/^\/api\/candidates\/(\d+)\/writer-skills$/);
  if(writerSkillsMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(writerSkillsMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const recommendedSkillId=selectWriterSkill(candidate).skill;
    return json(response,200,await listEntryWriterSkills({workspaceRoot:root,entryPoint:'hotspot-article',recommendedSkillId}));
  }
  const stageSkillsMatch=pathname.match(/^\/api\/candidates\/(\d+)\/stage-skills$/);
  if(stageSkillsMatch&&request.method==='GET'){
    const candidate=store.getCandidate(Number(stageSkillsMatch[1]));
    if(!candidate)return json(response,404,{error:'候选不存在'});
    return json(response,200,await listArticleStageSkillSlots({workspaceRoot:root}));
  }
  if (editorialMatch && request.method === 'GET') {
    const candidate = store.getCandidate(Number(editorialMatch[1]));
    return json(response, candidate ? 200 : 404, candidate?.editorial ?? { error: '候选不存在' });
  }

  const docContentMatch=pathname.match(/^\/api\/documents\/(\d+)\/content$/);
  if (docContentMatch && request.method === "GET") {
    const doc = store.getDocumentContent(Number(docContentMatch[1]));
    if (!doc) return json(response, 404, { code: 'DOCUMENT_NOT_FOUND', error: '文稿不存在' });
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return response.end(doc.content || doc.title || "");
  }


  const revisionMatch=pathname.match(/^\/api\/documents\/(\d+)\/revisions(?:\/(\d+))?(?:\/(restore))?$/);
  if (revisionMatch && request.method === 'GET') {
    const documentId=Number(revisionMatch[1]);
    if (!store.getDocumentById(documentId)) return json(response,404,{error:'文档不存在'});
    if (!revisionMatch[2]) return json(response,200,store.listDocumentRevisions(documentId));
    const revision=store.getDocumentRevision(documentId,Number(revisionMatch[2]));
    return json(response,revision?200:404,revision||{error:'版本不存在'});
  }
  if (revisionMatch && revisionMatch[3] === 'restore' && request.method === 'POST') {
    const document=store.getDocumentById(Number(revisionMatch[1]));
    const revision=document&&store.getDocumentRevision(document.id,Number(revisionMatch[2]));
    if (!document || !revision) return json(response,404,{error:'文档或版本不存在'});
    if (document.file_path) writeUtf8(document.file_path,revision.content);
    const restored=store.saveDocument({batchId:document.batch_id,candidateId:document.candidate_row_id,
      kind:document.kind,title:revision.title,content:revision.content,filePath:document.file_path,status:revision.status});
    return json(response,200,restored);
  }

  // 编辑会回答中粘贴的链接：提取全部 URL 抓取入库，并把每条成功/失败写入对话（对用户与模型可见）
  function extractSuppliedUrls(answer){return [...new Set((String(answer).match(/https?:\/\/[^\s<>"']+/gi)||[]).map((u)=>u.replace(/[，。；、)）\]]+$/,'')))].slice(0,5);}
  function agentBudget(){const value=config.conversationAgent||{};return {maxModelSteps:value.maxModelSteps,maxToolCalls:value.maxToolCalls,maxParallelToolCalls:value.maxParallelToolCalls,maxToolResultChars:value.maxToolResultChars,maxTotalToolResultChars:value.maxTotalToolResultChars,timeoutMs:value.timeoutMs};}
  const editorialAiMatch=pathname.match(/^\/api\/candidates\/(\d+)\/ai\/editorial$/);
  if(editorialAiMatch&&request.method==='POST') {
    const input=await body(request); const answer=String(input.answer||'');const projectPath=extractLocalProjectPath(answer);
    const candidateId=Number(editorialAiMatch[1]); const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    if(projectPath&&!localSecurity?.consume(request,'local-project-read'))return json(response,403,{code:'CONFIRMATION_REQUIRED',error:'请先确认允许读取该本地项目'});
    const result=await runEditorialAgentTurn({gateway:models,store,registry:await getToolRegistry(),candidateId,provider:input.provider,answer,events:candidateEventGroups(candidate,12000),retrieve:await editorialRetrieve(candidate),workspaceRoot:root,projectPath,budget:agentBudget(),suppliedUrls:extractSuppliedUrls(answer),allowedCapabilities:(await resolveSkillToolPolicy({workspaceRoot:root,skillId:'editorial-room-chat'})).allowedCapabilities});
    return json(response,200,result);
  }
  const editorialStreamMatch=pathname.match(/^\/api\/candidates\/(\d+)\/ai\/editorial\/stream$/);
  if(editorialStreamMatch&&request.method==='POST') {
    const input=await body(request);const answer=String(input.answer||'');const projectPath=extractLocalProjectPath(answer);
    const candidateId=Number(editorialStreamMatch[1]);const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    if(projectPath&&!localSecurity?.consume(request,'local-project-read'))return json(response,403,{code:'CONFIRMATION_REQUIRED',error:'请先确认允许读取该本地项目'});
    response.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no','connection':'keep-alive'});
    const stream=createNdjsonSession(request,response);const send=stream.send;
    try {
      const result=await runWithThinkingSink((delta)=>send({type:'thinking',text:delta}),async()=>runEditorialAgentTurn({gateway:models,store,registry:await getToolRegistry(),candidateId,provider:input.provider,answer,events:candidateEventGroups(candidate,12000),retrieve:await editorialRetrieve(candidate),workspaceRoot:root,projectPath,budget:agentBudget(),suppliedUrls:extractSuppliedUrls(answer),allowedCapabilities:(await resolveSkillToolPolicy({workspaceRoot:root,skillId:'editorial-room-chat'})).allowedCapabilities,onEvent:send,signal:stream.signal}));
      if(result.reply)send({type:'assistant.delta',text:result.reply});
      send({type:'done',data:{candidate:result.candidate,editorial:result.editorial,usage:result.usage,model:result.model,agentRunId:result.agentRunId,toolCalls:result.toolCalls,ignoredBecauseLocked:Boolean(result.ignoredBecauseLocked)}});
    } catch(error) {
      send({type:'error',error:error.message});
    }
    stream.end();return true;
  }
  const sourceMatch=pathname.match(/^\/api\/candidates\/(\d+)\/source$/);
  if(sourceMatch&&request.method==='POST') {
    const input=await body(request); const candidateId=Number(sourceMatch[1]);
    const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const force=Boolean(input.force);
    // 支持按单个热点或单个事件抓取；默认抓取本选题全部关联事件下的热点原文
    if (input.hotspotId != null) {
      const hotspot=candidateEventGroups(candidate).flatMap((group)=>group.hotspots).find((h)=>h.id===Number(input.hotspotId));
      if(!hotspot)return json(response,404,{error:'该热点不属于本选题的关联事件'});
      return json(response,200,await fetchSourceForCandidate(candidate,{force,hotspots:[hotspot]}));
    }
    if (input.eventId) {
      const group=candidateEventGroups(candidate).find((g)=>g.event_id===String(input.eventId));
      if(!group)return json(response,404,{error:'该事件不属于本选题'});
      return json(response,200,await fetchSourceForCandidate(candidate,{force,hotspots:group.hotspots}));
    }
    const seen=new Set(); const all=[];
    for(const group of candidateEventGroups(candidate))for(const hotspot of group.hotspots) {
      if(!seen.has(hotspot.id)){seen.add(hotspot.id);all.push(hotspot);}
    }
    if(all.length)return json(response,200,await fetchSourceForCandidate(candidate,{force,hotspots:all}));
    return json(response,200,await fetchSourceForCandidate(candidate,{force}));
  }
  if (editorialMatch && request.method === 'PUT') {
    const candidateId = Number(editorialMatch[1]);
    if (!store.getCandidate(candidateId)) return json(response, 404, { error: '候选不存在' });
    return json(response, 200, store.saveEditorial(candidateId, await body(request)));
  }
  const lockMatch = pathname.match(/^\/api\/candidates\/(\d+)\/lock$/);
  if (lockMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(lockMatch[1]));
    if (!candidate) return json(response, 404, { error: '候选不存在' });
    const editorial = candidate.editorial;
    const readiness = evaluateEditorialReadiness({ candidate, editorial });
    if (!readiness.ready) return json(response, 409, { error: `编辑底稿未就绪，仍缺：${readiness.missing.join('、')}` });
    const batch = store.getBatch(candidate.batch_id);
    const filePath = path.join(batchWorkdir(batch), candidate.candidate_id, 'article-brief.md');
    const file = writeUtf8(filePath, lockedBrief(candidate, editorial));
    store.saveEditorial(candidate.id, { ...editorial, brief_status: 'LOCKED' });
    store.updateCandidate(candidate.id, { status: 'locked' });
    store.updateBatch(batch.id, { stage: 'drafting', status: 'running' });
    store.upsertArtifact({ batchId: batch.id, kind: '锁定简报', name: 'article-brief.md', path: filePath, ...file });
    return json(response, 200, { candidate: store.getCandidate(candidate.id), filePath });
  }
  const draftMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/draft$/);
  if (draftMatch && request.method === 'POST') {
    const input = await body(request);
    const result = await draftArticle({ gateway: models, store, candidateId: Number(draftMatch[1]),
      provider: input.provider, instructions: input.instructions, existingDraft: input.existingDraft });
    return json(response, 200, { content: result.content, provider: result.provider, model: result.model,
      usage: result.usage, context: { beforeTokens: result.context.beforeTokens,
        afterTokens: result.context.afterTokens, compressed: result.context.compressed } });
  }
  const articleMatch = pathname.match(/^\/api\/candidates\/(\d+)\/ai\/article$/);
  if (articleMatch && request.method === 'POST') {
    const candidate = store.getCandidate(Number(articleMatch[1]));
    if (!candidate) return json(response, 404, { error: '候选不存在' });
    const input = await body(request);
    const explicitSkillId=String(input.skillId||'').trim();
    const requestedStages=input.stageSkills&&typeof input.stageSkills==='object'?input.stageSkills:{};
    const hasExplicitStages=Object.values(requestedStages).some((value)=>String(value||'').trim());
    const previousSnapshot=(input.useLatestSkill===true||explicitSkillId||hasExplicitStages)?null:store.findLatestGenerationSnapshot({
      batchId:candidate.batch_id,candidateId:candidate.id,purposes:['article'],
    });
    const recommendedSkillId=selectWriterSkill(candidate).skill;
    const skillSelection=previousSnapshot?null:await resolveEntryWriterSkill({
      workspaceRoot:root,entryPoint:'hotspot-article',requestedSkillId:explicitSkillId,recommendedSkillId,
    });
    const stageSelections=previousSnapshot?null:await resolveArticleStageSkills({workspaceRoot:root,requested:requestedStages});
    return json(response, 202, aiJobs.start({ batchId: candidate.batch_id, candidateId: candidate.id,
      provider:previousSnapshot?null:input.provider, type:'article', snapshotId:previousSnapshot?.id||null,skillSelection,stageSelections }));
  }
  return false;
}
