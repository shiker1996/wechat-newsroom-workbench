const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { overview: null, batches: [], currentBatch: null, activeBatchId: null, candidates: [], documents: [], models: null, jobTimer: null,
  atlas:null, atlasFilters:{scope:'全部',category:'全部',multi:false,query:''}, atlasSelectedWord:null, productionPreview:null, imageWorkspace:null,
  subscriptions:null, subscriptionFilter:'all' };
const stages = {
  collect: ['采集', 12], synthesis: ['研判', 32], editorial: ['编辑会', 48],
  drafting: ['成稿', 68], review: ['审稿', 82], typeset: ['排版', 92], preview: ['预览完成', 100],
};
const titles = { dashboard: '今日值班', batches: '每日批次', overview: '热点全景', topics: '选题池', editorial: '编辑室', editor: '文章编辑器', preview: '排版预览', hotspots: '热点档案', artifacts: '产物柜', system: '采集控制', sources: '订阅源台账', models: '模型中心', logs: '日志' };

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }, ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}

function formatDate(value, options = {}) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', ...options }).format(new Date(value));
}

function go(view) {
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $$('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`));
  $('#page-title').textContent = titles[view];
  if (view === 'batches') loadBatches();
  if (view === 'overview') loadAtlas();
  if (view === 'topics') loadTopicPool();
  if (view === 'editorial') loadEditorialRoom();
  if (view === 'editor') loadWritingDesk();
  if (view === 'preview') loadProductionPreview();
  if (view === 'hotspots') loadHotspots();
  if (view === 'artifacts') loadArtifacts();
  if (view === 'sources') loadSubscriptions();
  if (view === 'models') loadModels();
  if (view === 'logs') loadLogs();
  history.replaceState(null, '', `#${view}`);
}

async function loadOverview() {
  const [overview, batches] = await Promise.all([request('/api/overview'), request('/api/batches?limit=20')]);
  state.overview = overview;
  state.batches = batches;
  if (!state.activeBatchId && batches.length) state.activeBatchId = batches[0].id;
  renderBatchSwitcher();
  $('#edition-number').textContent = String(overview.hotspots).padStart(3, '0');
  $('#metrics').innerHTML = [
    ['EDITIONS', overview.batches, '累计编辑批次'],
    ['HOTSPOTS', overview.hotspots, '热点进入档案'],
    ['ARTIFACTS', overview.artifacts, '可追溯产物'],
    ['TODAY', batches.filter((b) => b.batch_date === localDate()).length, '今日进行中'],
  ].map(([label, value, note]) => `<article class="metric"><small>${label}</small><strong>${value}</strong><span>${note}</span></article>`).join('');
  renderLatest(overview.latest);
  renderSources(overview.sourceHealth);
}

function renderBatchSwitcher() {
  const switcher = $('#batch-switcher');
  switcher.innerHTML = state.batches.length
    ? state.batches.map((batch) => `<option value="${escapeHtml(batch.id)}" ${batch.id === state.activeBatchId ? 'selected' : ''}>${escapeHtml(batch.batch_date)} · ${escapeHtml(batch.title)}</option>`).join('')
    : '<option value="">暂无批次</option>';
}

function activeBatch() {
  return state.batches.find((batch) => batch.id === state.activeBatchId) ?? null;
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function renderLatest(batch) {
  const node = $('#latest-batch');
  if (!batch) { node.className = 'empty-state'; node.textContent = '还没有批次，先建立今天的编辑任务。'; return; }
  const [stageName, progress] = stages[batch.stage] ?? [batch.stage, 5];
  node.className = '';
  node.innerHTML = `<article class="latest-row" data-batch="${escapeHtml(batch.id)}">
    <div class="date-block">${formatDate(batch.batch_date)}<small>${escapeHtml(batch.batch_date)}</small></div>
    <div><h4>${escapeHtml(batch.title)}</h4><p>${stageName} · ${batch.hotspot_count} 条热点 · ${batch.artifact_count} 份产物</p><div class="progress-line"><i style="width:${progress}%"></i></div></div>
    <button class="outline-button">打开批次</button>
  </article>`;
}

function renderSources(sources) {
  const defaults = ['reddit', 'rsshub'];
  const byName = new Map(sources.map((item) => [item.source, item]));
  $('#source-health').innerHTML = defaults.map((source) => {
    const item = byName.get(source) ?? { status: 'unknown', item_count: 0 };
    const note = item.status === 'unknown' ? '尚未执行' : item.error || `${formatDate(item.ended_at, { hour: '2-digit', minute: '2-digit' })} 更新`;
    return `<div class="source-row ${item.status}"><i></i><div><strong>${source === 'reddit' ? 'Reddit' : 'RSSHub'}</strong><small>${escapeHtml(note)}</small></div><b>${item.item_count ?? 0}</b></div>`;
  }).join('');
}

async function loadBatches() {
  state.batches = await request('/api/batches?limit=100');
  $('#batch-list').innerHTML = state.batches.length ? state.batches.map((batch) => {
    const [stage] = stages[batch.stage] ?? [batch.stage];
    return `<article class="ledger-row" data-batch="${escapeHtml(batch.id)}">
      <div class="ledger-date">${escapeHtml(batch.batch_date.slice(5).replace('-', ' / '))}</div>
      <div class="ledger-title"><b>${escapeHtml(batch.title)}</b><small>${escapeHtml(batch.note || '暂无值班备注')}</small></div>
      <span class="stage-badge">${escapeHtml(stage)}</span>
      <div class="ledger-count">${batch.hotspot_count}<small>热点</small></div>
      <div class="ledger-count">${batch.artifact_count}<small>产物</small></div>
    </article>`;
  }).join('') : '<div class="empty-state">还没有历史批次。</div>';
}

async function loadHotspots(params = new URLSearchParams()) {
  const items = await request(`/api/hotspots?${params}`);
  $('#archive-summary').textContent = `当前找到 ${items.length} 条记录；历史热点会随每日批次持续累积。`;
  $('#hotspot-list').innerHTML = items.length ? items.map((item) => `<article class="story-row">
    <div class="story-source">${escapeHtml((item.source_name||item.source_group||item.source).toUpperCase())}</div>
    <div><h3>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</h3><div class="story-meta">采集批次 ${escapeHtml(item.batch_date)} · ${escapeHtml(item.category)}</div></div>
    <div class="scope-tag">${escapeHtml(item.market_scope)}</div><time class="story-date"><small>发布时间</small>${item.published_at ? escapeHtml(new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.published_at))) : '日期未知'}</time>
  </article>`).join('') : '<div class="empty-state">没有匹配的热点。完成一次采集后会出现在这里。</div>';
}

async function loadArtifacts() {
  const batchId = state.activeBatchId || '';
  const qs = batchId ? `?limit=300&batch_id=${encodeURIComponent(batchId)}` : '?limit=300';
  const [items, stats] = await Promise.all([
    request('/api/artifacts' + qs),
    request('/api/articles/stats').catch(()=>null)
  ]);
  if (stats) {
    $('#article-stats').innerHTML = [
      ['累计', stats.totalFinal, '篇已完结文章'],
      ['本月', stats.thisMonth, '篇'],
      ['本周', stats.thisWeek, '篇'],
    ].map(([label, value, note]) => `<div class="article-stat"><strong>${value}</strong><span>${label}<br><small>${note}</small></span></div>`).join('');
  }
  const batchLabel = activeBatch()?.batch_date || '全部批次';
  $('#artifact-list').innerHTML = items.length ? items.map((item) => {
    const ext = item.name.split('.').pop().toUpperCase();
    return `<article class="artifact-card" data-artifact="${item.id}"><span class="file-tab">${escapeHtml(ext)}</span><h3>${escapeHtml(item.kind)}</h3><p>${escapeHtml(item.name)}</p><footer><span>${Math.max(1, Math.round(item.size/1024))} KB</span><time>${formatDate(item.modified_at)}</time></footer></article>`;
  }).join('') : `<div class="empty-state"><strong>${escapeHtml(batchLabel)}</strong> 下没有产物。尝试切换到其他批次或重新扫描工作区。</div>`;
}

async function loadAtlas() {
  const batch = activeBatch();
  if (!batch) return;
  const [atlas, candidates] = await Promise.all([
    request(`/api/batches/${encodeURIComponent(batch.id)}/overview`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`).catch(()=>[]),
  ]);
  state.candidates = candidates;
  state.atlas=atlas; state.atlasFilters={scope:'全部',category:'全部',multi:false,query:''}; state.atlasSelectedWord=null;
  $$('#atlas-controls [data-atlas-scope]').forEach((button)=>button.classList.toggle('active',button.dataset.atlasScope==='全部'));
  $('#atlas-multisource').checked=false; $('#atlas-query').value='';
  $('#atlas-category').innerHTML='<option value="全部">全部分类</option>'+atlas.categories.map((item)=>`<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} · ${item.count}</option>`).join('');
  const gateText=atlas.gate.complete?'语义标注完整':`语义标注 ${atlas.taggedCount}/${atlas.totalArticles}`;
  $('#atlas-mode').textContent = `${batch.batch_date} · ${gateText} · ${atlas.eventCount} 个事件簇${atlas.excludedStale?` · 已排除 ${atlas.excludedStale} 条旧闻`:''}`;
  $('#atlas-mode').className=atlas.gate.valid&&atlas.gate.complete?'atlas-gate-ok':'atlas-gate-warn';
  $('#atlas-metrics').innerHTML = [
    [atlas.totalArticles,'有效报道'],[atlas.eventCount,'语义事件'],[atlas.multiSourceCount,'多源事件'],[atlas.sourceCount,'不同来源'],[atlas.excludedStale,'旧闻归档'],
  ].map(([value,label]) => `<div class="atlas-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  renderAtlas();
}

function atlasEvents() {
  const filters=state.atlasFilters; const needle=filters.query.trim().toLowerCase();
  return (state.atlas?.events||[]).filter((event)=>{
    if(filters.scope!=='全部'&&event.market_scope!==filters.scope)return false;
    if(filters.category!=='全部'&&event.topic_category!==filters.category)return false;
    if(filters.multi&&event.source_count<2)return false;
    if(!needle)return true;
    return [event.representative_title,event.china_relevance_reason,...(event.keywords||[]),...(event.articles||[]).flatMap((article)=>[article.title,article.source])].join(' ').toLowerCase().includes(needle);
  });
}

function atlasWords(events) {
  const generic=new Set(['ai','公司','发布','消息','最新','回应','宣布','科技','行业','全球','技术','产品','平台','企业','市场','今日','新闻']);
  const weights=new Map();
  events.forEach((event)=>{ const multiplier=1+Math.log2(1+Math.max(1,event.source_count));
    [...new Set(event.keywords||[])].forEach((raw)=>{const word=String(raw).trim();if(!word||generic.has(word.toLowerCase()))return;weights.set(word,(weights.get(word)||0)+multiplier);});
  });
  return [...weights].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,40);
}

function riskClass(value) { const text=String(value||''); return text.includes('高')?'high':text.includes('中')?'medium':text.includes('低')?'low':'unknown'; }
function externalUrl(value) { return /^https?:\/\//i.test(String(value||'')) ? String(value) : ''; }

function renderAtlas() {
  const atlas=state.atlas;if(!atlas)return; const events=atlasEvents();
  $('#atlas-filter-count').textContent=`显示 ${events.length} / ${atlas.eventCount} 个事件`;
  const scopeTotal=Math.max(1,events.length); const scopeColors={国内:'var(--red)',全球性:'var(--yellow)',国外:'var(--mint)'};
  $('#scope-distribution').innerHTML=['国内','全球性','国外'].map((scope)=>{const count=events.filter((event)=>event.market_scope===scope).length;return `<div class="scope-meter"><span>${scope}</span><div><i style="width:${count/scopeTotal*100}%;background:${scopeColors[scope]}"></i></div><b>${count}</b></div>`;}).join('');
  const sourceMap=new Map();events.forEach((event)=>[...new Set(event.articles.map((article)=>article.source).filter(Boolean))].forEach((source)=>sourceMap.set(source,(sourceMap.get(source)||0)+1)));
  const sources=[...sourceMap].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,14),maxSource=sources[0]?.[1]||1;
  $('#channel-bars').innerHTML=sources.map(([name,count])=>`<div class="bar-row"><span>${escapeHtml(name)}</span><div class="bar-track"><i style="width:${Math.max(3,count/maxSource*100)}%"></i></div><b>${count}</b></div>`).join('')||'<div class="empty-state">当前筛选下没有来源</div>';
  const words=atlasWords(events),maxWord=words[0]?.[1]||1;
  // Word cloud
  const wordSummaries = state.atlas.keywords || [];
  $('#keyword-cloud').innerHTML=words.map(([word,weight],index)=>{
    const ws = wordSummaries.find(w => w.name === word);
    const summary = ws?.summary || '';
    const isActive = state.atlasSelectedWord === word;
    return `<button style="font-size:${12+Math.round(Math.sqrt(weight/maxWord)*30)}px;--word-delay:${Math.min(index,18)*18}ms${isActive ? ';--word-active:true' : ''}" title="${summary ? escapeHtml(summary.slice(0, 100)) : '事件覆盖权重 '+weight.toFixed(1)}" class="${isActive?'cloud-word-active':''}" data-atlas-word="${escapeHtml(word)}">${escapeHtml(word)}</button>`;
  }).join('')||'<span class="cloud-empty">当前筛选下没有可区分的议题词</span>';
  // Hotword summary panel (shown when a word is selected)
  const selectedWord = state.atlasSelectedWord;
  let hotwordHTML = '';

  if (selectedWord) {
    const ws = wordSummaries.find(w => w.name === selectedWord);
    const matchedCount = events.filter(event => (event.keywords||[]).some(kw => kw.toLowerCase().includes(selectedWord.toLowerCase()))).length;
    if (ws?.summary) {
      hotwordHTML = `<div class="hotword-summary-panel">
        <div class="hotword-summary-head"><span class="kicker">HOTWORD OVERVIEW</span><h3>“${escapeHtml(selectedWord)}” 热词综述</h3></div>
        <p>${escapeHtml(ws.summary)}</p>
        <div class="hotword-actions"><button class="ink-button" data-hotword-composite="${escapeHtml(selectedWord)}">以“${escapeHtml(selectedWord)}”创建综合选题 →</button><span class="muted">覆盖 ${matchedCount} 个关联事件</span></div>
      </div>`;
    } else {
      hotwordHTML = `<div class="hotword-summary-panel dim"><div class="hotword-summary-head"><span class="kicker">HOTWORD OVERVIEW</span><h3>“${escapeHtml(selectedWord)}”</h3></div><p>该热词尚无 AI 综述。</p>
        <div class="hotword-actions"><button class="outline-button" data-hotword-composite="${escapeHtml(selectedWord)}">以此热词创建综合选题 →</button><button class="text-button" data-hotword-gen-summary="${escapeHtml(selectedWord)}">生成 AI 综述</button><span class="muted">覆盖 ${matchedCount} 个关联事件</span></div>
      </div>`;
    }
  }

  // Build the hotword index — show keyword cards, prefer those with AI summaries
  let wordCards = wordSummaries.filter(w => w.summary);
  if (!wordCards.length) wordCards = wordSummaries.slice(0, 20);
  // If a hotword is selected, only show the matching card
  if (selectedWord) { wordCards = wordCards.filter(w => w.name === selectedWord); }
  const indexHTML = wordCards.map(kw => {
    const matchedEvents = events.filter(event => (event.keywords||[]).some(w => w.toLowerCase() === kw.name.toLowerCase()));
    const count = matchedEvents.length;
    const isActive = kw.name === selectedWord;
    // Expand matched events as references when the card is active
    const eventRefs = isActive && matchedEvents.length
      ? `<details class="hotword-index-refs" open><summary>${count} 个关联事件</summary>${matchedEvents.map(event => {
          const links = event.articles.map(article => {
            const url = externalUrl(article.url);
            const origin = article.channel && article.channel !== article.source ? `${article.source} · ${article.channel}` : article.source;
            return url
              ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><span>${escapeHtml(article.title)}</span><b>${escapeHtml(origin)}</b></a>`
              : `<span class="event-source-static"><span>${escapeHtml(article.title)}</span><b>${escapeHtml(origin)}</b></span>`;
          }).join('');
          return `<div class="hotword-event-ref"><span>${escapeHtml(event.representative_title)}</span><div class="hotword-event-links">${links}</div></div>`;
        }).join('')}</details>`
      : '';
    return `<article class="hotword-index-card${isActive ? ' hotword-index-active' : ''}" data-atlas-word="${escapeHtml(kw.name)}">
      <div class="hotword-index-head">
        <h4>${escapeHtml(kw.name)}</h4>
        <span class="muted">${count} 个事件</span>
      </div>
      <p>${kw.summary ? escapeHtml(kw.summary) : '<span class="muted">尚无 AI 综述。点击词云中的热词查看关联事件，或生成综述。</span>'}</p>
      ${eventRefs}
    </article>`;
  }).join('');
  $('#coverage-list').innerHTML = (hotwordHTML ? hotwordHTML : '') + indexHTML;
}

async function loadTopicPool() {
  const batch = activeBatch();
  if (!batch) return;
  const [detail, candidates] = await Promise.all([
    request(`/api/batches/${encodeURIComponent(batch.id)}`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
  ]);
  state.currentBatch = detail;
  state.candidates = candidates;
  renderCandidates(candidates);
}

function renderPoolSources(items, query = '') {
  const needle = query.trim().toLowerCase();
  const pooled = new Set(state.candidates.map((item) => item.hotspot_id));
  const filtered = items.filter((item) => !needle || item.title.toLowerCase().includes(needle));
  // Group by eventKey for easier composite selection
  const eventGroups = new Map();
  const noKey = [];
  for (const item of filtered) {
    let raw={}; try{raw=JSON.parse(item.raw_json||'{}');}catch{}
    const eventKey = raw?.aiTags?.eventKey || '';
    if (eventKey) {
      if (!eventGroups.has(eventKey)) eventGroups.set(eventKey,[]);
      eventGroups.get(eventKey).push(item);
    } else noKey.push(item);
  }
  const grouped = [...eventGroups].sort((a,b) => b[1].length - a[1].length);
  let html = '';
  for (const [eventKey, group] of grouped) {
    html += `<div class="pool-event-group"><span class="pool-event-key">${escapeHtml(eventKey)}</span>`;
    for (const item of group) {
      html += `<div class="pool-source-row ${item.is_stale?'stale':''}"><input type="checkbox" value="${item.id}" ${pooled.has(item.id)||item.is_stale ? 'disabled' : ''}><small>${escapeHtml((item.source_name||item.source_group||item.source).toUpperCase())}</small><label>${escapeHtml(item.title)}${pooled.has(item.id) ? ' · 已入池' : item.is_stale ? ' · 旧闻，仅保留在档案' : ''}</label></div>`;
    }
    html += '</div>';
  }
  for (const item of noKey) {
    html += `<div class="pool-source-row ${item.is_stale?'stale':''}"><input type="checkbox" value="${item.id}" ${pooled.has(item.id)||item.is_stale ? 'disabled' : ''}><small>${escapeHtml((item.source_name||item.source_group||item.source).toUpperCase())}</small><label>${escapeHtml(item.title)}${pooled.has(item.id) ? ' · 已入池' : item.is_stale ? ' · 旧闻，仅保留在档案' : ''}</label></div>`;
  }
  $('#pool-source-list').innerHTML = html || '<div class="empty-state">没有匹配热点</div>';
}

function scoreValue(value) { return value == null ? '—' : Number(value).toFixed(value % 1 ? 1 : 0); }

function renderCandidates(candidates) {
  $('#candidate-count').textContent = `${candidates.length} 条`;
  $('#candidate-list').innerHTML = candidates.length ? candidates.map((item) => `<article class="candidate-card ${item.composite?'composite':''}" data-id="${escapeHtml(item.candidate_id)}">
    <h4>${escapeHtml(item.hotspot_title)}${item.composite ? ' <span class="composite-tag">综合</span>' : ''}</h4><div class="candidate-meta"><span>${escapeHtml(item.pool_role)}</span><span>${item.composite ? '多源综合' : escapeHtml(item.source_name||item.source_group||item.source)}</span><span>风险 ${escapeHtml(item.risk_level)}</span></div>
    <div class="score-strip">${['h','b','p','s','d','f'].map((key) => `<span>${key.toUpperCase()}<b>${scoreValue(item[`${key}_score`])}</b></span>`).join('')}</div>
    <div class="candidate-actions"><span class="status-pill">${escapeHtml(item.brief_status || item.status)}</span><button class="text-button" data-editorial-id="${item.id}">进入编辑室 →</button>${item.status !== 'locked' && item.status !== 'drafting' && item.status !== 'review' && item.status !== 'preview' && item.status !== 'published' ? `<button class="text-button muted" data-remove-candidate="${item.id}">移除</button>` : ''}</div>
  </article>`).join('') : '<div class="empty-state">暂无候选。在热点全景中通过事件归纳卡片创建综合选题，AI 研判后自动填充评分。</div>';
}

async function createCompositeFromEvent(batchId, eventIndex, eventTitle) {
  const title = prompt('综合选题名称（可选，默认以事件标题命名）：', eventTitle) || eventTitle;
  // Use the existing composite API instead of the event-specific one
  const event = state.atlas?.events?.[eventIndex-1];
  if (!event?.hotspot_ids?.length) return toast('该事件簇没有关联的热点');
  const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
    method:'POST', body:JSON.stringify({hotspotIds:event.hotspot_ids, title, poolRole:'综合选题'})
  });
  toast(`已从事件簇创建综合选题：${candidate.candidate_id}`);
  loadTopicPool();
  if ($('.nav-item.active')?.dataset.view === 'overview') await loadAtlas();
}

async function generateHotwordSummary(batchId, hotword) {
  const res = await request(`/api/batches/${encodeURIComponent(batchId)}/hotword-summary/${encodeURIComponent(hotword)}`, { method: 'POST' });
  return res;
}

async function createCompositeFromHotword(batchId, hotword) {
  if (!state.atlas) return toast('请先加载热点全景');
  // Collect all hotspot_ids from events that contain this hotword in their keywords
  const needle = hotword.toLowerCase();
  const matchedEvents = state.atlas.events.filter(event =>
    (event.keywords||[]).some(kw => kw.toLowerCase().includes(needle))
  );
  const hotspotIds = [...new Set(matchedEvents.flatMap(e => e.hotspot_ids || []))];
  if (hotspotIds.length < 2) return toast('该热词关联的热点不足以创建综合选题');
  const title = `关于「${hotword}」的近期热点综述`;
  const candidate = await request(`/api/batches/${encodeURIComponent(batchId)}/candidates/composite`, {
    method:'POST', body:JSON.stringify({hotspotIds, title, poolRole:'综合选题'})
  });
  toast(`已创建综合选题：${candidate.candidate_id}（${hotspotIds.length} 个来源）`);
  loadTopicPool();
}

async function loadEditorialRoom(selectedId = null) {
  const batch = activeBatch();
  if (!batch) return;
  state.candidates = await request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`);
  $('#editorial-candidates').innerHTML = state.candidates.length ? state.candidates.map((item) => `<button class="editorial-candidate ${Number(selectedId)===item.id?'active':''}" data-edit-candidate="${item.id}"><b>${escapeHtml(item.candidate_id)} · ${escapeHtml(item.brief_status || 'DISCUSS')}</b><span>${escapeHtml(item.hotspot_title)}</span></button>`).join('') : '<div class="empty-state">选题池为空</div>';
  if (state.candidates.length) await openEditorial(selectedId || state.candidates[0].id);
  else { $('#editorial-empty').hidden = false; $('#editorial-fields').hidden = true; }
}

