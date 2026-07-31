// 应用版本的唯一来源：package.json 的 version 字段。
// 技能包、本地/远程工具插件的 compatibleApp 兼容判定统一以此为准，
// 发布新版本只需修改 package.json 并打同名 tag（流程见 docs/release.md）。
import fs from 'node:fs';

export const APP_VERSION = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
