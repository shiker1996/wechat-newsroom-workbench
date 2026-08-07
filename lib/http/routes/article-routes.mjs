import { hasOpenQuestions } from '../../domain/open-questions.mjs';
import { selectWriterSkill } from '../../llm/article-pipeline.mjs';
import { resolveSkillToolPolicy } from '../../skills/pipeline-runtime.mjs';
import { listArticleStageSkillSlots, listEntryWriterSkills, resolveArticleStageSkills, resolveEntryWriterSkill } from '../../skills/entry-routing.mjs';
import { executeCapabilityWithPreference } from '../../tools/capability-slots.mjs';

export async function handleArticleRoutes(context) {
  const { request, response, pathname, store, json, body, candidateEventGroups, fetchCandidateSource, config, root, runEditorialTurn, runEditorialTurnStream, writeUtf8, path, batchWorkdir, lockedBrief, draftArticle, models, aiJobs } = context;
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
    if (!doc) return json(response, 404, { error: "?????" });
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return response.end(doc.content || doc.title || "");
  }


  // 编辑会自治：AI 在 fetchEvents 中列出需要原文的事件，系统抓取并把结果写入对话
  async function autoFetchEditorialEvents(candidate, fetchEvents) {
    const ids = (Array.isArray(fetchEvents) ? fetchEvents : []).map(String).slice(0, 3);
    if (!ids.length) return '';
    const groups = candidateEventGroups(candidate).filter((group) => ids.includes(group.event_id));
    const notes = [];
    for (const group of groups) {
      try {
        const r = await fetchSourceForCandidate(candidate, { force: false, hotspots: group.hotspots });
        notes.push(`已自动抓取「${group.title}」的原文：${r.ok}/${r.count} 个来源成功`);
      } catch (error) {
        notes.push(`「${group.title}」原文抓取失败：${error.message}`);
      }
    }
    if (notes.length) store.addEditorialMessage(candidate.id, 'assistant', notes.join('\n'));
    return notes.join('\n');
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
  async function fetchSuppliedUrls(candidate, answer) {
    const suppliedUrls=[...new Set((answer.match(/https?:\/\/[^\s<>"']+/gi)||[]).map((u)=>u.replace(/[，。；、)）\]]+$/,'')))].slice(0,5);
    if (!suppliedUrls.length) return '';
    const result=await fetchSourceForCandidate(candidate,{force:true,urlOverrides:suppliedUrls});
    const lines=(result.results||[]).map((r)=>r.status==='ok'
      ?`- ✅ ${r.url}（${r.title||'未获取标题'}，${r.content_chars} 字）`
      :`- ❌ ${r.url}（${r.error||'抓取失败'}）`);
    const note=`已抓取你提供的链接：\n${lines.join('\n')}`;
    store.addEditorialMessage(candidate.id,'assistant',note);
    return note;
  }
  const editorialAiMatch=pathname.match(/^\/api\/candidates\/(\d+)\/ai\/editorial$/);
  if(editorialAiMatch&&request.method==='POST') {
    const input=await body(request); const answer=String(input.answer||'');
    const candidateId=Number(editorialAiMatch[1]); const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    const suppliedNote=await fetchSuppliedUrls(candidate,answer);
    const result=await runEditorialTurn({gateway:models,store,candidateId,provider:input.provider,answer,events:candidateEventGroups(candidate,12000),retrieve:await editorialRetrieve(candidate),workspaceRoot:root});
    const fetchNote=await autoFetchEditorialEvents(candidate,result.fetchEvents);
    result.reply=[result.reply,suppliedNote,fetchNote].filter(Boolean).join('\n\n');
    return json(response,200,result);
  }
  const editorialStreamMatch=pathname.match(/^\/api\/candidates\/(\d+)\/ai\/editorial\/stream$/);
  if(editorialStreamMatch&&request.method==='POST') {
    const input=await body(request);const answer=String(input.answer||'');
    const candidateId=Number(editorialStreamMatch[1]);const candidate=store.getCandidate(candidateId);
    if(!candidate)return json(response,404,{error:'候选不存在'});
    response.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no','connection':'keep-alive'});
    const send=(event)=>response.write(`${JSON.stringify(event)}\n`);
    try {
      const suppliedNote=await fetchSuppliedUrls(candidate,answer);
      if(suppliedNote)send({type:'delta',text:suppliedNote+'\n\n'});
      const result=await runEditorialTurnStream({gateway:models,store,candidateId,provider:input.provider,answer,webSearch:true,events:candidateEventGroups(candidate,12000),retrieve:await editorialRetrieve(candidate),workspaceRoot:root,onText:(text)=>send({type:'delta',text}),onThinking:(text)=>send({type:'thinking',text})});
      const fetchNote=await autoFetchEditorialEvents(candidate,result.fetchEvents);
      if(fetchNote)send({type:'delta',text:'\n\n'+fetchNote});
      send({type:'done',data:{candidate:result.candidate,editorial:result.editorial,usage:result.usage,model:result.model}});
    } catch(error) {
      send({type:'error',error:error.message});
    }
    response.end();return true;
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
    if (!candidate.thesis.trim()) return json(response, 409, { error: '请先填写并保存锁定命题' });
    if (editorial.next_action !== 'WRITE_NOW') return json(response, 409, { error: 'next_action 必须是 WRITE_NOW' });
    if (hasOpenQuestions(editorial.open_questions)) return json(response, 409, { error: '仍有未解决问题，不能锁定简报' });
    if (editorial.experience_required && !editorial.confirmed_experiences.trim()) {
      return json(response, 409, { error: '本题依赖亲身实践，但尚未填写已确认实践' });
    }
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