async function openEditorial(id) {
  if (!state.models) state.models = await request('/api/models');
  const candidate = await request(`/api/candidates/${id}`);
  $$('.editorial-candidate').forEach((item) => item.classList.toggle('active', Number(item.dataset.editCandidate) === Number(id)));
  $('#editorial-empty').hidden = true; $('#editorial-fields').hidden = false;
  const form = $('#editorial-form');
  form.elements.candidateId.value = candidate.id;
  form.elements.angle.value = candidate.angle || '';
  form.elements.thesis.value = candidate.thesis || '';
  const editorial = candidate.editorial;
  for (const key of ['editor_question','confirmed_facts','author_opinions','confirmed_experiences','rejected_angles','open_questions','forbidden_claims','next_action']) form.elements[key].value = editorial[key] || '';
  form.elements.experience_required.checked = Boolean(editorial.experience_required);
  $('#editorial-candidate-id').textContent = candidate.candidate_id;
  $('#editorial-hotspot-title').textContent = candidate.hotspot_title;
  $('#editorial-composite-badge').hidden = !candidate.composite;
  $('#brief-state').textContent = editorial.brief_status;
  const preferred=state.models.providers.find((item)=>item.configured)?.name||state.models.defaultProvider;
  $('#editorial-provider').innerHTML=providerOptions(preferred);
  if (candidate.composite && candidate.source_documents) {
    const docs=candidate.source_documents;
    const okCount=docs.filter(d=>d.source?.status==='ok').length;
    const total=docs.length;
    const firstOk=docs.find(d=>d.source?.status==='ok');
    $('#source-evidence').className=`source-evidence ${okCount===total?'ready':okCount?'partial':'missing'}`;
    $('#source-evidence-title').textContent=okCount===total?`全部 ${total} 个来源已抓取`:`${okCount}/${total} 个来源已抓取`;
    $('#source-evidence-meta').textContent=docs.map(d=>`${d.title||d.source?.title||'未知来源'}`).join(' · ');
    $('#source-evidence-excerpt').innerHTML=docs.map((d,i)=>{
      const content=d.source?.content||'';
      return `<details><summary>来源 ${i+1}：${escapeHtml(d.title||d.source?.title||'来源')}</summary><p>${escapeHtml(content.slice(0,800))}</p></details>`;
    }).join('');
    $('#source-evidence-details').hidden=false;
  } else {
    const source=candidate.source_document; const sourceOk=source?.status==='ok'; const sourcePartial=source?.status==='partial';
    $('#source-evidence').className=`source-evidence ${sourceOk?'ready':sourcePartial?'partial':source?'failed':'missing'}`;
    const method=source?.fetch_method==='firecrawl-mcp'?'Firecrawl MCP':source?.fetch_method==='python-fallback'?'Python 回退':source?.fetch_method==='python'?'Python':'来源抓取';
    $('#source-evidence-title').textContent=sourceOk?`${method} · 已抓取 ${source.content_chars} 字`:sourcePartial?`${method} · 仅取得部分内容 ${source.content_chars} 字`:source?`${method}失败 · ${source.error||'未知原因'}`:'原文尚未抓取';
    $('#source-evidence-meta').textContent=source?`${source.title||candidate.hotspot_title}${source.author?` · ${source.author}`:''}${source.published_at?` · ${source.published_at}`:''}`:'AI 编辑会开始前会自动获取公开原文。';
    $('#source-evidence-excerpt').innerHTML=source?.content?`<p>${escapeHtml(source.content.slice(0,1600))}</p>`:(source?.description?`<p>${escapeHtml(source.description)}</p>`:'暂无可展示的来源摘录。');
    $('#source-evidence-details').hidden=!source;
  }
  $('#editorial-messages').innerHTML=candidate.messages?.length?candidate.messages.map((message)=>`<div class="editorial-message ${escapeHtml(message.role)}"><b>${message.role==='user'?'你':'AI 编辑'}</b><p>${escapeHtml(message.content).replaceAll('\n','<br>')}</p></div>`).join(''):`<div class="editorial-chat-empty">尚未开始编辑会。点击“让 AI 提问”。</div>`;
  $('#editorial-messages').scrollTop=$('#editorial-messages').scrollHeight;
  state.editorialCandidate = candidate;
  renderEditorialReadiness();
}

