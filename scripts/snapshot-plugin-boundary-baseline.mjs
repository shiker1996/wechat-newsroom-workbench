import fs from 'node:fs';
import path from 'node:path';
import { scanPluginBoundaries } from '../lib/plugins/boundary-audit.mjs';

const root=path.resolve(import.meta.dirname,'..');
function governance(item){
  if(item.type==='cross-plugin'){
    if(item.plugin==='feed'||item.plugin==='rsshub')return {phase:'Phase 2',owner:'collector-runtime',resolution:'保持 Feed/RSSHub 独立并移除采集器间源码依赖'};
    if(item.plugin==='url-fetch')return {phase:'Phase 3',owner:'tool-runtime',resolution:'改为 optional capability 调用 repository.inspect'};
    return {phase:'Phase 1',owner:'collector-runtime',resolution:'将 URL 安全预检内聚到当前插件'};
  }
  if(item.type==='project-script'||item.type==='project-skill'||item.type==='user-runtime')return {phase:'Phase 4',owner:'plugin-runtime',resolution:'将执行实现收回插件并改用宿主注入的存储与凭据'};
  if(item.type==='shared-source'&&['reddit','browser-web-page','declarative-web-page'].includes(item.plugin))return {phase:'Phase 1',owner:'collector-runtime',resolution:'将单消费者或场景化基础实现内聚到插件'};
  return {phase:'Phase 5',owner:'plugin-sdk',resolution:'由宿主 Plugin SDK 注入协议、安全、网络或存储能力'};
}
const violations=scanPluginBoundaries(root).map((item)=>({...item,...governance(item)}));
const output={schemaVersion:1,generatedFrom:'plugins source boundary scan',policy:'baseline may only shrink; new violations fail CI',violations};
fs.writeFileSync(path.join(root,'test','fixtures','plugin-boundary-baseline.json'),`${JSON.stringify(output,null,2)}\n`,'utf8');
console.log(`插件边界基线已写入：${violations.length} 项`);
