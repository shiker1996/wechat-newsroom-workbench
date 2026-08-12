export const FALLBACK_ERROR_CODES=Object.freeze(new Set(['DEPENDENCY_MISSING','FETCH_FAILED','RENDER_FAILED','UPLOAD_FAILED','TIMEOUT','NETWORK_ERROR']));
export const TERMINAL_ERROR_CODES=Object.freeze(new Set(['INVALID_INPUT','INVALID_SOURCE_CONFIG','SELECTOR_MISMATCH','PERMISSION_DENIED','PATH_OUTSIDE_ALLOWED_ROOTS','FIRST_RUN_CONFIRM_REQUIRED','AUTH_REQUIRED','OUTPUT_INVALID','ABORTED']));

export function shouldFallback(result,{signal=null}={}){
  if(signal?.aborted||result?.status!=='error')return false;
  const code=result.error?.code||'';
  if(TERMINAL_ERROR_CODES.has(code))return false;
  return result.error?.retryable===true||FALLBACK_ERROR_CODES.has(code);
}

export function orderedCandidates(items,{preferredId='',priorityOf=()=>0}={}){
  const ordered=[...items].sort((a,b)=>priorityOf(b)-priorityOf(a)||String(a.manifest.id).localeCompare(String(b.manifest.id)));
  if(!preferredId)return ordered;
  const preferred=ordered.find((item)=>item.manifest.id===preferredId);
  return preferred?[preferred,...ordered.filter((item)=>item!==preferred)]:ordered;
}