function editorialReadiness() {
  const form = $('#editorial-form');
  const text = (name) => form.elements[name]?.value?.trim() || '';
  return [
    { label:'锁定命题', ok:Boolean(text('thesis')) },
    { label:'事实基座', ok:Boolean(text('confirmed_facts')) },
    { label:'未决问题清零', ok:!text('open_questions') },
    { label:'可以立即写作', ok:text('next_action') === 'WRITE_NOW' },
    { label:'实践证据', ok:!form.elements.experience_required.checked || Boolean(text('confirmed_experiences')) },
  ];
}

function renderEditorialReadiness() {
  const gate = $('#editorial-production-gate');
  if (!gate || $('#editorial-fields').hidden) return;
  const checks = editorialReadiness();
  const passed = checks.filter((item) => item.ok).length;
  const ready = passed === checks.length;
  const locked = (state.editorialCandidate?.brief_status || state.editorialCandidate?.editorial?.brief_status) === 'LOCKED';
  gate.classList.toggle('ready', ready);
  $('#editorial-gate-count').textContent = `${passed} / ${checks.length}`;
  $('#editorial-gate-checks').innerHTML = checks.map((item) => `<span class="editorial-gate-check ${item.ok?'done':''}">${escapeHtml(item.label)}</span>`).join('');
  $('#editorial-production-title').textContent = ready ? '编辑决策已完整，可以进入成稿' : '尚未达到成稿条件';
  $('#editorial-production-hint').textContent = ready ? '点击后会保存当前决策、锁定文章简报，并运行完整成稿链。' : `还需完成：${checks.filter((item)=>!item.ok).map((item)=>item.label).join('、')}`;
  const button = $('#start-editorial-production');
  button.hidden = !ready;
  button.textContent = locked ? '重新运行完整成稿链' : '确认简报并开始成稿';
}

