import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {customerHandsFixture} from './helpers/customer-hands-fixture.js';
import {createCustomerHandsGenerator,normalizeHandPhoto,requireCustomerHandPresence,requireCustomerHandsUnchanged,customerHandAnchors,validateCustomerHandPoints,customerHandsPrompt} from '../server/customer-hands.js';
import {validateHandAnchors,handsTemplate} from '../server/hands-templates.js';
import {createJewelleryTryOn} from '../server/jewellery-tryon.js';
import {ProviderError,providerErrorDetails} from '../server/provider-errors.js';
const f=await customerHandsFixture(),anchors=customerHandAnchors(f.points),code=c=>e=>e instanceof ProviderError&&e.code===c;
const reply=(bytes=f.image,mimeType='image/png')=>new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType,data:bytes.toString('base64')}}]}}]}));

test('photo markers are explicit, distinct, half-bounded and yield separate masks without template coordinates',()=>{
 assert.deepEqual(validateCustomerHandPoints(f.points),f.points);assert.ok(validateHandAnchors(anchors));assert.notEqual(anchors.left.ring.y,330);
 for(const change of [p=>delete p['left.ring'],p=>p.extra={},p=>p['left.ring'].x=800,p=>p['right.wrist'].widthPx=90,p=>p['left.thumb'].angle=181,p=>p['left.wrist'].y=320,p=>p['left.index']=p['left.middle'],p=>p['left.ring'].x=NaN]){const p=structuredClone(f.points);change(p);assert.throws(()=>validateCustomerHandPoints(p));}
});
test('presence checks cover six schematic tones and twelve authored tone assets; reject blank, single hand, flat skin and wrong markers',async()=>{
 for(const colour of ['#f4d0b8','#e1b796','#be835c','#a46640','#73452a','#48281b']){const v=await customerHandsFixture(colour);await requireCustomerHandPresence(v.image,customerHandAnchors(v.points));}
 for(const body of ['male','female'])for(const tone of ['very-light','light','medium','tan','deep','very-deep']){const t=await handsTemplate(body,tone),p=Object.fromEntries(['left','right'].flatMap(s=>Object.entries(t.anchors[s]).map(([finger,p])=>[s+'.'+finger,p])));await requireCustomerHandPresence(t.png,customerHandAnchors(p));}
 const flat=await sharp({create:{width:1024,height:1024,channels:3,background:'#bc815c'}}).png().toBuffer(),blank=await sharp(flat).modulate({saturation:0}).png().toBuffer(),single=await sharp(f.image).composite([{input:{create:{width:512,height:1024,channels:3,background:'white'}},left:512,top:0}]).png().toBuffer();
 for(const image of [flat,blank,single,await sharp(f.image).resize(512,512).png().toBuffer()])await assert.rejects(requireCustomerHandPresence(image,anchors),code('hands_input'));
 const p=structuredClone(f.points);p['left.ring'].y=20;await assert.rejects(requireCustomerHandPresence(f.image,customerHandAnchors(p)),code('hands_input'));
});
test('normalization contains and orients without stretching, strips metadata and preserves caller buffers',async()=>{
 const original=await sharp(f.image).jpeg().withMetadata({orientation:1}).toBuffer(),copy=Buffer.from(original),out=await normalizeHandPhoto(original),m=await sharp(out).metadata();assert.deepEqual(original,copy);assert.equal(m.width,1024);assert.equal(m.height,1024);assert.equal(m.exif,undefined);
 const landscape=await sharp({create:{width:1600,height:1024,channels:3,background:'white'}}).composite([{input:f.image,left:288,top:0}]).jpeg().toBuffer(),normalized=await normalizeHandPhoto(landscape);const pixel=await sharp(normalized).extract({left:100,top:0,width:1,height:1}).raw().toBuffer();assert.ok(pixel.every(v=>v>245),'white top margin rather than vertical stretching');
 for(const input of ['http://example.test/image.png','data:image/png;base64,broken!',Buffer.from('private'),Buffer.alloc(5*1024*1024+1),await sharp(f.image).resize(200,200).png().toBuffer()])await assert.rejects(normalizeHandPhoto(input),code('hands_input'));
});
test('retention accepts unchanged skin, small jewellery and background cleanup, but rejects removal, major movement and recolouring',async()=>{
 await requireCustomerHandsUnchanged(f.image,f.image,anchors);
 const clean=await customerHandsFixture('#bc815c','#ededed');await requireCustomerHandsUnchanged(f.image,clean.image,anchors);
 const ring=await sharp(f.image).composite([{input:{create:{width:55,height:12,channels:3,background:'#daa520'}},left:163,top:290}]).png().toBuffer();await requireCustomerHandsUnchanged(f.image,ring,anchors,{allowJewellery:true});
 const changed=await sharp(f.image).modulate({brightness:.5}).png().toBuffer();await assert.rejects(requireCustomerHandsUnchanged(f.image,changed,anchors),code('hands_changed'));
 const moved=await sharp({create:{width:1024,height:1024,channels:3,background:'white'}}).composite([{input:await sharp(f.image).extract({left:0,top:0,width:1024,height:900}).png().toBuffer(),left:0,top:124}]).png().toBuffer();await assert.rejects(requireCustomerHandsUnchanged(f.image,moved,anchors),code('hands_changed'));
});
test('one consented adapter request sends only the normalized hand PNG, validates output and clears transient inputs',async()=>{
 let calls=0;const transient=[];const generate=createCustomerHandsGenerator({presence:async bytes=>transient.push(bytes),retention:async(a,b)=>{transient.push(a,b);await requireCustomerHandsUnchanged(a,b,anchors);}}),original=Buffer.from(f.image);
 const result=await generate({handPhoto:f.image,points:f.points,apiKey:'test-key-only',fetchImpl:async(url,options)=>{calls++;assert.match(url,/gemini-2.5-flash-image:generateContent$/);assert.equal(options.headers['x-goog-api-key'],'test-key-only');const request=JSON.parse(options.body),parts=request.contents[0].parts;assert.equal(parts.filter(p=>p.inlineData).length,1);assert.equal(parts[1].inlineData.mimeType,'image/png');assert.deepEqual(request.generationConfig,{candidateCount:1,responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'1:1'}});assert.doesNotMatch(options.body,/left\.ring|descriptor|avatarId/);assert.equal(parts[0].text,customerHandsPrompt());return reply();}});
 assert.match(result,/^data:image\/png;base64,/);assert.equal(calls,1);assert.deepEqual(f.image,original);for(const bytes of transient)assert.ok(bytes.every(v=>v===0));
});
test('invalid input/configuration fails before paid transport; bad outputs and provider errors never retry or leak bodies',async()=>{
 const generate=createCustomerHandsGenerator(),base={handPhoto:f.image,points:f.points,apiKey:'test-key-only'};let calls=0;
 for(const change of [{apiKey:''},{model:'bad/key'},{points:{}},{handPhoto:Buffer.from('bad')}])await assert.rejects(generate({...base,...change,fetchImpl:async()=>{calls++;return reply();}}));assert.equal(calls,0);
 for(const [expected,fetchImpl] of [
  ['quota',async()=>new Response('{"error":{"message":"PRIVATE"}}',{status:429})],['timeout',async()=>{throw Object.assign(new Error('PRIVATE'),{name:'TimeoutError'});}],['network',async()=>{throw new Error('PRIVATE');}],['blocked',async()=>new Response('{"promptFeedback":{"blockReason":"SAFETY"}}')],['no_image',async()=>new Response('{}')],['response',async()=>new Response('PRIVATE')],['invalid_image',async()=>reply(await sharp(f.image).resize(700,900).png().toBuffer())],['invalid_image',async()=>reply(f.image,'image/jpeg')],['hands_changed',async()=>reply(await sharp(f.image).modulate({brightness:.3}).png().toBuffer())]
 ]){let n=0;await assert.rejects(generate({...base,fetchImpl:async(...args)=>{n++;return fetchImpl(...args);}}),e=>{assert.equal(e.code,expected);assert.doesNotMatch(JSON.stringify(providerErrorDetails(e,'gemini')),/PRIVATE|test-key-only/);return true;});assert.equal(n,1);}
});
test('cancelled cleanup returns no image and clears buffers without retry',async()=>{
 for(const stage of ['before','input','transport','retention']){const controller=new AbortController();let calls=0,bytes;if(stage==='before')controller.abort();const generate=createCustomerHandsGenerator({presence:async b=>{bytes=b;if(stage==='input')controller.abort();},retention:async()=>{if(stage==='retention')controller.abort();}});await assert.rejects(generate({handPhoto:f.image,points:f.points,apiKey:'test',signal:controller.signal,fetchImpl:async()=>{calls++;if(stage==='transport')controller.abort();return reply();}}),code('timeout'));assert.equal(calls,['before','input'].includes(stage)?0:1);if(bytes)assert.ok(bytes.every(v=>v===0));}
});
test('jewellery edits on customer hands use their own geometry and photo-retention guard',async()=>{
 const product=await sharp({create:{width:200,height:200,channels:3,background:'#bb9911'}}).jpeg().toBuffer();let photoChecks=0,templateChecks=0;
 const run=createJewelleryTryOn({photoHandsCheck:async(a,b,p)=>{photoChecks++;assert.deepEqual(p,anchors);await requireCustomerHandsUnchanged(a,b,p);},handsCheck:async()=>{templateChecks++;}});
 await run({base:f.image,product,type:'ring',attributes:{metal:'silver'},view:'hands',hand:'left',finger:'ring',anchors,handsSourceKind:'photo',apiKey:'test',fetchImpl:async()=>reply()});assert.equal(photoChecks,1);assert.equal(templateChecks,0);
});
