export function parseRepositoryUrl(value) {
  try {
    const url=new URL(String(value||''));
    if(url.hostname.toLowerCase()!=='github.com')return null;
    const [owner,repo]=url.pathname.split('/').filter(Boolean);
    if(!owner||!repo)return null;
    const normalizedRepo=repo.replace(/\.git$/i,'');
    return {owner,repo:normalizedRepo,repository:`${owner}/${normalizedRepo}`,sourceUrl:`https://github.com/${owner}/${normalizedRepo}`};
  } catch{return null;}
}