async function fetchEditorialSource() {
  const candidateId=Number($('#editorial-form').elements.candidateId.value);if(!candidateId)return;
  const button=$('#fetch-source');button.disabled=true;button.textContent='正在抓取原文…';
  try {const source=await request(`/api/candidates/${candidateId}/source`,{method:'POST',body:JSON.stringify({force:true})});await openEditorial(candidateId);toast(source.status==='ok'?`已抓取 ${source.content_chars} 字原文`:`原文抓取未完整：${source.error}`);}
  finally {button.disabled=false;button.textContent='抓取 / 刷新原文';}
}

async function sendEditorialAnswer() {
  const candidateId=Number($('#editorial-form').elements.candidateId.value); if(!candidateId)return;
  const button=$('#send-editorial-answer');const answer=$('#editorial-answer').value.trim();
  const messages=$('#editorial-messages');
  $('.editorial-chat-empty',messages)?.remove();
  if(answer)messages.insertAdjacentHTML('beforeend',`<div class="editorial-message user"><b>你</b><p>${escapeHtml(answer).replaceAll('\n','<br>')}</p></div>`);
  const streamMessage=document.createElement('div');streamMessage.className='editorial-message assistant streaming';
  streamMessage.innerHTML='<b>AI 编辑 · 实时回应</b><p></p>';messages.append(streamMessage);messages.scrollTop=messages.scrollHeight;
  const streamText=$('p',streamMessage);button.disabled=true;button.textContent='AI 正在回应…';
  try {
    const response=await fetch(`/api/candidates/${candidateId}/ai/editorial/stream`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:$('#editorial-provider').value,answer})});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`HTTP ${response.status}`);}
    if(!response.body)throw new Error('浏览器未收到流式响应');
    const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let completed=false;
    const consume=(line)=>{if(!line.trim())return;const event=JSON.parse(line);
      if(event.type==='delta'){streamText.textContent+=event.text||'';messages.scrollTop=messages.scrollHeight;}
      if(event.type==='error')throw new Error(event.error||'编辑会调用失败');
      if(event.type==='done')completed=true;
    };
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)consume(line);}
    buffer+=decoder.decode();if(buffer.trim())consume(buffer);
    if(!completed)throw new Error('编辑会连接提前结束，请重试');
    $('#editorial-answer').value='';streamMessage.classList.remove('streaming');await openEditorial(candidateId);toast('编辑会决策已更新');
  } catch(error) {
    streamMessage.classList.remove('streaming');streamMessage.classList.add('failed');
    if(!streamText.textContent)streamText.textContent=`调用失败：${error.message}`;
    throw error;
  } finally {button.disabled=false;button.textContent='发送回答 / 让 AI 提问';}
}

