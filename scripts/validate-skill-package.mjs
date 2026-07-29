import path from 'node:path';
import { validateSkillPackageDirectory } from '../lib/skills/package-manager.mjs';

const directory=process.argv[2];
if(!directory){
  console.error('用法：npm run skill:validate -- <技能包目录>');
  process.exitCode=2;
}else{
  try{
    const result=validateSkillPackageDirectory(path.resolve(directory));
    console.log(JSON.stringify({valid:true,manifest:result.manifest,files:result.files,totalBytes:result.totalBytes,contentHash:result.contentHash},null,2));
  }catch(error){
    console.error(JSON.stringify({valid:false,error:error.message},null,2));
    process.exitCode=1;
  }
}
