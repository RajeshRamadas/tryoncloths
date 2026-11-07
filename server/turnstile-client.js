// Trusted nonce/CSP client loaded only after explicit shopper consent. It never
// reads photo fields and cannot authorize uploads without server verification.
export function turnstileClient(siteKey){
  let loading=null,widget=null,pending=null;
  const failure=()=>new Error('Verification did not finish. Please verify again. No photos have been sent.');
  function remove(){if(widget!==null&&window.turnstile){window.turnstile.remove(widget);widget=null;}}
  function reset(){pending?.(failure());pending=null;remove();}
  async function load(nonce){
    if(window.turnstile)return;
    if(!loading)loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.nonce=nonce;script.async=true;
      script.onload=()=>window.turnstile?resolve():reject(failure());script.onerror=()=>{script.remove();reject(failure());};document.head.append(script);
    }).catch(error=>{loading=null;throw error;});
    await loading;
  }
  window.FormeShopperVerification={id:'cloudflare-turnstile',reset,async challenge({action,container,nonce,signal}){
    reset();signal.throwIfAborted();await load(nonce);signal.throwIfAborted();container.replaceChildren();
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,token)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);pending=null;if(error){remove();reject(error);}else resolve(token);};
      const abort=()=>finish(signal.reason||failure());pending=error=>finish(error);signal.addEventListener('abort',abort,{once:true});
      try{widget=window.turnstile.render(container,{sitekey:siteKey,action,size:'flexible',execution:'execute',retry:'never','refresh-expired':'never','refresh-timeout':'never',
        callback:token=>finish(null,token),'error-callback':()=>{finish(failure());return true;},'expired-callback':()=>finish(failure()),'timeout-callback':()=>finish(failure()),'response-field':false});window.turnstile.execute(widget);}
      catch{finish(failure());}
    });
  }};
}
