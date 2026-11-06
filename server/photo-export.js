import sharp from 'sharp';
export const photoFormats={'1:1':{width:1024,height:1024,label:'Square 1:1'},'4:5':{width:1024,height:1280,label:'Portrait 4:5'},'3:4':{width:960,height:1280,label:'Portrait 3:4'},white:{width:1024,height:1536,label:'White studio 2:3'}};
const xmp=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType></rdf:Description></rdf:RDF></x:xmpmeta>`;
export const photoFilename=(sku,format)=>`${String(sku||'product').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,64)||'product'}-ai-model-${format.replace(':','x')}.jpg`;
export async function photoRenditions(bytes,formats,{trial=false}={}){
 const metadata=await sharp(bytes,{limitInputPixels:25000000}).metadata();if(metadata.format!=='png'||metadata.width<128||metadata.height<256||metadata.width>=metadata.height)throw new Error('Invalid photo output');
 const outputs=[];for(const format of formats){const {width,height}=photoFormats[format];let image=sharp(bytes,{limitInputPixels:25000000}).rotate().flatten({background:'#fff'}).resize(width,height,{fit:'contain',background:'#fff'});
  if(trial)image=image.composite([{input:Buffer.from('<svg width="210" height="36"><rect width="100%" height="100%" fill="white" opacity=".9"/><text x="105" y="25" text-anchor="middle" font-size="18" font-family="sans-serif" fill="#234b3a">Forme trial</text></svg>'),gravity:'southeast'}]);
  outputs.push({format,image:await image.withXmp(xmp).jpeg({quality:90}).toBuffer()});
 }return outputs;
}
export async function photoPreview(bytes){return sharp(bytes,{limitInputPixels:25000000}).resize(480,720,{fit:'contain',background:'#fff'}).composite([{input:Buffer.from('<svg width="260" height="36"><rect width="100%" height="100%" fill="white" opacity=".9"/><text x="130" y="24" text-anchor="middle" font-size="16" font-family="sans-serif" fill="#234b3a">AI preview · review required</text></svg>'),gravity:'south'}]).jpeg({quality:75}).toBuffer();}
const crcTable=Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
export function crc32(buffer){let crc=0xffffffff;for(const byte of buffer)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// Store JPEGs directly: compression would add CPU without appreciably reducing them.
export async function writePhotoZip(res,entries){
 const central=[];let offset=0,count=0;
 const write=async buffer=>{if(res.destroyed)throw new Error('Download closed');if(!res.write(buffer))await new Promise((resolve,reject)=>{const cleanup=()=>{res.off('drain',ready);res.off('close',closed);res.off('error',closed);},ready=()=>{cleanup();resolve();},closed=()=>{cleanup();reject(new Error('Download closed'));};res.once('drain',ready);res.once('close',closed);res.once('error',closed);if(res.destroyed)closed();});};
 for await(const {name,image} of entries){const file=Buffer.from(name),crc=crc32(image),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(image.length,18);header.writeUInt32LE(image.length,22);header.writeUInt16LE(file.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(33,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(image.length,20);directory.writeUInt32LE(image.length,24);directory.writeUInt16LE(file.length,28);directory.writeUInt32LE(offset,42);central.push(directory,file);
  await write(header);await write(file);await write(image);offset+=header.length+file.length+image.length;count++;
 }
 const size=central.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);for(const chunk of central)await write(chunk);res.end(end);
}
