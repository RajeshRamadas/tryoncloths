// Chromium does not consistently honor WebP EXIF orientation. Neutralize the tag
// before decoding so manual correction cannot be applied twice by another browser.
export function webpOrientation(buffer) {
  const view = new DataView(buffer);
  const ascii = (offset, text) =>
    offset + text.length <= view.byteLength &&
    [...text].every((char, index) => view.getUint8(offset + index) === char.charCodeAt(0));
  if (!ascii(0, "RIFF") || !ascii(8, "WEBP")) return null;
  const end = Math.min(view.byteLength, view.getUint32(4, true) + 8);
  for (let chunk = 12; chunk + 8 <= end;) {
    const size = view.getUint32(chunk + 4, true);
    const next = chunk + 8 + size;
    if (next > end) return null;
    if (ascii(chunk, "EXIF")) {
      let tiff = chunk + 8;
      if (ascii(tiff, "Exif\0\0")) tiff += 6;
      if (tiff + 8 > next) return null;
      const little = ascii(tiff, "II");
      if (!little && !ascii(tiff, "MM")) return null;
      if (view.getUint16(tiff + 2, little) !== 42) return null;
      const directory = tiff + view.getUint32(tiff + 4, little);
      if (directory < tiff + 8 || directory + 2 > next) return null;
      const count = view.getUint16(directory, little);
      for (let entry = directory + 2, index = 0; index < count; index++, entry += 12) {
        if (entry + 12 > next) return null;
        if (view.getUint16(entry, little) !== 0x112) continue;
        if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) return null;
        const orientation = view.getUint16(entry + 8, little);
        if (orientation < 1 || orientation > 8) return null;
        return { orientation, offset: entry + 8, little };
      }
      return null;
    }
    chunk = next + (size % 2);
  }
  return null;
}

export async function preparePhoto(file) {
  if (file.type !== "image/webp") return { source: file, orientation: 1 };
  const buffer = await file.arrayBuffer();
  const tag = webpOrientation(buffer);
  if (!tag || tag.orientation === 1) return { source: file, orientation: 1 };
  new DataView(buffer).setUint16(tag.offset, 1, tag.little);
  return { source: new Blob([buffer], { type: file.type }), orientation: tag.orientation };
}

export function orientCanvas(context, orientation, width, height) {
  switch (orientation) {
    case 2: context.transform(-1, 0, 0, 1, width, 0); break;
    case 3: context.transform(-1, 0, 0, -1, width, height); break;
    case 4: context.transform(1, 0, 0, -1, 0, height); break;
    case 5: context.transform(0, 1, 1, 0, 0, 0); break;
    case 6: context.transform(0, 1, -1, 0, height, 0); break;
    case 7: context.transform(0, -1, -1, 0, height, width); break;
    case 8: context.transform(0, -1, 1, 0, 0, width); break;
  }
}
