import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseProductUrl } from './public-url.js';
import { LinkError } from './link-errors.js';
import { allowBrowserRequest } from './browser-policy.js';

export async function renderPublicPage(raw,{chromium,timeoutMs=20000,maxBytes=8*1024*1024}={}) {
  const url=parseProductUrl(raw),deadline=Date.now()+timeoutMs;
  if(!chromium)({chromium}=await import('playwright-core'));
  // Only run inside the worker container after the firewall has been installed.
  if(process.env.TRYON_READER_ISOLATED!=='1')throw new LinkError('unknown');
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,timeout:Math.max(1,deadline-Date.now()),args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-quic','--disable-features=DnsOverHttps']});
  let timer;
  try {
    const context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
    const page=await context.newPage();let transferred=0,failed=false;
    const closed=new Promise((_,reject)=>{
      timer=setTimeout(()=>{failed=true;reject(new LinkError('timeout'));void context.close();},Math.max(1,deadline-Date.now()));
      page.on('download',d=>void d.cancel());
      page.on('popup',popup=>void popup.close());
      page.on('crash',()=>reject(new LinkError('network')));
    });
    const session=await context.newCDPSession(page);await session.send('Network.enable');
    const transfer=new Promise((_,reject)=>{
      session.on('Network.dataReceived',event=>{
        transferred+=Math.max(event.dataLength||0,event.encodedDataLength||0);
        if(transferred>maxBytes&&!failed){failed=true;reject(new LinkError('too_large'));void context.close();}
      });
    });
    await context.route('**/*',route=>{
      const request=route.request();
      const currentOrigin = page.url().startsWith("http") ? new URL(page.url()).origin : url.origin;
      return !failed && allowBrowserRequest(request.url(),request.resourceType(),currentOrigin) ? route.continue() : route.abort();
    });
    const read=(async()=>{
      await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:Math.max(1,deadline-Date.now())});
      // Wait for metadata inserted by page scripts; no fixed sleep or scraping login.
      await page.waitForFunction(()=>Boolean(document.querySelector('script[type="application/ld+json"],meta[property="og:image"],meta[name="twitter:image"],link[rel="image_src"]')),{},{timeout:Math.max(1,deadline-Date.now())});
      const html=await page.content();if(Buffer.byteLength(html)>4*1024*1024)throw new LinkError('too_large');
      return {html,url:parseProductUrl(page.url()).href};
    })();
    return await Promise.race([read,closed,transfer]);
  } catch(e) {if(e instanceof LinkError)throw e;throw new LinkError(e?.name==='TimeoutError'?'timeout':'network');}
  finally {clearTimeout(timer);await browser.close();}
}

export function workerServer({token=process.env.TRYON_READER_TOKEN,render=renderPublicPage}={}) {
  if(!token||token.length<32)throw new Error('Configure a reader token of at least 32 characters.');
  const hash=s=>createHash('sha256').update(s).digest();let busy=false;
  return http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
    if(!timingSafeEqual(hash(req.headers.authorization||''),hash(`Bearer ${token}`)))return send(401,{error:'Unauthorized'});
    if(req.method==='GET'&&req.url==='/health')return send(200,{ok:true});
    if(req.method!=='POST'||req.url!=='/render')return send(404,{error:'Not found'});
    if(busy)return send(429,{error:'Reader busy'});
    busy=true;req.setTimeout(5000,()=>req.destroy());
    try {
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>4096)throw new LinkError('too_large');chunks.push(chunk);}
      req.setTimeout(0);
      const {url}=JSON.parse(Buffer.concat(chunks).toString());
      send(200,await render(parseProductUrl(url).href));
    }catch(e){send(e?.code==='timeout'?504:422,{error:'Product page could not be rendered.'});}
    finally{busy=false;}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.env.TRYON_READER_ISOLATED!=='1')throw new Error('Start through the isolated reader entrypoint.');
  workerServer().listen(3002,'0.0.0.0');
}
