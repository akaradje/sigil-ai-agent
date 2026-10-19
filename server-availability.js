'use strict';
function createAvailability({url,fetchImpl=fetch,now=Date.now}={}) {
  const state={status:url?'unknown':'disabled',failures:0,successes:0,checkedAt:0};
  let pending=null;
  async function probe() {
    if(!url)return state;
    if(pending)return pending;
    pending=(async()=>{
      let ok=false;
      try { const r=await fetchImpl(url,{signal:AbortSignal.timeout(8000),redirect:'follow',headers:{'user-agent':'SigilAvailability/1.0'}});ok=r.ok;await r.body?.cancel(); }catch{}
      state.checkedAt=now();state.failures=ok?0:state.failures+1;state.successes=ok?state.successes+1:0;
      if(!ok&&state.failures>=3)state.status='down';
      if(ok&&(state.status!=='down'||state.successes>=2))state.status='up';
      return state;
    })().finally(()=>{pending=null;});
    return pending;
  }
  return {state,probe,blocked:()=>state.status==='down'};
}
module.exports={createAvailability};
