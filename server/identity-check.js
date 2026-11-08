import sharp from 'sharp';
import {withFaceApi} from './face-check.js';
import {ProviderError} from './provider-errors.js';

const valid = value => value instanceof Float32Array && value.length === 128 && value.every(Number.isFinite);

/** Internal helper only. The caller owns this ephemeral array and must clear it.
 * Never include it in a response, persistent record, error or diagnostic log. */
export async function descriptor(pngBuffer) {
  let pixels;
  try {
    if (!Buffer.isBuffer(pngBuffer) || !pngBuffer.length || pngBuffer.length > 20 * 1024 * 1024) throw new Error();
    const image = sharp(pngBuffer, {limitInputPixels:25_000_000, animated:false});
    const meta = await image.metadata();
    if (meta.format !== 'png' || meta.pages > 1) throw new Error();
    pixels = await image.rotate().resize({width:600,height:600,fit:'inside',withoutEnlargement:true})
      .flatten({background:'#fff'}).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
  } catch { throw new ProviderError('missing_face'); }

  try {
    return await withFaceApi(async api => {
      const tensor = api.tf.tensor3d(new Uint8Array(pixels.data), [pixels.info.height,pixels.info.width,3]);
      let crops = [], aligned = [], raw;
      try {
        // Use the underlying async nets rather than ComposableTask thenables:
        // their rejection handling and crop disposal are incomplete on failure.
        const faces = await api.nets.tinyFaceDetector.locateFaces(tensor, new api.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:0.5}));
        if (faces.length !== 1) throw new ProviderError('missing_face');
        crops = await api.extractFaceTensors(tensor, faces);
        if (crops.length !== 1) throw new ProviderError('face_check');
        const landmarks = await api.nets.faceLandmark68Net.detectLandmarks(crops[0]);
        const face = api.extendWithFaceLandmarks({detection:faces[0]}, landmarks);
        // This is the same Dlib alignment used by withFaceDescriptors().
        aligned = await api.extractFaceTensors(tensor, [face.landmarks.align(null, {useDlibAlignment:true})]);
        if (aligned.length !== 1) throw new ProviderError('face_check');
        raw = await api.nets.faceRecognitionNet.computeFaceDescriptor(aligned[0]);
        if (!valid(raw)) throw new ProviderError('face_check');
        return new Float32Array(raw);
      } finally {
        if (raw instanceof Float32Array) raw.fill(0);
        for (const crop of [...crops,...aligned]) crop.dispose();
        tensor.dispose();
      }
    }, {recognition:true});
  } catch (error) {
    throw new ProviderError(error instanceof ProviderError && error.code === 'missing_face' ? 'missing_face' : 'face_check');
  } finally { pixels.data.fill(0); }
}

// Dependency injection keeps distance/error/cleanup tests independent of model
// scores. This factory is server-internal and is never exposed as an endpoint.
export function createIdentityChecker({describe = descriptor} = {}) {
  return async function requireSameIdentity(reference, candidate, max = Number(process.env.TRYON_IDENTITY_MAX || 0.45)) {
    if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0 || max > 1) throw new ProviderError('face_check');
    let a, b;
    try {
      // Sequential inference bounds memory and shares the presence-check queue.
      a = await describe(reference);
      if (!valid(a)) throw new ProviderError('face_check');
      b = await describe(candidate);
      if (!valid(b)) throw new ProviderError('face_check');
      let squared = 0;
      for (let i = 0; i < 128; i++) squared += (a[i] - b[i]) ** 2;
      const distance = Math.sqrt(squared);
      // Compare the unrounded value so reporting precision cannot accept a miss.
      if (distance > max) throw new ProviderError('identity_mismatch');
      return Math.round(distance * 100) / 100;
    } catch (error) {
      if (error instanceof ProviderError && ['missing_face','face_check','identity_mismatch'].includes(error.code)) throw error;
      throw new ProviderError('face_check');
    } finally {
      if (a instanceof Float32Array) a.fill(0);
      if (b instanceof Float32Array) b.fill(0);
    }
  };
}

export const requireSameIdentity = createIdentityChecker();
