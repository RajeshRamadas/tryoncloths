import sharp from 'sharp';
import {customerFace,requireVisibleFace} from './face-check.js';
import {BillingError} from './billing.js';
const invalid=()=>new BillingError('shopper_photo_invalid','Use one clear face photo and one full-body photo, with no other people. Photos must be JPEG, PNG or WebP under 5 MB and 12 megapixels.',400);

export async function shopperPhoto(value,{output=false,png=false}={}){
  const max=(output?10:5)*1024*1024;
  const match=typeof value==='string'&&value.length<=Math.ceil(max*4/3)+100&&/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)throw invalid();const raw=Buffer.from(match[2],'base64');if(!raw.length||raw.length>max)throw invalid();
  const magic=match[1]==='png'?raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?raw[0]===255&&raw[1]===216&&raw[2]===255:raw.subarray(0,4).toString()==='RIFF'&&raw.subarray(8,12).toString()==='WEBP';
  if(!magic)throw invalid();
  try{const image=sharp(raw,{limitInputPixels:12000000,animated:false}),meta=await image.metadata();
    if(!['jpeg','png','webp'].includes(meta.format)||meta.format!==match[1]||meta.width<128||meta.height<128||(meta.pages||1)!==1)throw invalid();
    const base=image.rotate().resize(1024,1536,{fit:'inside',withoutEnlargement:true}).toColourspace('srgb');
    return {raw,bytes:await (png?base.png():base.jpeg({quality:90})).toBuffer()};
  }catch{throw invalid();}
}
export async function shopperInputs(action,images,{faceCheck=customerFace,visibleCheck=requireVisibleFace}={}){
  const keys=action==='avatar'?['face','body']:['avatar','garment'];
  if(!images||Object.keys(images).length!==2||Object.keys(images).some(k=>!keys.includes(k)))throw invalid();
  const result={};for(const key of keys)result[key]=(await shopperPhoto(images[key],{png:key==='avatar',output:key==='avatar'})).bytes;
  try{if(action==='avatar'){await faceCheck(result.face);await visibleCheck(result.body);}else await visibleCheck(result.avatar);}
  catch{throw invalid();}return result;
}
