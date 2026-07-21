function lazyFn(name) {
  return function() {
    var fn = typeof window !== 'undefined' ? window[name] : null;
    if (typeof fn === 'function') return fn.apply(this, arguments);
    setTimeout(function() { fn = window[name]; if (typeof fn === 'function') fn.apply(this, arguments); }, 500);
  };
}function bind() {
  $('#nav').addEventListener('click', (event) => { const item = event.target.closest('[data-view]'); if (item) go(item.dataset.view); });
  document.addEventListener('click', (event) => {
    const goButton = event.target.closest('[data-go]'); if (goButton) go(goButton.dataset.go);
    if (event.target.closest('[data-close-batch-dialog]')) $('#batch-dialog').close();
    const batch = event.target.closest('[data-batch]'); if (batch) { var m=document.querySelector('.nav-item.active')?.dataset.view==='batches'?'archive':'full'; openBatch(batch.dataset.batch,m); }
    if (event.target.closest('[data-close-drawer]')) $('#batch-drawer').close();
    if (event.target.closest('[data-collect]')) startCollection();
    if (event.target.closest('[data-manual-hotspot]')) { $('#manual-hotspot-dialog').showModal(); 
    }
    if (event.target.closest('[data-cal-month-prev]')) { var y = state.calYear, m = state.calMonth; if (y) { if (m <= 1) { y--; m = 12; } else { m--; } loadCalendar(y, m).catch(function(e){toast(e.message);}); } }
    if (event.target.closest('[data-cal-month-next]')) { var y = state.calYear, m = state.calMonth; if (y) { if (m >= 12) { y++; m = 1; } else { m++; } loadCalendar(y, m).catch(function(e){toast(e.message);}); } }
    if (document.getElementById('cal-today-btn') && event.target.closest('#cal-today-btn')) { var n = new Date(); loadCalendar(n.getFullYear(), n.getMonth()+1).catch(function(e){toast(e.message);}); }
    if (event.target.closest('[data-calendar-prev]')) {
      const w = state.calendarWeek; if (!w) return;
      const year = parseInt(w.slice(0,4)); const num = parseInt(w.slice(6));
      loadCalendar(year + '-W' + String(num - 1).padStart(2,'0')).catch(function(e){toast(e.message);});
    
    }
    if (event.target.closest('[data-calendar-next]')) {
      const w = state.calendarWeek; if (!w) return;
      const year = parseInt(w.slice(0,4)); const num = parseInt(w.slice(6));
      loadCalendar(year + '-W' + String(num + 1).padStart(2,'0')).catch(function(e){toast(e.message);});
    }
    if (event.target.closest('[data-close-manual-hotspot]')) { $('#manual-hotspot-dialog').close(); }
    const calArticle=event.target.closest('[data-cal-article]');if(calArticle){document.getElementById('artifact-dialog').showModal();document.querySelector('#artifact-dialog iframe').src='/api/documents/'+calArticle.dataset.calArticle+'/content';}
    const submitManual=event.target.closest('[data-submit-manual-hotspot]');
    if (submitManual) {
      const form = submitManual.closest('form');
      const data = Object.fromEntries(new FormData(form));
      if (!data.title?.trim()) return toast('请输入标题');
      const batchId = state.activeBatchId || state.currentBatch?.id;
      if (!batchId) return toast('请先选择一个批次');
      request('/api/batches/' + encodeURIComponent(batchId) + '/hotspots/manual', {
        method: 'POST', body: JSON.stringify({ title: data.title, url: data.url, category: data.category, notes: data.notes })
      }).then((hotspot) => {
        toast('已添加热点：' + hotspot.title);
        form.reset();
        $('#manual-hotspot-dialog').close();
        openBatch(batchId);
        if ($('.nav-item.active')?.dataset.view === 'topics') loadTopicPool();
      }).catch((error) => toast(error.message));
    
    }
    if (event.target.closest('[data-ai-tag]')) startBatchAi('tag').catch((error)=>toast(error.message));
    if (event.target.closest('[data-ai-retag]')) startBatchAi('retag').catch((error)=>toast(error.message));
    if (event.target.closest('[data-ai-research]')) startBatchAi('research').catch((error)=>toast(error.message));
    const removeCandidate = event.target.closest('[data-remove-candidate]'); if (removeCandidate) { const id=Number(removeCandidate.dataset.removeCandidate); if(confirm('确认移除此候选？')) request(`/api/candidates/${id}`,{method:'DELETE'}).then(()=>{toast('已移除');loadTopicPool();loadEditorialRoom();}).catch(error=>toast(error.message)); }
    const editorialButton = event.target.closest('[data-editorial-id]'); if (editorialButton) { go('editorial').then(function(){if(typeof window.loadEditorialRoom==='function')window.loadEditorialRoom(Number(editorialButton.dataset.editorialId));}); }
    const editCandidate = event.target.closest('[data-edit-candidate]'); if (editCandidate) { var view=document.querySelector('.nav-item.active')?.dataset.view;if(view==='editorial'&&typeof window.openEditorial==='function')window.openEditorial(Number(editCandidate.dataset.editCandidate));else go('editorial').then(function(){if(typeof window.openEditorial==='function')window.openEditorial(Number(editCandidate.dataset.editCandidate));});}
    const artifact = event.target.closest('[data-artifact]');
    if (artifact) { const dialog = $('#artifact-dialog'); $('iframe', dialog).src = `/api/artifacts/${artifact.dataset.artifact}/content`; dialog.showModal(); }
    const copy = event.target.closest('[data-copy]'); if (copy) navigator.clipboard.writeText(copy.dataset.copy).then(() => toast('启动命令已复制'));
    const scopeButton=event.target.closest('[data-atlas-scope]'); if(scopeButton&&state.atlas){state.atlasFilters.scope=scopeButton.dataset.atlasScope;$$('[data-atlas-scope]').forEach((button)=>button.classList.toggle('active',button===scopeButton));renderAtlas();}
    const wordButton=event.target.closest('[data-atlas-word]'); if(wordButton&&state.atlas){const word=wordButton.dataset.atlasWord;state.atlasSelectedWord=state.atlasSelectedWord===word?null:word;state.atlasFilters.query=state.atlasSelectedWord||'';$('#atlas-query').value=state.atlasFilters.query;renderAtlas();}
    const compositeFromEvent=event.target.closest('[data-event-index]'); if(compositeFromEvent&&state.atlas&&state.activeBatchId){
      const eventIndex=Number(compositeFromEvent.dataset.eventIndex);
      const title=compositeFromEvent.dataset.eventTitle||'';
      withLoading(compositeFromEvent, '合成中…', () => createCompositeFromEvent(state.activeBatchId,eventIndex,title)).catch((error)=>toast(error.message));
    }
    const hotwordComposite=event.target.closest('[data-hotword-composite]'); if(hotwordComposite&&state.activeBatchId){
      const word=hotwordComposite.dataset.hotwordComposite;
      withLoading(hotwordComposite, '合成中…', () => createCompositeFromHotword(state.activeBatchId,word)).catch((error)=>toast(error.message));
    }
    const hotwordGenSummary=event.target.closest('[data-hotword-gen-summary]'); if(hotwordGenSummary&&state.activeBatchId){
      const word=hotwordGenSummary.dataset.hotwordGenSummary;
      generateHotwordSummary(state.activeBatchId,word).then((result)=>{if(result?.summary){toast('热词综述已生成');state.atlasSelectedWord=word;loadOverview().then(()=>renderAtlas());}else{toast('生成失败');}}).catch((error)=>toast(error.message));
    }
    const uploadImageButton=event.target.closest('[data-upload-image]'); if(uploadImageButton) withLoading(uploadImageButton, '上传中…', () => uploadImageAsset(uploadImageButton.dataset.uploadImage)).catch((error)=>toast(error.message));
    const sourceTest=event.target.closest('[data-source-test]'); if(sourceTest) testSubscription({kind:sourceTest.dataset.kind,value:sourceTest.dataset.value},sourceTest).catch((error)=>toast(error.message));
    const sourceRemove=event.target.closest('[data-source-remove]'); if(sourceRemove) removeSubscription(sourceRemove).catch((error)=>toast(error.message));
        if (event.target.closest('[data-ranking-add]')) {
      var hid = Number(event.target.closest('[data-ranking-add]').dataset.rankingAdd);
      if (hid && state.activeBatchId) {
        request('/api/batches/' + encodeURIComponent(state.activeBatchId) + '/candidates', { method:'POST', body:JSON.stringify({hotspotIds:[hid]}) }).then(function() {
          toast('已加入候选池');
          loadTopicPool();
        }).catch(function(e) { toast(e.message); });
      }
    }const sourceFilter=event.target.closest('[data-source-filter]'); if(sourceFilter){state.subscriptionFilter=sourceFilter.dataset.sourceFilter;$$('[data-source-filter]').forEach((item)=>item.classList.toggle('active',item===sourceFilter));renderSubscriptions();}
  });
  document.addEventListener('change',(event)=>{if(event.target.matches('[data-source-toggle]'))toggleSubscription(event.target).catch((error)=>{event.target.checked=!event.target.checked;toast(error.message);});});
  $('#new-batch-button').addEventListener('click', openNewBatch); $('#dashboard-new').addEventListener('click', openNewBatch);
  $('#batch-form').addEventListener('submit', createBatch);
  $('#batch-switcher').addEventListener('change', (event) => { state.activeBatchId = event.target.value; const current = $('.nav-item.active')?.dataset.view || 'dashboard'; go(current); });
  $('#hotspot-filter').addEventListener('submit', (event) => { event.preventDefault(); loadHotspots(new URLSearchParams(new FormData(event.currentTarget))); });
  // Source-picker view removed — 选题操作统一在热点全景中完成
  $('#atlas-category').addEventListener('change',(event)=>{state.atlasFilters.category=event.target.value;renderAtlas();});
  $('#atlas-multisource').addEventListener('change',(event)=>{state.atlasFilters.multi=event.target.checked;renderAtlas();});
  $('#atlas-query').addEventListener('input',(event)=>{state.atlasFilters.query=event.target.value;renderAtlas();});
  $('#editorial-form').addEventListener('submit', lazyFn('saveEditorial'));
  $('#editorial-form').addEventListener('input', lazyFn('renderEditorialReadiness'));
  $('#editorial-form').addEventListener('change', lazyFn('renderEditorialReadiness'));
  $('#send-editorial-answer').addEventListener('click',()=>sendEditorialAnswer().catch((error)=>toast(error.message)));
  $('#fetch-source').addEventListener('click',()=>fetchEditorialSource().catch((error)=>toast(error.message)));
  $('#writing-candidate').addEventListener('change', lazyFn('loadSelectedDocument'));
  $$('input[name=doc-kind]').forEach((item) => item.addEventListener('change', lazyFn('loadSelectedDocument')));
  $('#markdown-editor').addEventListener('input', lazyFn('renderMarkdown'));
  $('#article-title').addEventListener('input', () => {
    const content = $('#markdown-editor').value;
    if (content.startsWith('# ')) { var sep = content.indexOf('\\n'); document.getElementById('markdown-editor').value = '# ' + document.getElementById('article-title').value + (sep >= 0 ? content.slice(sep) : '\\n\\n'); }
    renderMarkdown();
  });
  $('#save-document').addEventListener('click', () => saveDocument().catch((error) => toast(error.message)));
  $('#typeset-candidate').addEventListener('change', (event) => { const id=Number(event.target.value); renderProductionCandidate(id); loadImageWorkspace(id).catch((error)=>toast(error.message)); });
  $('#refresh-preview').addEventListener('click', lazyFn('loadProductionPreview'));
  $('#preview-reindex').addEventListener('click', async () => { await reindex(); if (typeof loadProductionPreview==='function') loadProductionPreview(); });
  $('#reindex-button').addEventListener('click', lazyFn('reindex'));
  $('#health-button').addEventListener('click', () => { go('system'); checkHealth(); });
  $('#system-health').addEventListener('click', checkHealth);
  $('#subscription-kind').addEventListener('change', updateSubscriptionComposer);
  $('#subscription-form').addEventListener('submit', (event)=>addSubscriptionFromForm(event).catch((error)=>toast(error.message)));
  $('#test-subscription').addEventListener('click', (event)=>testSubscription(subscriptionFormPayload(),event.currentTarget).catch((error)=>toast(error.message)));
  $('#test-model').addEventListener('click', () => testModel().catch((error) => toast(error.message)));
  loadingClick('#ai-tag-batch', '正在打标…', () => aiTagBatch().catch((error) => toast(error.message)));
  loadingClick('#ai-draft', '正在生成…', () => aiDraft().catch((error) => toast(error.message)));
  loadingClick('#start-editorial-production', '正在发布任务…', () => startEditorialProduction().catch((error) => toast(error.message)));
  loadingClick('#plan-article-images', '正在分析…', () => planArticleImages().catch((error) => toast(error.message)));
  loadingClick('#run-local-typeset', '正在排版…', () => runTypeset('local').catch((error) => toast(error.message)));
  loadingClick('#copy-typeset-html', '正在复制…', () => copyTypesetHtml().catch((error) => toast(error.message)));
  $('#close-production-job').addEventListener('click', () => $('#production-job-dialog').close());
  $('.preview-close').addEventListener('click', () => $('#artifact-dialog').close());
  // 图片文件选择后自动上传
  document.addEventListener('change', (event) => {
    if (!event.target.matches('[data-image-file]')) return;
    const card = event.target.closest('[data-image-id]');
    if (!card) return;
    uploadImageAsset(card.dataset.imageId).catch((error) => toast(error.message));
  });
  $('#log-type-filter').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-log-type]');
    if (!btn) return;
    $$('[data-log-type]', $('#log-type-filter')).forEach(b => b.classList.toggle('active', b === btn));
    loadLogs(btn.dataset.logType || undefined);
  });
  window.addEventListener('hashchange', () => {
    const view = location.hash.slice(1);
    if (view in titles && !$('.nav-item.active')?.matches(`[data-view="${view}"]`)) go(view);
  });
}

function tick() {
  const now = new Date();
  $('#clock').textContent = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit',
  }).format(now);
  $('#today-label').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(now);
}

async function init() {
  bind(); tick(); setInterval(tick, 30000);
  const initialView = location.hash.slice(1) in titles ? location.hash.slice(1) : 'dashboard';
  try { await loadOverview(); await go(initialView); } catch (error) { toast('工作台加载失败：' + error.message); }
}

init();