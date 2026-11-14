// Local file helpers: read text/JSON/CSV/Markdown and ZIP, create and export files.
// Dependency-free. ZIP inflate uses the browser/Node built-in DecompressionStream.
export const MAX_READ_BYTES = 5 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 500;
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'csv', 'tsv', 'js', 'mjs', 'css', 'html', 'xml', 'yml', 'yaml', 'log', 'py', 'ini']);
const MIME_BY_EXTENSION = { txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values', html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', xml: 'application/xml', yml: 'text/yaml', yaml: 'text/yaml', log: 'text/plain', py: 'text/x-python', ini: 'text/plain', zip: 'application/zip' };

export function getExtension(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name));
  return match ? match[1].toLowerCase() : '';
}

export function validateFileName(name) {
  if (typeof name !== 'string' || !name || name.length > 100) return { valid: false, reason: 'File name must be 1 to 100 characters.' };
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || name.startsWith('.') || name.includes('..')) {
    return { valid: false, reason: 'File name cannot contain path separators, "..", or special characters.' };
  }
  if (!MIME_BY_EXTENSION[getExtension(name)]) return { valid: false, reason: 'Unsupported file type. Use txt, md, json, csv, html, js, css, xml, yml, or zip.' };
  return { valid: true };
}

export function isSafeZipPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 240
    && !path.startsWith('/') && !path.includes('\\') && !/(^|\/)\.\.(\/|$)/.test(path) && !/[:\u0000-\u001f]/.test(path);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress ZIP files.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function listZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP file.');
  const count = view.getUint16(eocd + 10, true);
  if (count > MAX_ZIP_ENTRIES) throw new Error(`ZIP has too many entries (limit ${MAX_ZIP_ENTRIES}).`);
  let offset = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP directory is corrupt.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, method, compressedSize, size, localOffset, directory: name.endsWith('/'), safe: isSafeZipPath(name.replace(/\/$/, '')) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readZipEntry(bytes, entry) {
  if (!entry.safe) throw new Error('Unsafe path in ZIP entry.');
  if (entry.size > MAX_ENTRY_BYTES) throw new Error('ZIP entry is too large to read here.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(`Unsupported ZIP compression method ${entry.method}.`);
}

export async function readUploadedFile(file) {
  if (!file || typeof file.name !== 'string') throw new TypeError('A file is required.');
  if (file.size > MAX_READ_BYTES) throw new RangeError('File is larger than 5 MB.');
  const extension = getExtension(file.name);
  if (extension === 'zip') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = listZipEntries(bytes);
    return { name: file.name, kind: 'zip', entries: entries.map(({ name, size, directory, safe }) => ({ name, size, directory, safe })), bytes };
  }
  if (extension === 'pdf' || extension === 'docx' || extension === 'xlsx') {
    return { name: file.name, kind: 'unsupported', reason: `.${extension} text extraction needs a library that is not bundled; no content was read.` };
  }
  if (!TEXT_EXTENSIONS.has(extension) && !String(file.type).startsWith('text/')) {
    return { name: file.name, kind: 'unsupported', reason: 'Only text-based files and ZIP archives can be read.' };
  }
  return { name: file.name, kind: 'text', text: await file.text() };
}

export function createFile(name, content) {
  const check = validateFileName(name);
  if (!check.valid) throw new TypeError(check.reason);
  if (typeof content !== 'string') throw new TypeError('File content must be text.');
  const data = new TextEncoder().encode(content);
  if (data.length === 0) throw new TypeError('File content cannot be empty.');
  if (data.length > MAX_READ_BYTES) throw new RangeError('File content is larger than 5 MB.');
  return { name, mime: MIME_BY_EXTENSION[getExtension(name)], size: data.length, data };
}

export function editFile(file, transform) {
  const text = new TextDecoder().decode(file.data);
  const next = transform(text);
  if (typeof next !== 'string') throw new TypeError('Edit must return text.');
  return createFile(file.name, next);
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    if (!isSafeZipPath(file.name)) throw new TypeError(`Unsafe file name: ${file.name}`);
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, file.data.length, true); local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, file.data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, file.data.length, true); dir.setUint32(24, file.data.length, true);
    dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of all) { out.set(part, position); position += part.length; }
  return { name: 'jarvis-export.zip', mime: 'application/zip', size: out.length, data: out };
}

// Triggers a browser download. The user's browser shows its own save dialog/permission.
export function downloadFile(file, { document: doc = globalThis.document, urlApi = globalThis.URL } = {}) {
  const url = urlApi.createObjectURL(new Blob([file.data], { type: file.mime }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => urlApi.revokeObjectURL(url), 10_000);
  return true;
}
