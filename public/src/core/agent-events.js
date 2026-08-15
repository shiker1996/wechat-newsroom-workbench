export function ensureAgentToolCard(container,event){
  const id=String(event.requestId||'');
  let card=container.querySelector(`[data-tool-request="${CSS.escape(id)}"]`);
  if(!card){card=document.createElement('details');card.className='agent-tool-card';card.dataset.toolRequest=id;card.innerHTML='<summary><span class="agent-tool-name"></span><span class="agent-tool-status"></span></summary><div class="agent-tool-detail"></div>';container.append(card);}
  const labels={'tool.requested':'等待执行','tool.running':'读取中…','tool.completed':'已完成','tool.failed':'失败','tool.needs_confirmation':'等待确认'};
  card.classList.toggle('failed',event.type==='tool.failed');
  card.querySelector('.agent-tool-name').textContent=event.capability||'资料工具';
  card.querySelector('.agent-tool-status').textContent=labels[event.type]||event.type;
  card.querySelector('.agent-tool-detail').textContent=[event.reason,event.summary,event.error?.message,...(event.sources||[]).map((source)=>source.title||source.url)].filter(Boolean).join('\n');
  return card;
}

export function consumeAgentEvent(event,{toolCards,replyText,thinkingBox,thinkingText,errorLabel='AI '}={}){
  const type=String(event.type||'');
  if(type.startsWith('tool.')&&toolCards)ensureAgentToolCard(toolCards,event);
  if((type==='thinking'||type==='assistant.thinking')&&thinkingText){if(thinkingBox){thinkingBox.hidden=false;thinkingBox.open=true;}thinkingText.textContent+=event.text||'';thinkingText.scrollTop=thinkingText.scrollHeight;}
  if((type==='delta'||type==='assistant.delta')&&replyText)replyText.textContent+=event.text||'';
  if(type==='agent.limit'&&replyText&&!replyText.textContent)replyText.textContent=event.reason||'本轮工具调用已达到上限，请继续对话。';
  if(type==='error')throw new Error(event.message||event.error||`${errorLabel}调用失败`);
  if(type==='done'){if(thinkingBox)thinkingBox.open=false;return event.data||true;}
  return null;
}
