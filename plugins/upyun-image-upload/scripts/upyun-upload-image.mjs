import fs from 'node:fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { parseCliArgs, resolveUpyunConfig, getImageExt, normalizeContentType, normalizeDomain } from './opts.mjs';

function message(error){return error instanceof Error?error.message:String(error||'未知错误');}
async function main(){
  const {file,opts}=parseCliArgs();const config=resolveUpyunConfig({file,opts});const {inputFile,bucket,operator,password,domain,prefix,contentType}=config;
  if(!bucket||!operator||!password){console.log(JSON.stringify({success:false,message:'又拍云上传配置不完整，请在系统与配置中心完成配置'}));process.exitCode=1;return;}
  const ext=getImageExt(inputFile),body=await fs.readFile(inputFile),key=`${prefix}/${Date.now()}-${Math.random().toString(36).slice(2,9)}.${ext}`;
  const client=new S3Client({region:'auto',endpoint:'https://s3.api.upyun.com',credentials:{accessKeyId:operator,secretAccessKey:password},forcePathStyle:true});
  await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:normalizeContentType(contentType,inputFile,ext),ACL:'public-read'}));
  console.log(JSON.stringify({success:true,data:{url:`https://${normalizeDomain(domain)}/${key}`,key}}));
}
main().catch((error)=>{console.log(JSON.stringify({success:false,message:message(error)}));process.exitCode=1;});