async function persistEditorialForm({ refresh = true } = {}) {
  const form = $('#editorial-form');
  const candidateId = Number(form.elements.candidateId.value);
  if (!candidateId) return null;
  await request(`/api/candidates/${candidateId}`, { method:'PATCH', body:JSON.stringify({angle:form.elements.angle.value,thesis:form.elements.thesis.value}) });
  const fields = ['editor_question','confirmed_facts','author_opinions','confirmed_experiences','rejected_angles','open_questions','forbidden_claims','next_action'];
  const editorial = Object.fromEntries(fields.map((key) => [key, form.elements[key].value]));
  editorial.experience_required = form.elements.experience_required.checked ? 1 : 0;
  await request(`/api/candidates/${candidateId}/editorial`, { method:'PUT', body:JSON.stringify(editorial) });
  if (refresh) await openEditorial(candidateId);
  return candidateId;
}

async function saveEditorial(event) {
  event.preventDefault();
  await persistEditorialForm();
  toast('编辑决策已保存');
}

async function startEditorialProduction() {
  const button = $('#start-editorial-production');
  button.disabled = true;
  button.textContent = '正在确认简报…';
  try {
    const candidateId = await persistEditorialForm({ refresh:false });
    if (!candidateId) return;
    await request(`/api/candidates/${candidateId}/lock`, { method:'POST' });
    openProductionJob('完整成稿链', '简报已确认，正在校验事实基座与创作门禁…');
    const provider = $('#editorial-provider').value;
    const job = await request(`/api/candidates/${candidateId}/ai/article`, { method:'POST', body:JSON.stringify({ provider }) });
    pollJob(job.id);
    await loadOverview();
  } finally {
    button.disabled = false;
    renderEditorialReadiness();
  }
}

