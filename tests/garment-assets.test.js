import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

test("nine shipped garments have usable transparency; neck openings and shoe-pair gaps stay clear", async () => {
  for (const id of ['navy-tee','cream-tee','blue-shirt','blue-jeans','charcoal-chinos','sand-chinos','white-sneakers','black-sneakers','brown-shoes']) {
    const {data,info} = await sharp(`public/garments/${id}.webp`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.ok(info.width >= 128 && info.height >= 128, `${id}: product-resolution asset`);
    let opaque=0,transparent=0;
    for(let i=3;i<data.length;i+=4){if(data[i]>240)opaque++;if(data[i]<16)transparent++;}
    assert.ok(opaque > info.width*info.height*0.15, `${id}: visible garment`);
    assert.ok(transparent > info.width*info.height*0.05, `${id}: transparent surroundings`);
    if(id.endsWith('tee')) {
      for(let y=0;y<16;y++) assert.ok(data[(y*info.width+Math.floor(info.width/2))*4+3]<16, `${id}: neckline must be open, not a band across the neck`);
    }
    if(id.includes('sneakers')||id==='brown-shoes') {
      for(let y=0;y<info.height;y++) assert.ok(data[(y*info.width+Math.floor(info.width/2))*4+3]<16, `${id}: separate left/right shoes`);
    }
  }
});
