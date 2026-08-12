function parse(row){return row?{...row,config:JSON.parse(row.config_json),enabled:Boolean(row.enabled),managed:Boolean(row.managed)}:null;}
export class CollectionSourceRepository{
  constructor(db){this.db=db;}
  get(id){return parse(this.db.prepare('SELECT * FROM collection_sources WHERE id=?').get(id));}
  getByKey(key){return parse(this.db.prepare('SELECT * FROM collection_sources WHERE source_key=?').get(key));}
  list(){return this.db.prepare('SELECT * FROM collection_sources ORDER BY managed DESC,label,id').all().map(parse);}
  listEnabled({ids=null,sourceTypes=null}={}){let rows=this.list().filter((item)=>item.enabled);if(ids?.length){const set=new Set(ids.map(Number));rows=rows.filter((item)=>set.has(item.id));}if(sourceTypes?.length){const set=new Set(sourceTypes);rows=rows.filter((item)=>set.has(item.source_type));}return rows;}
  upsert(input){const now=new Date().toISOString();this.db.prepare(`INSERT INTO collection_sources
    (plugin_id,plugin_version,source_type,source_key,label,config_json,enabled,managed,origin,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET plugin_id=excluded.plugin_id,plugin_version=excluded.plugin_version,
    source_type=excluded.source_type,label=excluded.label,config_json=excluded.config_json,enabled=excluded.enabled,managed=excluded.managed,
    origin=excluded.origin,updated_at=excluded.updated_at`).run(input.pluginId,input.pluginVersion||'',input.sourceType,input.sourceKey,input.label,JSON.stringify(input.config||{}),input.enabled===false?0:1,input.managed?1:0,input.origin||'user',now,now);return this.getByKey(input.sourceKey);}
  updateTest(id,{status,error=''}){this.db.prepare('UPDATE collection_sources SET last_tested_at=?,last_test_status=?,last_test_error=?,updated_at=? WHERE id=?').run(new Date().toISOString(),status,error,new Date().toISOString(),id);return this.get(id);}
  setEnabled(id,enabled){this.db.prepare('UPDATE collection_sources SET enabled=?,updated_at=? WHERE id=?').run(enabled?1:0,new Date().toISOString(),id);return this.get(id);}
  update(id,input){const current=this.get(id);if(!current)throw new Error('采集源不存在');if(current.managed)throw new Error('系统管理来源不能编辑');const next={...current,...input,config:{...current.config,...(input.config||{})}};this.db.prepare(`UPDATE collection_sources SET plugin_id=?,plugin_version=?,source_type=?,source_key=?,label=?,config_json=?,enabled=?,updated_at=? WHERE id=?`).run(next.pluginId||next.plugin_id,next.pluginVersion||next.plugin_version||'',next.sourceType||next.source_type,next.sourceKey||next.source_key,next.label,JSON.stringify(next.config),next.enabled===false?0:1,new Date().toISOString(),id);return this.get(id);}
  remove(id){const item=this.get(id);if(!item)return false;if(item.managed)throw new Error('系统管理来源不能删除');this.db.prepare('DELETE FROM collection_sources WHERE id=?').run(id);return true;}
  disableMissingLegacy(keys){const keep=new Set(keys);for(const item of this.list().filter((row)=>row.origin==='legacy-config'))if(!keep.has(item.source_key))this.setEnabled(item.id,false);}
}
