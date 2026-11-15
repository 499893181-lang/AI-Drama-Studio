import { inflateSync } from 'node:zlib';
import { AppError } from './store.mjs';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25000000;
const fail = message => { throw new AppError(`图片校验失败：${message}`); };
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function size(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > MAX_IMAGE_PIXELS) fail('尺寸须为1–8192像素且总像素不超过2500万。');
  return { width, height };
}
function png(bytes) {
  let offset = 8, header = null, ended = false, hasPalette = false;
  const data = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) fail('PNG块被截断。');
    const type = bytes.toString('ascii', offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) fail('PNG块校验和不正确。');
    if (!header && type !== 'IHDR') fail('PNG缺少首个IHDR。');
    if (type === 'IHDR') {
      if (header || length !== 13) fail('PNG头不正确。');
      header = { ...size(chunk.readUInt32BE(0), chunk.readUInt32BE(4)), depth: chunk[8], color: chunk[9], interlace: chunk[12] };
      const depths = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
      if (!depths[header.color]?.includes(header.depth) || chunk[10] !== 0 || chunk[11] !== 0 || ![0,1].includes(header.interlace)) fail('PNG编码参数不支持。');
    } else if (type === 'PLTE') { if (!length || length % 3 || length > 768) fail('PNG调色板错误。'); hasPalette = true; }
    else if (type === 'IDAT') data.push(chunk);
    else if (type === 'acTL') fail('只支持静态图片，不接受APNG。');
    else if (type === 'IEND') { if (length || end !== bytes.length) fail('PNG结尾或尾随数据不正确。'); ended = true; offset = end; break; }
    else if (type[0] === type[0].toUpperCase()) fail(`不支持的PNG关键块${type}。`);
    offset = end;
  }
  if (!header || !ended || !data.length || header.color === 3 && !hasPalette) fail('PNG正文不完整。');
  const channels = { 0:1, 2:3, 3:1, 4:2, 6:4 }[header.color], bits = channels * header.depth;
  const passes = header.interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const rows = passes.map(([x,y,dx,dy]) => ({ width: Math.max(0,Math.ceil((header.width-x)/dx)), height: Math.max(0,Math.ceil((header.height-y)/dy)) })).filter(p => p.width && p.height).map(p => ({ bytes: Math.ceil(p.width*bits/8)+1, height: p.height }));
  const expected = rows.reduce((n,p) => n+p.bytes*p.height,0);
  let decoded; try { decoded = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 }); } catch { fail('PNG压缩正文损坏。'); }
  if (decoded.length !== expected) fail('PNG扫描行长度不匹配。');
  let rowOffset = 0;
  for (const pass of rows) for (let i = 0; i < pass.height; i++) { if (decoded[rowOffset] > 4) fail('PNG扫描行过滤器不正确。'); rowOffset += pass.bytes; }
  return { ...size(header.width, header.height), format:'png', mimeType:'image/png', extension:'png', verification:'signature_chunks_crc_and_decompressed_rows' };
}
function jpeg(bytes) {
  if (bytes.length < 40 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) fail('JPEG被截断或缺少结尾。');
  let offset = 2, dimensions = null, scans = 0, quantization = false, huffman = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 255) fail('JPEG标记不正确。');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) break;
    if (marker === 216 || marker === 0 || marker >= 208 && marker <= 215) fail('JPEG段顺序不正确。');
    if (offset + 2 > bytes.length) fail('JPEG段被截断。');
    const length = bytes.readUInt16BE(offset), end = offset + length;
    if (length < 2 || end > bytes.length - 2) fail('JPEG段长度不正确。');
    if ([192,193,194].includes(marker)) {
      if (length < 11 || ![8,12].includes(bytes[offset+2])) fail('JPEG帧头不正确。');
      dimensions = size(bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3));
      const components = bytes[offset+7];
      if (![1,3,4].includes(components) || length !== 8 + components*3) fail('JPEG分量不正确。');
    } else if (marker === 219) quantization = true;
    else if (marker === 196) huffman = true;
    if (marker === 218) {
      if (!dimensions || !quantization || !huffman || length < 6) fail('JPEG缺少解码所需帧/表。');
      scans++; offset = end; const start = offset;
      while (offset < bytes.length - 1) {
        if (bytes[offset] !== 255) { offset++; continue; }
        if (bytes[offset+1] === 0 || bytes[offset+1] >= 208 && bytes[offset+1] <= 215) { offset += 2; continue; }
        break;
      }
      if (offset <= start) fail('JPEG扫描数据为空。');
    } else offset = end;
  }
  if (!dimensions || !scans) fail('JPEG没有有效像素扫描数据。');
  return { ...dimensions, format:'jpeg', mimeType:'image/jpeg', extension:'jpg', verification:'signature_segments_tables_and_scan_structure' };
}
function webp(bytes) {
  if (bytes.length < 30 || bytes.readUInt32LE(4) + 8 !== bytes.length) fail('WebP长度不正确。');
  let offset = 12, dimensions = null, image = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii',offset,offset+4), length = bytes.readUInt32LE(offset+4), start=offset+8, end=start+length;
    if (end + (length&1) > bytes.length) fail('WebP块被截断。');
    if (type === 'ANIM' || type === 'ANMF' || type === 'VP8X' && bytes[start]&2) fail('只支持静态WebP。');
    if (type === 'VP8 ') {
      if (length < 11 || bytes[start]&1 || !bytes.subarray(start+3,start+6).equals(Buffer.from([0x9d,1,0x2a]))) fail('WebP VP8帧不正确。');
      dimensions = size(bytes.readUInt16LE(start+6)&16383,bytes.readUInt16LE(start+8)&16383); image = true;
    } else if (type === 'VP8L') {
      if (length < 6 || bytes[start] !== 0x2f) fail('WebP VP8L帧不正确。');
      const packed = bytes.readUInt32LE(start+1);
      if (packed >>> 29) fail('WebP版本不支持。');
      dimensions = size((packed&16383)+1,((packed>>>14)&16383)+1); image = true;
    }
    offset=end+(length&1);
  }
  if (!image || !dimensions || offset !== bytes.length) fail('WebP缺少完整像素数据。');
  return { ...dimensions, format:'webp', mimeType:'image/webp', extension:'webp', verification:'riff_chunks_and_frame_structure' };
}
export function inspectImage(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) fail('文件须为不超过20MB的实际图片。');
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return png(bytes);
  if (bytes[0] === 255 && bytes[1] === 216) return jpeg(bytes);
  if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return webp(bytes);
  fail('只接受真实PNG、JPEG或静态WebP；扩展名及Content-Type不能代替格式校验。');
}

/** Stored ZIP with real file bytes. It does not send anything to ChatGPT. */
export function buildImageZip(files) {
  const local = [], central = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name,'utf8'), data = Buffer.from(file.bytes), crc = crc32(data);
    const header=Buffer.alloc(30); header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6); header.writeUInt32LE(crc,14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(name.length,26);
    local.push(header,name,data);
    const entry=Buffer.alloc(46); entry.writeUInt32LE(0x02014b50,0); entry.writeUInt16LE(20,4); entry.writeUInt16LE(20,6); entry.writeUInt16LE(0x800,8); entry.writeUInt32LE(crc,16); entry.writeUInt32LE(data.length,20); entry.writeUInt32LE(data.length,24); entry.writeUInt16LE(name.length,28); entry.writeUInt32LE(offset,42); central.push(entry,name); offset += header.length+name.length+data.length;
  }
  const directory=Buffer.concat(central), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
