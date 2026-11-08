import {createHash} from 'node:crypto';
import {detectFaces} from './face-check.js';
import {normalizeJewelleryView} from './jewellery-tryon.js';
import {jewelleryMeasurementFields,ringSuggestion,bangleSuggestion,necklaceGuides} from '../src/jewellery-sizing.js';
import {transaction} from './catalogue-fields.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status}),hash=b=>createHash('sha256').update(b).digest('hex');
export function customerSizing(store,account,id){
  const avatar=store.views.avatar(account,id),customer=avatar.customer?store.customers.get(account,avatar.customer):null;
  return {customer:customer?{id:customer.id,name:customer.name,measurements:customer.measurements}:null,ring:ringSuggestion(customer?.measurements),bangle:bangleSuggestion(customer?.measurements),creditsUsed:0};
}
export function saveCustomerSizing(store,account,input,guard){
  if(input.storageConsent!==true)throw fail('Confirm customer agreement to save these jewellery measurements.');
  if(!input.measurements||typeof input.measurements!=='object'||Array.isArray(input.measurements)||Object.keys(input.measurements).some(k=>!jewelleryMeasurementFields.some(f=>f.key===k)))throw fail('Use only the supported jewellery measurement fields.');
  return transaction(store.db,()=>{guard();const avatar=store.views.avatar(account,input.avatarId);if(!avatar.customer)throw fail('Save this avatar under a customer profile in Forme before keeping jewellery measurements.',409);if(input.customerId!==avatar.customer)throw fail('The avatar’s linked customer changed. Reload the saved measurements before editing.',409);store.customers.save(account,{measurements:input.measurements},avatar.customer);return customerSizing(store,account,input.avatarId);});
}
export async function fullNecklaceAnchors(png){
  const faces=await detectFaces(png,{landmarks:true,upper:true,necklace:true});if(faces.length!==1)throw fail('A clear front-facing face is needed for this optional guide. You can continue trying jewellery.',422);
  const f=faces[0],dx=f.eyes.right.x-f.eyes.left.x,dy=f.eyes.right.y-f.eyes.left.y;
  if(!f.neckBase||Math.hypot(dx,dy)<8)throw fail('The full-body face is too small for a reliable guide. Use the saved portrait or continue without guides.',422);
  return {anchors:{neckBase:f.neckBase},pxPerMm:Math.hypot(dx,dy)/63,angle:Math.atan2(dy,dx)*180/Math.PI,width:1024,height:1536};
}
export async function necklaceGuide(store,account,id,view,{guard=()=>{},computeFull=fullNecklaceAnchors}={}){
  if(!['portrait','full'].includes(view))throw fail('Choose portrait or full body for the necklace guide.');
  const context=store.views.context(account,id,'portrait'),source=view==='portrait'?Buffer.from(store.views.get(account,id,'portrait').image):Buffer.from(context.avatar.image),sourceHash=hash(source);let normalized;
  try{
    const packet=view==='portrait'?await store.views.anchors(account,id):await computeFull(normalized=await normalizeJewelleryView(source,'full'));
    guard();store.views.current(account,id,'portrait',context);const fresh=view==='portrait'?store.views.get(account,id,'portrait').image:store.views.avatar(account,id).image;
    if(hash(fresh)!==sourceHash)throw fail('This view changed. Reload the optional length guide.',409);
    const result={...packet,width:view==='portrait'?1152:1024,height:1536,sourceHash,view,creditsUsed:0,warning:'Illustrative chain lengths, not measured fit. Eye spacing assumes 63 mm; neck shape and chain drape change where jewellery sits.'};try{necklaceGuides(result);}catch{throw fail('The optional necklace guide could not be located in this view. Continue without guides.',422);}return result;
  }finally{source.fill(0);normalized?.fill(0);}
}
