import { readProductLink, safeFetch, parseProductUrl, LinkError } from './product-link.js';

export async function requestRenderedPage(url, {
  endpoint = process.env.TRYON_READER_URL,
  token = process.env.TRYON_READER_TOKEN,
  fetchImpl = fetch,
} = {}) {
  // The endpoint is operator configuration, never a URL supplied by a customer.
  if (!endpoint || !token || token.length < 32) throw new LinkError('unknown');
  let response;
  try {
    response = await fetchImpl(new URL('/render',endpoint), {
      method:'POST',redirect:'error',signal:AbortSignal.timeout(22000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({url:parseProductUrl(url).href}),
    });
    if (!response.ok) throw new LinkError(response.status===504?'timeout':'site_refused');
    // Bound the worker response as well as its browser network transfer.
    const reader=response.body.getReader();let bytes=0;const chunks=[];
    try {for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>5*1024*1024)throw new LinkError('too_large');chunks.push(Buffer.from(value));}}
    finally {await reader.cancel();}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(typeof data.html!=='string' || Buffer.byteLength(data.html)>4*1024*1024)throw new LinkError('too_large');
    return {html:data.html,url:parseProductUrl(data.url).href};
  } catch(e) {if(e instanceof LinkError)throw e;throw new LinkError(e?.name==='TimeoutError'?'timeout':'network');}
}

export async function readProductLinkWithFallback(raw, {
  enabled = process.env.TRYON_LINK_BROWSER === '1',
  staticReader = readProductLink,
  browserReader = requestRenderedPage,
  imageFetch = safeFetch,
} = {}) {
  const url=parseProductUrl(raw).href;
  try {return await staticReader(url);}
  catch(error) {
    if(!enabled || !(error instanceof LinkError) || !['no_images','site_refused'].includes(error.code))throw error;
  }
  const page=await browserReader(url);
  const finalUrl=parseProductUrl(page.url);
  // Reuse the exact extraction and image pipeline; image downloads still go
  // through the guarded static fetch, never through Chromium.
  return readProductLink(finalUrl.href,{fetchImpl:async(input,options)=>
    typeof input === 'string' ? imageFetch(input,options) : {body:Buffer.from(page.html),type:'text/html',url:finalUrl}});
}
