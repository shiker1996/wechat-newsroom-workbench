function parse(row) { return row ? {...row,value:JSON.parse(row.value_json),configured:Boolean(row.configured)} : null; }

export class ExtensionSettingRepository {
  constructor(db) { this.db=db; }
  get(extensionType,extensionId,scope='workspace') {
    return parse(this.db.prepare('SELECT * FROM extension_settings WHERE extension_type=? AND extension_id=? AND scope=?').get(extensionType,extensionId,scope));
  }
  save({extensionType,extensionId,scope='workspace',schemaVersion=1,value={},configured=true,status='ready',configHash=''}) {
    const now=new Date().toISOString();
    this.db.prepare(`INSERT INTO extension_settings
      (extension_type,extension_id,scope,schema_version,value_json,configured,status,config_hash,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(extension_type,extension_id,scope) DO UPDATE SET
      schema_version=excluded.schema_version,value_json=excluded.value_json,configured=excluded.configured,
      status=excluded.status,config_hash=excluded.config_hash,updated_at=excluded.updated_at`)
      .run(extensionType,extensionId,scope,schemaVersion,JSON.stringify(value),configured?1:0,status,configHash,now,now);
    return this.get(extensionType,extensionId,scope);
  }
  list(extensionType=null) {
    const rows=extensionType?this.db.prepare('SELECT * FROM extension_settings WHERE extension_type=? ORDER BY extension_id').all(extensionType)
      :this.db.prepare('SELECT * FROM extension_settings ORDER BY extension_type,extension_id').all();
    return rows.map(parse);
  }
  remove(extensionType,extensionId,scope='workspace') {
    return this.db.prepare('DELETE FROM extension_settings WHERE extension_type=? AND extension_id=? AND scope=?').run(extensionType,extensionId,scope).changes>0;
  }
}