async function loadWritingDesk() {
  const batch = activeBatch();
  if (!batch) return;
  const [candidates, documents] = await Promise.all([
    request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/documents`),
  ]);
  state.candidates = candidates.filter((item) => item.brief_status === 'LOCKED');
  state.documents = documents;
  const select = $('#writing-candidate');
  select.innerHTML = state.candidates.length ? state.candidates.map((item) => `<option value="${item.id}">${escapeHtml(item.candidate_id)} · ${escapeHtml(item.hotspot_title)}</option>`).join('') : '<option value="">没有已锁定候选</option>';
  select.disabled = !state.candidates.length; $('#save-document').disabled = !state.candidates.length;
  await ensureModelOptions();
  loadSelectedDocument();
}

function providerOptions(selected) {
  const providers = state.models?.providers ?? [];
  return providers.map((item) => `<option value="${escapeHtml(item.name)}" ${item.name === selected ? 'selected' : ''}>${escapeHtml(item.label)} · ${escapeHtml(item.model)}${item.configured ? '' : '（未配置）'}</option>`).join('');
}

function updateEditorialSearchToggle() {
  const providerName = $('#editorial-provider')?.value;
  const provider = (state.models?.providers ?? []).find(p => p.name === providerName);
  const toggle = $('#editorial-search-toggle');
  if (!toggle) return;
  toggle.hidden = !(provider?.supportsWebSearch);
}

async function ensureModelOptions() {
  if (!state.models) state.models = await request('/api/models');
  const selected = state.models.defaultProvider;
  $('#draft-provider').innerHTML = providerOptions(selected);
}

async function loadModels() {
  state.models = await request('/api/models');
  const data = state.models;
  $('#model-cards').innerHTML = data.providers.map((item) => `<article class="model-card ${item.configured ? 'configured' : 'missing'}">
    <span class="status-pill ${item.configured ? 'ok' : 'bad'}">${item.configured ? '已配置' : '未配置'}</span>
    <span class="kicker">${escapeHtml(item.name.toUpperCase())}</span><h3>${escapeHtml(item.label)}</h3><code>${escapeHtml(item.model)}</code>
    <dl><dt>上下文上限</dt><dd>${Number(item.contextWindow).toLocaleString()}</dd><dt>输出上限</dt><dd>${Number(item.maxOutputTokens).toLocaleString()}</dd><dt>密钥变量</dt><dd>${escapeHtml(item.apiKeyEnv)}</dd></dl>
  </article>`).join('');
  $('#model-provider').innerHTML = providerOptions(data.defaultProvider);
  $('#draft-provider').innerHTML = providerOptions(data.defaultProvider);
  const completed = data.calls.filter((item) => item.status === 'completed').length;
  const compressed = data.calls.filter((item) => item.compressed).length;
  $('#call-summary').textContent = `${data.calls.length} 次记录 · ${completed} 次成功 · ${compressed} 次压缩`;
  $('#model-call-list').innerHTML = data.calls.length ? data.calls.map((item) => `<div class="call-row">
    <time>${escapeHtml(item.created_at.slice(0,19).replace('T',' '))}</time><div><b>${escapeHtml(item.provider)} · ${escapeHtml(item.model)}</b><small>${escapeHtml(item.purpose)}${item.error ? ` · ${escapeHtml(item.error)}` : ''}</small></div>
    <span>${item.prompt_tokens ?? `≈${item.estimated_input_tokens}`} / ${item.completion_tokens ?? '—'} tok</span><span>${item.compressed ? '已压缩' : '原上下文'}</span><span class="${item.status === 'completed' ? 'ok' : 'bad'}">${escapeHtml(item.status)}</span>
  </div>`).join('') : '<div class="empty-state">尚无模型调用。测试连接也会留下审计记录。</div>';
}

async function testModel() {
  const button = $('#test-model'); button.disabled = true; button.textContent = '正在测试…';
  try {
    const result = await request('/api/models/test', { method:'POST', body:JSON.stringify({ provider:$('#model-provider').value }) });
    toast(`${result.provider} / ${result.model} 已连接：${result.reply.trim()}`);
    await loadModels();
  } finally { button.disabled = false; button.textContent = '最小请求测试连接'; }
}

async function aiTagBatch() {
  const batch = activeBatch();
  if (!batch) return toast('请先建立并选择一个批次');
  const button = $('#ai-tag-batch'); button.disabled = true; button.textContent = '打标中，请勿关闭…';
  try {
    const result = await request(`/api/batches/${encodeURIComponent(batch.id)}/ai/tag`, { method:'POST', body:JSON.stringify({
      provider:$('#model-provider').value, limit:Number($('#tag-limit').value) || 60,
    }) });
    toast(`AI 打标完成：${result.updated} / ${result.requested} 条`);
    await Promise.all([loadModels(), loadOverview()]);
  } finally { button.disabled = false; button.textContent = 'AI 打标当前批次'; }
}

async function aiDraft() {
  const candidateId = Number($('#writing-candidate').value);
  if (!candidateId) return toast('先在编辑室锁定文章简报');
  const button = $('#ai-draft'); button.disabled = true; button.textContent = '模型创作中…';
  try {
    const result = await request(`/api/candidates/${candidateId}/ai/draft`, { method:'POST', body:JSON.stringify({
      provider:$('#draft-provider').value, instructions:$('#draft-instructions').value,
      existingDraft:$('#markdown-editor').value,
    }) });
    $('#markdown-editor').value = result.content; renderMarkdown();
    $('#draft-context').textContent = `${result.provider} · ${result.model} · 输入约 ${result.context.afterTokens} tokens${result.context.compressed ? ' · 已压缩历史上下文' : ' · 未触发压缩'} · 尚未保存`;
    toast('模型结果已放入编辑器，请审阅后保存');
  } finally { button.disabled = false; button.textContent = 'AI 生成 / 改写'; }
}

function openProductionJob(title, initial = '任务已入队…') {
  $('#production-job-title').textContent = title;
  $('#production-job-console').textContent = initial;
  const dialog = $('#production-job-dialog');
  if (!dialog.open) dialog.showModal();
}

async function runTypeset(mode) {
  const candidateId = Number($('#typeset-candidate').value);
  if (!candidateId) return toast('请先运行完整成稿链，生成 09-FINAL.md');
  const provider = $('#typeset-provider').value;
  openProductionJob('生成公众号排版 HTML', '正在检查终稿和排版输入…');
  const job = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/ai/typeset`, {
    method:'POST', body:JSON.stringify({ candidateId, provider, mode }),
  });
  pollJob(job.id);
}

function selectedDocKind() { return $('input[name=doc-kind]:checked')?.value || 'draft'; }

async function loadSelectedDocument() {
  const candidateId = Number($('#writing-candidate').value);
  const kind = selectedDocKind();
  let document = state.documents.find((item) => item.candidate_row_id === candidateId && item.kind === kind);
  // 草稿未存入 documents 表时，从 artifacts 读取 04-draft.md
  if (!document && kind === 'draft') {
    try {
      const artifacts = await request('/api/artifacts?limit=300');
      const draftArtifact = artifacts.find((item) => item.kind === '文章初稿');
      if (draftArtifact) {
        const res = await request(`/api/artifacts/${draftArtifact.id}/content`);
        if (res?.text) document = { title: '草稿', content: res.text };
      }
    } catch {}
  }
  const candidate = state.candidates.find((item) => item.id === candidateId);
  $('#article-title').value = document?.title || candidate?.hotspot_title || '';
  $('#markdown-editor').value = document?.content || (candidate ? `# ${candidate.hotspot_title}\n\n` : '');
  renderMarkdown();
}

function visibleChars(markdown) {
  return markdown.replace(/^#.*$/gm,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`>#-]/g,'').replace(/\s/g,'').length;
}

function markdownHtml(markdown) {
  const safe = escapeHtml(markdown);
  return safe.split(/\n{2,}/).map((block) => {
    if (/^\|.*\|/.test(block)) {
      const rows = block.trim().split('\n').filter(Boolean);
      if (rows.length < 2) return `<p>${block.replaceAll('\n','<br>')}</p>`;
      // skip separator row
      const dataRows = rows.filter(r => !/^\|\s*-+\s*\|/.test(r));
      const heads = dataRows[0].split('|').filter(Boolean).map(c => c.trim());
      const body = dataRows.slice(1).map(row => {
        const cells = row.split('|').filter(Boolean).map(c => c.trim());
        return `<tr>${cells.map((c,i) => `<td>${c}</td>`).join('')}</tr>`;
      }).join('');
      return `<table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
    }
    if (block.startsWith('## ')) return `<h2>${block.slice(3)}</h2>`;
    if (block.startsWith('# ')) return `<h1>${block.slice(2)}</h1>`;
    if (block.startsWith('&gt; ')) return `<blockquote>${block.slice(5).replaceAll('\n','<br>')}</blockquote>`;
    if (/^- /m.test(block)) return `<ul>${block.split('\n').filter(Boolean).map((line) => `<li>${line.replace(/^- /,'')}</li>`).join('')}</ul>`;
    return `<p>${block.replaceAll('\n','<br>')}</p>`;
  }).join('');
}

function renderMarkdown() {
  const content = $('#markdown-editor').value;
  const count = visibleChars(content);
  $('#char-count').textContent = `${count} / 2000`;
  $('#char-count').style.color = count > 2000 ? '#ff867c' : '';
  $('#markdown-preview').innerHTML = markdownHtml(content) || '<p>Markdown 预览</p>';
}

async function saveDocument() {
  const candidateId = Number($('#writing-candidate').value);
  if (!candidateId) return toast('先锁定一个文章简报');
  const content = $('#markdown-editor').value;
  const kind = selectedDocKind();
  if (kind === 'final' && visibleChars(content) > 2000) return toast('终稿超过 2000 可见字符，暂不能保存为终稿');
  const document = await request(`/api/batches/${encodeURIComponent(state.activeBatchId)}/documents`, { method:'PUT', body:JSON.stringify({candidateId,kind,title:$('#article-title').value,content,status:kind==='final'?'finalized':'draft'}) });
  toast(`已保存 ${document.file_path}`);
  await Promise.all([loadOverview(), loadWritingDesk()]);
}

async function loadProductionPreview() {
  const batch = activeBatch();
  if (!batch) return;
  const previousCandidateId = Number($('#typeset-candidate').value);
  const [allArtifacts, candidates, documents] = await Promise.all([
    request('/api/artifacts?limit=500'), request(`/api/batches/${encodeURIComponent(batch.id)}/candidates`),
    request(`/api/batches/${encodeURIComponent(batch.id)}/documents`), ensureModelOptions(),
  ]);
  const artifacts = allArtifacts.filter((item) => item.batch_id === batch.id);
  const finalIds = new Set(documents.filter((item) => item.kind === 'final').map((item) => item.candidate_row_id));
  const ready = candidates.filter((item) => finalIds.has(item.id));
  $('#typeset-candidate').innerHTML = ready.length ? ready.map((item) => `<option value="${item.id}">${escapeHtml(item.candidate_id)} · ${escapeHtml(item.hotspot_title)}</option>`).join('') : '<option value="">缺少 09-FINAL.md</option>';
  const selectedCandidate = ready.find((item) => item.id === previousCandidateId) || ready[0] || null;
  $('#typeset-candidate').value = selectedCandidate ? String(selectedCandidate.id) : '';
  $('#typeset-candidate').disabled = !ready.length;
  $('#typeset-provider').innerHTML = providerOptions(state.models.defaultProvider);
  $('#run-local-typeset').disabled = !ready.length;
  state.productionPreview = { batch, artifacts, candidates:ready };
  renderProductionCandidate(selectedCandidate?.id || null);
  await loadImageWorkspace(selectedCandidate?.id || null);
}

function candidateArtifacts(candidate) {
  if (!candidate || !state.productionPreview) return [];
  const candidateId = candidate.candidate_id.toLowerCase();
  const batchDate = state.productionPreview.batch.batch_date.toLowerCase();
  return state.productionPreview.artifacts.filter((item) => {
    const filePath = String(item.file_path || '').replaceAll('\\','/').toLowerCase();
    return filePath.includes(`/articles/${batchDate}-${candidateId}/`) || filePath.includes(`/${candidateId}/`);
  });
}

function renderProductionCandidate(candidateRowId) {
  const candidate = state.productionPreview?.candidates.find((item) => item.id === Number(candidateRowId));
  const artifacts = candidateArtifacts(candidate);
  const names = new Set(artifacts.map((item) => item.name));
  const steps = [['article-brief.md','锁定文章简报'],['09-FINAL.md','文章终稿'],['magazine-design-tokens.json','杂志设计'],['article.ai.draft.html','HTML 初稿'],['article.ai.html','门禁后 HTML']];
  $('#production-checklist').innerHTML = `<span class="kicker">PIPELINE GATES</span><h3>生产门禁</h3>${steps.map(([name,label]) => `<div class="production-step ${names.has(name)?'done':''}"><i></i><div><b>${label}</b><small>${names.has(name)?'已生成':`缺少 ${name}`}</small></div></div>`).join('')}`;
  const htmlArtifact = artifacts.find((item) => item.name === 'article.ai.html');
  $('#proof-empty').hidden = Boolean(htmlArtifact); $('#proof-frame').hidden = !htmlArtifact;
  $('#proof-frame').src = htmlArtifact ? `/api/artifacts/${htmlArtifact.id}/content?v=${encodeURIComponent(htmlArtifact.modified_at)}` : 'about:blank';
  $('#copy-typeset-html').disabled = !htmlArtifact;
  $('#typeset-status').classList.toggle('ready', Boolean(htmlArtifact));
  $('#typeset-status').textContent = htmlArtifact ? `${candidate.candidate_id} 的排版 HTML 已就绪，可以直接复制到公众号编辑器。` : `${candidate?.candidate_id || '当前文章'} 尚未生成排版 HTML。`;
  const deliveries = artifacts.filter((item) => ['09-FINAL.md','article.ai.html'].includes(item.name));
  $('#delivery-links').innerHTML = deliveries.length ? deliveries.map((item) => `<div class="delivery-item"><small>${escapeHtml(item.kind)}</small><a href="/api/artifacts/${item.id}/content" target="_blank">${escapeHtml(item.name)}</a></div>`).join('') : '<div class="empty-state">尚无可交付文件</div>';
}

async function loadImageWorkspace(candidateId) {
  const stage = $('#image-stage');
  if (!candidateId) {
    state.imageWorkspace = null; stage.hidden = true; $('#run-local-typeset').disabled = true; return;
  }
  stage.hidden = false;
  const workspace = await request(`/api/candidates/${candidateId}/images`);
  state.imageWorkspace = { ...workspace, candidateId };
  renderImageWorkspace();
}

function imageCard(item) {
  const encoded = encodeURIComponent(item.id);
  const statusLabel = item.status === 'cdn' ? 'CDN 已就绪' : item.status === 'local' ? '本地待上传' : '等待供图';
  const preview = item.localPath ? `<img src="/api/candidates/${state.imageWorkspace.candidateId}/images/${encoded}/local?v=${encodeURIComponent(item.updatedAt || '')}" alt="${escapeHtml(item.content)}">` : `<span>${escapeHtml(item.ratio)}<br>点击选择图片</span>`;
  const hasImage = !!item.localPath;
  return `<article class="image-slot ${item.status === 'cdn' ? 'ready' : item.status === 'local' ? 'local' : ''}" data-image-id="${escapeHtml(item.id)}">
    <div class="image-slot-top"><span class="image-slot-id">${escapeHtml(item.id)} · ${escapeHtml(item.type)}</span><span class="image-slot-status">${statusLabel}</span></div>
    <h4>${escapeHtml(item.content)}</h4>
    <div class="image-slot-body"><div class="image-contact-sheet" data-upload-image="${escapeHtml(item.id)}" style="cursor:pointer">${preview}
      <input class="image-slot-file" data-image-file type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
    </div></div>
    <div class="image-slot-meta"><span>位置：${escapeHtml(item.position)}</span><span>比例：${escapeHtml(item.ratio)}</span><span>建议来源：${escapeHtml(item.suggestedSource)}</span></div>
    <div class="image-slot-actions">${hasImage ? `<span class="muted">${item.status === 'cdn' ? '已上传 CDN' : '本地已保存'}</span>` : ''}${item.status === 'cdn' ? `<button class="ghost-button" data-upload-image="${escapeHtml(item.id)}">重新上传</button>` : ''}</div>
    ${item.url ? `<a class="image-cdn-url" href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a>` : ''}
  </article>`;
}

function renderImageWorkspace() {
  const data = state.imageWorkspace;
  if (!data) return;
  const status = $('#image-stage-status');
  const button = $('#plan-article-images');
  button.textContent = data.planned ? '重新检查必要配图' : 'AI 规划必要配图';
  if (!data.planned) status.textContent = '尚未执行配图规划；正式排版前需要先确认是否存在必要图片。';
  else if (!data.total) status.textContent = '配图规划完成：本文没有必须人工提供的来源图或资料图。';
  else status.textContent = `配图就绪 ${data.ready} / ${data.total}${data.unresolved.length ? ` · 待处理 ${data.unresolved.join('、')}` : ' · 可以进入正式排版'}`;
  $('#image-slot-list').innerHTML = data.items.length ? data.items.map(imageCard).join('') : `<div class="image-stage-empty">${data.planned ? '没有必要的人工配图，文章可直接排版。' : '点击“AI 规划必要配图”，系统只会为有证据或阅读价值的图片留位。'}</div>`;
  const hasCandidate = Boolean(state.productionPreview?.candidates.length);
  $('#run-local-typeset').disabled = !hasCandidate || !data.planned || data.unresolved.length > 0;
}

async function planArticleImages() {
  const candidateId = Number($('#typeset-candidate').value); if (!candidateId) return;
  const button = $('#plan-article-images'); button.disabled = true; button.textContent = '正在分析图片需求…';
  try {
    state.imageWorkspace = { ...(await request(`/api/candidates/${candidateId}/images/plan`, { method:'POST', body:JSON.stringify({ provider:$('#typeset-provider').value }) })), candidateId };
    renderImageWorkspace(); toast(state.imageWorkspace.total ? `已生成 ${state.imageWorkspace.total} 个必要配图占位` : '配图规划完成：无需人工供图');
  } finally { button.disabled = false; }
}

function imageSlot(id) { return $$('.image-slot').find((node) => node.dataset.imageId === id); }
function fileAsDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(reader.error); reader.readAsDataURL(file); }); }

async function saveImageAsset(id) {
  const card = imageSlot(id); const file = $('[data-image-file]', card).files[0];
  if (!file) return toast('请先选择图片文件');
  const payload = { fileName:file.name, mimeType:file.type, base64:await fileAsDataUrl(file) };
  await request(`/api/candidates/${state.imageWorkspace.candidateId}/images/${encodeURIComponent(id)}`, { method:'POST', body:JSON.stringify(payload) });
  await loadImageWorkspace(state.imageWorkspace.candidateId);
  // 保存后自动上传 CDN
  await uploadImageAsset(id);
}

async function uploadImageAsset(id) {
  const card = imageSlot(id); const fileInput = $('[data-image-file]', card); const file = fileInput.files[0];
  if (!file) {
    // 没有文件 → 打开文件选择器
    fileInput.click();
    return;
  }
  // 有新文件：保存本地 → 上传 CDN，一步完成
  const button = $('[data-upload-image]', card); if (button) { button.disabled = true; button.textContent = '正在上传…'; }
  try {
    const payload = { fileName:file.name, mimeType:file.type, base64:await fileAsDataUrl(file) };
    await request(`/api/candidates/${state.imageWorkspace.candidateId}/images/${encodeURIComponent(id)}`, { method:'POST', body:JSON.stringify(payload) });
    await request(`/api/candidates/${state.imageWorkspace.candidateId}/images/${encodeURIComponent(id)}/cdn`, { method:'POST', body:'{}' });
    await loadImageWorkspace(state.imageWorkspace.candidateId); toast(`${id} 已上传 CDN`);
  } finally { if (button) button.disabled = false; }
}

async function copyTypesetHtml() {
  const frame = $('#proof-frame');
  const frameDocument = frame.contentDocument;
  const content = frameDocument?.querySelector('article') || frameDocument?.body;
  if (!content) return toast('排版预览尚未加载完成，请稍后再试');
  const html = content.outerHTML;
  const plain = content.innerText;
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('rich clipboard unavailable');
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type:'text/html' }),
      'text/plain': new Blob([plain], { type:'text/plain' }),
    })]);
  } catch {
    const selection = frame.contentWindow.getSelection();
    const range = frameDocument.createRange();
    range.selectNodeContents(content); selection.removeAllRanges(); selection.addRange(range);
    const copied = frameDocument.execCommand('copy'); selection.removeAllRanges();
    if (!copied) throw new Error('浏览器未允许复制，请点击预览正文后重试');
  }
  toast('公众号富文本已复制，可直接粘贴到编辑器');
}

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

async function openBatch(id) {
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

function bind() {
  $('#nav').addEventListener('click', (event) => { const item = event.target.closest('[data-view]'); if (item) go(item.dataset.view); });
  document.addEventListener('click', (event) => {
    const goButton = event.target.closest('[data-go]'); if (goButton) go(goButton.dataset.go);
    if (event.target.closest('[data-close-batch-dialog]')) $('#batch-dialog').close();
    const batch = event.target.closest('[data-batch]'); if (batch) openBatch(batch.dataset.batch);
    if (event.target.closest('[data-close-drawer]')) $('#batch-drawer').close();
    if (event.target.closest('[data-collect]')) startCollection();
    if (event.target.closest('[data-manual-hotspot]')) { $('#manual-hotspot-dialog').showModal(); }
    if (event.target.closest('[data-close-manual-hotspot]')) { $('#manual-hotspot-dialog').close(); }
    const submitManual=event.target.closest('[data-submit-manual-hotspot]');
    if (submitManual) {
      const form = submitManual.closest('form');
      const data = Object.fromEntries(new FormData(form));
      if (!data.title?.trim()) return toast('请输入标题');
      const batchId = state.activeBatchId || state.currentBatch?.id;
      if (!batchId) return toast('请先选择一个批次');
      request(`/api/batches/${encodeURIComponent(batchId)}/hotspots/manual`, {
        method: 'POST', body: JSON.stringify({ title: data.title, url: data.url, category: data.category, notes: data.notes })
      }).then((hotspot) => {
        toast(`已添加热点：${hotspot.title}`);
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
    const editorialButton = event.target.closest('[data-editorial-id]'); if (editorialButton) { go('editorial'); loadEditorialRoom(Number(editorialButton.dataset.editorialId)); }
    const editCandidate = event.target.closest('[data-edit-candidate]'); if (editCandidate) openEditorial(Number(editCandidate.dataset.editCandidate));
    const artifact = event.target.closest('[data-artifact]');
    if (artifact) { const dialog = $('#artifact-dialog'); $('iframe', dialog).src = `/api/artifacts/${artifact.dataset.artifact}/content`; dialog.showModal(); }
    const copy = event.target.closest('[data-copy]'); if (copy) navigator.clipboard.writeText(copy.dataset.copy).then(() => toast('启动命令已复制'));
    const scopeButton=event.target.closest('[data-atlas-scope]'); if(scopeButton&&state.atlas){state.atlasFilters.scope=scopeButton.dataset.atlasScope;$$('[data-atlas-scope]').forEach((button)=>button.classList.toggle('active',button===scopeButton));renderAtlas();}
    const wordButton=event.target.closest('[data-atlas-word]'); if(wordButton&&state.atlas){const word=wordButton.dataset.atlasWord;state.atlasSelectedWord=state.atlasSelectedWord===word?null:word;state.atlasFilters.query=state.atlasSelectedWord||'';$('#atlas-query').value=state.atlasFilters.query;renderAtlas();}
    const compositeFromEvent=event.target.closest('[data-event-index]'); if(compositeFromEvent&&state.atlas&&state.activeBatchId){
      const eventIndex=Number(compositeFromEvent.dataset.eventIndex);
      const title=compositeFromEvent.dataset.eventTitle||'';
      createCompositeFromEvent(state.activeBatchId,eventIndex,title).catch((error)=>toast(error.message));
    }
    const hotwordComposite=event.target.closest('[data-hotword-composite]'); if(hotwordComposite&&state.activeBatchId){
      const word=hotwordComposite.dataset.hotwordComposite;
      createCompositeFromHotword(state.activeBatchId,word).catch((error)=>toast(error.message));
    }
    const hotwordGenSummary=event.target.closest('[data-hotword-gen-summary]'); if(hotwordGenSummary&&state.activeBatchId){
      const word=hotwordGenSummary.dataset.hotwordGenSummary;
      generateHotwordSummary(state.activeBatchId,word).then((result)=>{if(result?.summary){toast('热词综述已生成');state.atlasSelectedWord=word;loadOverview().then(()=>renderAtlas());}else{toast('生成失败');}}).catch((error)=>toast(error.message));
    }
    const uploadImageButton=event.target.closest('[data-upload-image]'); if(uploadImageButton) uploadImageAsset(uploadImageButton.dataset.uploadImage).catch((error)=>toast(error.message));
    const sourceTest=event.target.closest('[data-source-test]'); if(sourceTest) testSubscription({kind:sourceTest.dataset.kind,value:sourceTest.dataset.value},sourceTest).catch((error)=>toast(error.message));
    const sourceRemove=event.target.closest('[data-source-remove]'); if(sourceRemove) removeSubscription(sourceRemove).catch((error)=>toast(error.message));
    const sourceFilter=event.target.closest('[data-source-filter]'); if(sourceFilter){state.subscriptionFilter=sourceFilter.dataset.sourceFilter;$$('[data-source-filter]').forEach((item)=>item.classList.toggle('active',item===sourceFilter));renderSubscriptions();}
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
  $('#editorial-form').addEventListener('submit', saveEditorial);
  $('#editorial-form').addEventListener('input', renderEditorialReadiness);
  $('#editorial-form').addEventListener('change', renderEditorialReadiness);
  $('#start-editorial-production').addEventListener('click', () => startEditorialProduction().catch((error) => toast(error.message)));
  $('#send-editorial-answer').addEventListener('click',()=>sendEditorialAnswer().catch((error)=>toast(error.message)));
  $('#fetch-source').addEventListener('click',()=>fetchEditorialSource().catch((error)=>toast(error.message)));
  $('#writing-candidate').addEventListener('change', loadSelectedDocument);
  $$('input[name=doc-kind]').forEach((item) => item.addEventListener('change', loadSelectedDocument));
  $('#markdown-editor').addEventListener('input', renderMarkdown);
  $('#article-title').addEventListener('input', () => {
    const content = $('#markdown-editor').value;
    if (content.startsWith('# ')) $('#markdown-editor').value = `# ${$('#article-title').value}${content.includes('\n') ? content.slice(content.indexOf('\n')) : '\n\n'}`;
    renderMarkdown();
  });
  $('#save-document').addEventListener('click', () => saveDocument().catch((error) => toast(error.message)));
  $('#typeset-candidate').addEventListener('change', (event) => { const id=Number(event.target.value); renderProductionCandidate(id); loadImageWorkspace(id).catch((error)=>toast(error.message)); });
  $('#plan-article-images').addEventListener('click', () => planArticleImages().catch((error)=>toast(error.message)));
  $('#refresh-preview').addEventListener('click', loadProductionPreview);
  $('#preview-reindex').addEventListener('click', async () => { await reindex(); loadProductionPreview(); });
  $('#reindex-button').addEventListener('click', reindex);
  $('#health-button').addEventListener('click', () => { go('system'); checkHealth(); });
  $('#system-health').addEventListener('click', checkHealth);
  $('#subscription-kind').addEventListener('change', updateSubscriptionComposer);
  $('#subscription-form').addEventListener('submit', (event)=>addSubscriptionFromForm(event).catch((error)=>toast(error.message)));
  $('#test-subscription').addEventListener('click', (event)=>testSubscription(subscriptionFormPayload(),event.currentTarget).catch((error)=>toast(error.message)));
  $('#test-model').addEventListener('click', () => testModel().catch((error) => toast(error.message)));
  $('#ai-tag-batch').addEventListener('click', () => aiTagBatch().catch((error) => toast(error.message)));
  $('#ai-draft').addEventListener('click', () => aiDraft().catch((error) => toast(error.message)));
  $('#run-local-typeset').addEventListener('click', () => runTypeset('local').catch((error) => toast(error.message)));
  $('#copy-typeset-html').addEventListener('click', () => copyTypesetHtml().catch((error) => toast(error.message)));
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
  try { await loadOverview(); go(initialView); } catch (error) { toast('工作台加载失败：' + error.message); }
}

init();
