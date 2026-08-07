import fs from 'node:fs';
import path from 'node:path';
import { validateThemeDefinition, ThemeValidationError } from './theme-validator.mjs';

function inside(file,root){const relative=path.relative(path.resolve(root),path.resolve(file));return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));}

export function loadThemeDirectory(root,{source='builtin'}={}){
  const absolute=path.resolve(root);if(!fs.existsSync(absolute))throw new Error(`主题目录不存在：${absolute}`);
  const definitions=[];
  for(const target of ['article','social','cover']){
    const directory=path.join(absolute,target);if(!fs.existsSync(directory))continue;
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).filter((item)=>item.isFile()&&item.name.endsWith('.json')).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=path.resolve(directory,entry.name);if(!inside(file,absolute))throw new Error(`主题路径越界：${file}`);
      let value;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){throw new ThemeValidationError([{field:'json',code:'INVALID_JSON',message:error.message}],file);}
      validateThemeDefinition(value,{filePath:file,expectedTarget:target,expectedSource:source});
      if(`${value.id}.json`!==entry.name)throw new ThemeValidationError([{field:'id',code:'FILENAME_MISMATCH',message:`文件名必须为 ${value.id}.json`}],file);
      definitions.push({...value,_file:file});
    }
  }
  return definitions;
}
