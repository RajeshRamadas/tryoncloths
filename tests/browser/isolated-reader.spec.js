import {test,expect,chromium} from '@playwright/test';
import {renderPublicPage} from '../../server/browser-worker.js';

// Real Chromium executes JavaScript, but every request is fulfilled/aborted in
// memory. No retailer, private endpoint or paid provider is contacted.
test('isolated reader extracts script-created metadata and blocks private subrequests',async()=>{
 const old=process.env.TRYON_READER_ISOLATED;process.env.TRYON_READER_ISOLATED='1';
 let privateBlocked=0;
 const wrapped={launch:async options=>{
   const browser=await chromium.launch(options);const original=browser.newContext.bind(browser);
   browser.newContext=async config=>{
     const context=await original(config);const route=context.route.bind(context);
     context.route=async(pattern,guard)=>route(pattern,async r=>{
       const fake={request:()=>r.request(),abort:()=>{if(r.request().url().includes('169.254.169.254'))privateBlocked++;return r.abort();},continue:()=>r.fulfill({contentType:'text/html',body:`<html><head><script>
       fetch('http://169.254.169.254/latest/meta-data').catch(()=>{});
       setTimeout(()=>{const m=document.createElement('meta');m.setAttribute('property','og:image');m.content='https://shop.example/shirt.jpg';document.head.append(m);},50);
       </script></head><body>Shop</body></html>`})};
       return guard(fake);
     });return context;
   };return browser;
 }};
 try{const result=await renderPublicPage('https://shop.example/p',{chromium:wrapped,timeoutMs:5000});expect(result.html).toContain('og:image');expect(privateBlocked).toBe(1);}
 finally{if(old===undefined)delete process.env.TRYON_READER_ISOLATED;else process.env.TRYON_READER_ISOLATED=old;}
});
