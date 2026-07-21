function openNewBatch() {
  const dialog = $('#batch-dialog');
  $('[name=date]', dialog).value = localDate();
  dialog.showModal();
}

async function createBatch(event) {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.currentTarget));
  const batch = await request('/api/batches', { method: 'POST', body: JSON.stringify(input) });
  state.activeBatchId = batch.id;
  $('#batch-dialog').close();
  toast('今日批次已建立');
  await loadOverview();
  openBatch(batch.id);
}

async function openBatch(id, mode) {
  if (!state.models) state.models = await request('/api/models');
  const batch = await request(`/api/batches/${encodeURIComponent(id)}`);
  state.activeBatchId = id;
  renderBatchSwitcher();
  state.currentBatch = batch;
  const [stage] = stages[batch.stage] ?? [batch.stage];
  const ai = batch.ai_status || { tagged:0,total:batch.hotspots.length,latestResearch:null };
  const preferred = state.models.providers.find((item) => item.configured)?.name || state.models.defaultProvider;
  const researchDone = ai.latestResearch?.status === 'completed';
  const latestAiRun = batch.ai_runs?.[0];
  $('#batch-detail').innerHTML = `<div class="drawer-inner">
    <header class="drawer-head"><div><span class="kicker">${escapeHtml(batch.batch_date)} · ${escapeHtml(stage)}</span><h2>${escapeHtml(batch.title)}</h2><p>${escapeHtml(batch.note || '暂无值班备注')}</p></div><button class="close-button" data-close-drawer>×</button></header>
    <section class="drawer-section"><h3>采集今日热点</h3><p>可单独重跑失败源。每次执行都会保留来源状态和失败原因。</p><div class="check-row"><label><input type="checkbox" name="source" value="reddit" checked> Reddit</label><label><input type="checkbox" name="source" value="rsshub" checked> RSSHub</label></div><div style="display:flex;gap:8px"><button class="primary-button" data-collect>开始采集</button><button class="outline-button" data-manual-hotspot>+ 手动添加</button></div></section>
    <section class="drawer-section"><h3>来源记录</h3>${batch.sources.length ? batch.sources.map((item) => `<div class="source-row ${item.status}"><i></i><div><strong>${escapeHtml(item.source)}</strong><small>${escapeHtml(item.error || item.ended_at || '执行中')}</small></div><b>${item.item_count}</b></div>`).join('') : '<p class="story-meta">尚未运行采集。</p>'}</section>
    <section class="drawer-section ai-pipeline-section"><div class="pipeline-heading"><div><span class="kicker">AI NEWSROOM FLOW</span><h3>打标与热点研判</h3></div><select id="batch-ai-provider" aria-label="批次模型">${providerOptions(preferred)}</select></div>
      <div class="pipeline-steps"><div class="${batch.hotspots.length?'done':''}"><b>01</b><span>采集<small>${batch.freshness?.fresh ?? batch.hotspots.length} 条有效${batch.freshness?.stale?` · ${batch.freshness.stale} 条旧闻归档`:''}</small></span></div><i>→</i><div class="${ai.tagged===ai.total&&ai.total?'done':ai.tagged?'active':''}"><b>02</b><span>语义打标<small>${ai.tagged} / ${ai.total}</small></span></div><i>→</i><div class="${researchDone?'done':ai.latestResearch?.status==='running'?'active':''}"><b>03</b><span>热点研判<small>${researchDone?'已生成总榜':'8+2 / H·B·P·S·D·F'}</small></span></div></div>
      <p>打标覆盖全量热点，生成事件语义指纹、地区、风险和预评估证据；研判随后完成全量聚类、核心 8 + 黑马 2、探索脑暴与临时复排。</p>
      <div class="pipeline-actions"><button class="primary-button" data-ai-tag ${!batch.hotspots.length?'disabled':''}>${ai.tagged?'继续打标':'开始打标'}</button><button class="ghost-button" data-ai-retag ${!batch.hotspots.length?'disabled':''}>重新打标全部</button><button class="ink-button" data-ai-research ${ai.tagged<ai.total||!ai.total?'disabled':''}>${researchDone?'重新执行热点研判':'生成热点研判'}</button></div>
      ${ai.tagged<ai.total&&ai.total?`<small class="pipeline-gate">还差 ${ai.total-ai.tagged} 条完整语义标注，完成后才能进入热点研判。</small>`:''}
      ${latestAiRun?.status==='failed'?`<div class="pipeline-error"><b>最近任务失败 · ${escapeHtml(latestAiRun.type)}</b><span>${escapeHtml(latestAiRun.error || latestAiRun.progress)}</span></div>`:''}
    </section>
    <section class="drawer-section"><h3>本批产物</h3><p>${batch.artifacts.length} 份已索引产物 · ${batch.hotspots.length} 条热点</p></section>
    <section class="drawer-section"><h3>执行日志</h3><div class="job-console" id="job-console">等待任务…</div></section>
  </div>`;
  $('#batch-drawer').showModal();
  if(mode==='archive'){$('.drawer-section',$('#batch-detail')).forEach(function(s){var h3=s.querySelector('h3');if(h3&&['采集今日热点','打标与热点研判','执行日志'].includes(h3.textContent))s.style.display='none';});}
}

