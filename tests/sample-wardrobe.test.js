import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { SAMPLE_GARMENTS, SAMPLE_OUTFITS } from '../src/sample-wardrobe.ts';
import { colourGarmentPixels } from '../src/garment-colours.ts';

test('sample wardrobe offers 44 uniquely named items and complete, valid outfit combinations', () => {
  assert.equal(SAMPLE_GARMENTS.length, 44);
  assert.equal(new Set(SAMPLE_GARMENTS.map(g => g.id)).size, 44);
  assert.equal(new Set(SAMPLE_GARMENTS.map(g => g.name)).size, 44);
  const counts = ['shirt', 'trousers', 'shoes'].map(c => SAMPLE_GARMENTS.filter(g => g.category === c).length);
  assert.deepEqual(counts, [20, 13, 11]);
  assert.equal(counts.reduce((n, count) => n * count, 1), 2860);
  assert.equal(SAMPLE_OUTFITS.length, 8);
  for (const outfit of SAMPLE_OUTFITS) {
    const items = outfit.garments.map(id => SAMPLE_GARMENTS.find(g => g.id === id));
    assert.ok(items.every(Boolean), `${outfit.name}: references shipped garments`);
    assert.deepEqual(items.map(g => g.category).sort(), ['shirt', 'shoes', 'trousers']);
  }
});

test('every colour variant uses a real transparent texture and preserves its full alpha channel', async () => {
  for (const garment of SAMPLE_GARMENTS) {
    const { data, info } = await sharp(`public${garment.source}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    if (!garment.colour) continue;
    assert.match(garment.colour.hex, /^#[0-9a-f]{6}$/);
    assert.ok(garment.colour.reference > 0 && garment.colour.reference < 256);
    const pixels = new Uint8ClampedArray(data);
    colourGarmentPixels(pixels, garment.colour);
    let changes = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      assert.equal(pixels[i + 3], data[i + 3], `${garment.id}: transparency`);
      if (pixels[i + 3] > 240 && pixels[i] !== data[i]) changes++;
    }
    assert.ok(changes > info.width * info.height * 0.05, `${garment.id}: visible colour change`);
  }
});

test('colour treatment retains folds, highlights and translucent edges rather than flattening the garment', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 0, 50, 50, 50, 255, 150, 150, 150, 255,
    220, 220, 220, 255, 150, 150, 150, 87,
  ]);
  colourGarmentPixels(pixels, { hex: '#b94343', reference: 150 });
  assert.deepEqual([...pixels.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...pixels.slice(8, 12)], [185, 67, 67, 255]);
  assert.ok(pixels[4] < pixels[8] && pixels[8] < pixels[12], 'shadows and highlights remain distinct');
  assert.ok(pixels[4] > pixels[5] && pixels[12] > pixels[13], 'folds retain the red hue');
  assert.deepEqual([...pixels.slice(16, 20)], [185, 67, 67, 87]);
});
