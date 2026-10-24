'use strict';
const sharp = require('sharp');
const crypto = require('node:crypto');
const MAX_CAPTURE_BYTES = 40 * 1024 * 1024;
const INLINE_BYTES = 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const MAX_CHUNK_BYTES = 512 * 1024;
const CAPTURE_TTL_MS = 120000;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error(code), {code});
async function compressCapture(png, width, height, format = 'auto') {
  if (png.length > MAX_CAPTURE_BYTES) throw fail('CU_CAPTURE_TOO_LARGE');
  try {
    const image = sharp(png, {limitInputPixels: 8388608, failOn: 'warning'});
    const info = await image.metadata();
    if (info.format !== 'png' || info.width !== width || info.height !== height || (info.pages || 1) !== 1) throw fail('CU_INVALID_CAPTURE');
    const candidates = [];
    if (format !== 'webp') {
      const optimized = await image.clone().png({compressionLevel: 9, adaptiveFiltering: true, palette: false}).timeout({seconds: 12}).toBuffer().catch(() => png);
      candidates.push({bytes: optimized.length < png.length ? optimized : png, mime_type: 'image/png'});
    }
    if (format !== 'png') {
      const webp = await image.clone().webp({lossless: true, effort: 4}).timeout({seconds: 12}).toBuffer().catch(error => { if (format === 'webp') throw error; return null; });
      if (webp) candidates.push({bytes: webp, mime_type: 'image/webp'});
    }
    candidates.sort((a, b) => a.bytes.length - b.bytes.length);
    const selected = candidates[0];
    if (selected.bytes.length > MAX_CAPTURE_BYTES) throw fail('CU_CAPTURE_TOO_LARGE');
    return {...selected, source_byte_length: png.length, compression: 'lossless', candidates: candidates.map(c => ({mime_type: c.mime_type, byte_length: c.bytes.length}))};
  } catch (error) { throw /^CU_/.test(error.code || '') ? error : fail('CU_INVALID_CAPTURE'); }
}
function snapshot(compressed, delivery = 'auto', now = Date.now()) {
  const {bytes, ...details} = compressed;
  const metadata = {screenshot_id: crypto.randomUUID(), ...details, encoding: 'base64', byte_length: bytes.length, sha256: hash(bytes),
    delivery: delivery === 'chunked' || bytes.length > INLINE_BYTES ? 'chunked' : 'inline', chunk_size: CHUNK_BYTES,
    expires_at: new Date(now + CAPTURE_TTL_MS).toISOString()};
  return {bytes, metadata, expiresAt: now + CAPTURE_TTL_MS};
}
function readChunk(capture, id, offset = 0, length = CHUNK_BYTES) {
  if (!capture || capture.metadata.screenshot_id !== id || Date.now() >= capture.expiresAt) throw fail('CU_SCREENSHOT_EXPIRED');
  if (offset > capture.bytes.length) throw fail('CU_INVALID_ARGUMENT');
  const bytes = capture.bytes.subarray(offset, Math.min(offset + length, capture.bytes.length));
  return {...capture.metadata, offset, length: bytes.length, next_offset: offset + bytes.length, eof: offset + bytes.length === capture.bytes.length,
    chunk_sha256: hash(bytes), data: bytes.toString('base64')};
}
module.exports = {compressCapture, snapshot, readChunk, MAX_CAPTURE_BYTES, INLINE_BYTES, CHUNK_BYTES, MAX_CHUNK_BYTES, CAPTURE_TTL_MS};