async function startCollection() {
  const sources = $$('input[name=source]:checked', $('#batch-detail')).map((item) => item.value);
  if (!sources.length) return toast('至少选择一个数据源');
  const job = await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/collect`, { method: 'POST', body: JSON.stringify({ sources }) });
  $('#job-console').textContent = '任务已入队…';
  pollJob(job.id);
}

async function startBatchAi(type) {
  const provider = $('#batch-ai-provider')?.value;
  if (!provider) return toast('请先在模型中心配置服务商');
  const path = type === 'research' ? 'research' : 'tag';
  const payload = { provider, background:true, force:type === 'retag' };
  const job = await request(`/api/batches/${encodeURIComponent(state.currentBatch.id)}/ai/${path}`, { method:'POST',body:JSON.stringify(payload) });
  $('#job-console').textContent = type === 'research' ? '热点研判任务已入队…' : '语义打标任务已入队…';
  pollJob(job.id);
}

async function pollJob(id) {
  clearTimeout(state.jobTimer);
  try {
    const job = await request(`/api/jobs/${id}`);
    const logs = job.logs ?? [{ at:job.updated_at || new Date().toISOString(),message:job.progress }];
    const output = logs.map((line) => `${line.at.slice(11,19)}  ${line.message}`).join('\n') || job.progress;
    ['#job-console','#production-job-console'].forEach((selector) => {
      const consoleNode = $(selector); if (!consoleNode) return;
      consoleNode.textContent = output; consoleNode.scrollTop = consoleNode.scrollHeight;
    });
    if (job.status === 'running') state.jobTimer = setTimeout(() => pollJob(id), 1200);
    else {
      const successText = job.type === 'research' ? '热点研判完成，已进入选题池' : job.type === 'collect' ? '采集完成' : job.type === 'article' ? '完整成稿链已完成' : job.type === 'typeset' ? '公众号排版 HTML 已完成' : 'AI 打标完成';
      toast(job.status === 'completed' ? successText : `任务失败：${job.error || '未取得有效结果'}`);
      await loadOverview();
      if ($('.nav-item.active')?.dataset.view === 'overview') await loadAtlas();
      if (job.status === 'completed' && job.type === 'research') { $('#batch-drawer').close(); go('topics'); }
      else if (job.status === 'completed' && job.type === 'article') { go('editor'); await loadWritingDesk(); $('#writing-candidate').value=String(job.candidateId); $$('input[name=doc-kind]').find((item)=>item.value==='final').checked=true; loadSelectedDocument(); }
      else if (job.status === 'completed' && job.type === 'typeset') { await loadProductionPreview(); $('#typeset-candidate').value=String(job.candidateId); renderProductionCandidate(job.candidateId); await loadImageWorkspace(job.candidateId); }
      else await openBatch(job.batchId || job.batch_id);
    }
  } catch (error) { toast(error.message); }
}

function subscriptionTypeLabel(kind) {
  return { direct:'DIRECT', twitter:'X / TWITTER', rsshub:'RSSHUB' }[kind] || kind;
}

function updateSubscriptionComposer() {
  const kind = $('#subscription-kind').value;
  const input = $('#subscription-value');
  const label = $('#subscription-value-label');
  const labelWrap = $('#subscription-label-wrap');
  if (kind === 'twitter') {
    label.firstChild.textContent = 'X 用户名 ';
    input.type = 'text'; input.placeholder = '@OpenAI 或 OpenAI';
    labelWrap.hidden = true;
  } else if (kind === 'rsshub') {
    label.firstChild.textContent = 'RSSHub 路由 ';
    input.type = 'text'; input.placeholder = '/twitter/user/OpenAI 或 /readhub';
    labelWrap.hidden = true;
  } else {
    label.firstChild.textContent = '订阅地址 ';
    input.type = 'url'; input.placeholder = 'https://example.com/feed.xml';
    labelWrap.hidden = false;
  }
  $('#subscription-test-result').className = 'subscription-test-result';
  $('#subscription-test-result').textContent = '尚未测试。直连 RSS 不调用大模型，也不产生模型费用。';
}

function renderSubscriptions() {
  if (!state.subscriptions) return;
  const summary = state.subscriptions.summary;
  $('#subscription-summary').innerHTML = [
    ['TOTAL', summary.total, '全部入口'], ['ON DESK', summary.enabled, '当前启用'],
    ['DIRECT', summary.direct, '直连 Feed'], ['X SIGNAL', summary.twitter, '官方与博主'],
  ].map(([name,value,note]) => `<article><small>${name}</small><strong>${value}</strong><span>${note}</span></article>`).join('');
    
  const items = state.subscriptions.items.filter((item) => state.subscriptionFilter === 'all' || item.kind === state.subscriptionFilter);
  $('#subscription-list').innerHTML = items.length ? items.map((item, index) => {const health=item.health;const healthClass=health?.status==='success'?'ok':health?'bad':'idle';
    const healthText=health?.status==='success'?`最近成功 · ${health.item_count} 条 · ${(Number(health.duration_ms||0)/1000).toFixed(1)}s`:health?`最近${health.status==='interrupted'?'中断':'失败'} · ${health.error||'未返回内容'}`:'尚无采集记录';
    return `<article class="subscription-row ${item.enabled ? '' : 'disabled'} ${healthClass==='bad'?'has-error':''}" style="--row:${index}">
    <span class="subscription-kind ${escapeHtml(item.kind)}">${subscriptionTypeLabel(item.kind)}</span>
    <div class="subscription-identity"><b>${escapeHtml(item.label)}</b><code>${escapeHtml(item.value)}</code><small class="source-health ${healthClass}" title="${escapeHtml(health?.error||'')}">${escapeHtml(healthText)}</small></div>
    <label class="source-switch" title="启用或暂停"><input type="checkbox" data-source-toggle ${item.enabled ? 'checked' : ''} data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}"><i></i><span>${item.enabled ? '启用' : '暂停'}</span></label>
    <div class="subscription-actions"><button class="text-button" data-source-test data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}">测试</button><button class="source-remove" data-source-remove data-kind="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.value)}" aria-label="删除订阅">×</button></div>
  </article>`;}).join('') : '<div class="empty-state">这个分类下还没有订阅源。</div>';
}

async function loadSubscriptions() {
  state.subscriptions = await request('/api/subscriptions');
  renderSubscriptions();
}

function subscriptionFormPayload() {
  return { kind:$('#subscription-kind').value, value:$('#subscription-value').value.trim(), label:$('#subscription-label').value.trim() };
}

async function testSubscription(payload = subscriptionFormPayload(), button = null) {
  const output = $('#subscription-test-result');
  if (button) button.disabled = true;
  output.className = 'subscription-test-result testing'; output.textContent = '正在连接并解析 Feed…';
  try {
    const result = await request('/api/subscriptions/test', { method:'POST', body:JSON.stringify(payload) });
    output.className = 'subscription-test-result ok';
    output.textContent = `连接成功 · ${result.title} · 识别到 ${result.itemCount} 条内容`;
    return result;
  } catch (error) {
    output.className = 'subscription-test-result bad'; output.textContent = `测试失败：${error.message}`;
    throw error;
  } finally { if (button) button.disabled = false; }
}

async function addSubscriptionFromForm(event) {
  event.preventDefault();
  const payload = subscriptionFormPayload();
  state.subscriptions = await request('/api/subscriptions', { method:'POST', body:JSON.stringify(payload) });
  event.currentTarget.reset(); updateSubscriptionComposer(); renderSubscriptions();
  toast('订阅已写入本地配置，下一次采集生效');
}

async function toggleSubscription(input) {
  state.subscriptions = await request('/api/subscriptions', { method:'PATCH', body:JSON.stringify({ kind:input.dataset.kind, value:input.dataset.value, enabled:input.checked }) });
  renderSubscriptions();
  toast(input.checked ? '订阅已启用' : '订阅已暂停');
}

async function removeSubscription(button) {
  if (!confirm(`确定删除订阅“${button.dataset.value}”吗？`)) return;
  state.subscriptions = await request('/api/subscriptions', { method:'DELETE', body:JSON.stringify({ kind:button.dataset.kind, value:button.dataset.value }) });
  renderSubscriptions(); toast('订阅已删除');
}

async function checkHealth() {
  toast('正在检查采集环境…');
  const health = await request('/api/system/health');
  const reddit = $('#reddit-status'); const rss = $('#rsshub-status');
  reddit.textContent = health.reddit.ok ? `已连接 · ${health.reddit.tabs} 个标签页` : '未连接';
  reddit.className = `status-pill ${health.reddit.ok ? 'ok' : 'bad'}`;
  rss.textContent = health.rsshub.ok ? '服务运行中' : '当前未运行';
  rss.className = `status-pill ${health.rsshub.ok ? 'ok' : 'bad'}`;
  toast(`Reddit ${health.reddit.ok ? '可用' : '未连接'}；RSSHub ${health.rsshub.ok ? '运行中' : '按需启动'}`);
}

async function reindex() {
  const result = await request('/api/artifacts/reindex', { method: 'POST' });
  toast(`扫描完成，发现 ${result.indexed} 份产物`);
  loadArtifacts(); loadOverview();
}

async function loadLogs(logType) {
  const qs = logType ? `?type=${encodeURIComponent(logType)}&limit=150` : '?limit=150';
  const logs = await request('/api/logs' + qs);
  $('#log-count').textContent = `${logs.length} 条`;
  const typeLbl = { ai: 'AI 任务', source: '数据采集', model: '模型调用' }[logType] || '全部';
  $('#log-list').innerHTML = logs.length ? logs.map((item) => {
    const ts = (item.ts || '').slice(0, 19).replace('T', ' ');
    const statusClass = item.status === 'completed' || item.status === 'ok' || item.status === 'success' ? 'ok'
      : item.status === 'failed' || item.status === 'error' ? 'bad'
      : item.status === 'running' || item.status === 'testing' ? 'running' : 'idle';
    const typeLabel = item.log_type === 'ai' ? 'AI'
      : item.log_type === 'source' ? '采集'
      : item.log_type === 'model' ? '模型' : item.log_type;
    const subtypeLabel = item.subtype || '';
    const batchInfo = item.batch_id ? `<span class="log-batch">${escapeHtml(item.batch_id)}</span>` : '';
    const message = item.message || '';
    return `<article class="log-entry ${statusClass}">
      <div class="log-head"><span class="log-type-badge">${typeLabel}</span><time>${escapeHtml(ts)}</time>${batchInfo}<span class="log-status status-pill ${statusClass}">${escapeHtml(item.status)}</span></div>
      <div class="log-body"><code>${escapeHtml(subtypeLabel)}</code><span>${escapeHtml(message.slice(0, 200))}</span></div>
      ${item.provider ? `<div class="log-meta"><span>服务商：${escapeHtml(item.provider)}</span></div>` : ''}
    </article>`;
  }).join('') : '<div class="empty-state">暂无日志记录。</div>';
}


function getWeekParam(d){var w=d.getDay()||7;var t=new Date(d);t.setDate(d.getDate()-w+4);var j4=new Date(t.getFullYear(),0,4);var wn=Math.ceil((t-j4)/604800000+1);return t.getFullYear()+'-W'+String(wn).padStart(2,'0');}

async function loadCalendar(y,m){var n=new Date();if(y==null){y=n.getFullYear();m=n.getMonth()+1;}state.calYear=y;state.calMonth=m;var ms=y+'-'+String(m).padStart(2,'0');document.getElementById('cal-month-label').textContent=ms;var resp=await fetch('/api/articles?month='+encodeURIComponent(ms));var a=await resp.json();document.getElementById('cal-count').textContent=a.length+'偏';var dm={};for(var i=0;i<a.length;i++){var dd=a[i].batch_date?new Date(a[i].batch_date):new Date(a[i].updated_at);if(!isNaN(dd.getTime())){var day=dd.getDate();if(!dm[day])dm[day]=[];dm[day].push(a[i]);}}var fd=new Date(y,m-1,1);var ld=new Date(y,m,0).getDate();var sd=(fd.getDay()+6)%7;var h='<div class="cal-header-row">';['周一','周二','周三','周四','周五','周六','周日'].forEach(function(x){h+='<div class="cal-header">'+x+'</div>';});h+='</div>';var day=1;var end=false;for(var r=0;r<6&&!end;r++){h+='<div class="cal-week-row">';for(var c=0;c<7;c++){if((r===0&&c<sd)||day>ld){h+='<div class="cal-cell cal-empty-cell"></div>';}else{var items=dm[day]||[];var ist=day===n.getDate()&&m===n.getMonth()+1&&y===n.getFullYear();h+='<div class="cal-cell"><div class="cal-date-label">'+day+(ist?' <span class="cal-today-dot">\u25cf</span>':'')+'</div>';if(items.length){for(var ai=0;ai<items.length;ai++){var it=items[ai];var tt=(it.title||it.hotspot_title||'').slice(0,22);h+='<div class="cal-article" title="'+it.batch_date+' \u00b7 '+(it.pool_role||'')+'"><span style="cursor:pointer" data-cal-article="'+it.id+'">'+escapeHtml(tt)+'</span></div>';}}h+='</div>';day++;if(day>ld)end=true;}}h+='</div>';}document.getElementById('cal-grid').innerHTML=h;}

﻿