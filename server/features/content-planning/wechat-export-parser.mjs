import fs from 'node:fs';

const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const NO_STREAM = 0xffffffff;

function decodeHtml(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .trim();
}

function parseHtmlTable(text) {
  const rows = [];
  for (const row of String(text).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) cells.push(decodeHtml(cell[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseDelimited(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const source = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i], next = source[i + 1];
    if (char === '"') {
      if (quoted && next === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\t')) { row.push(cell.trim()); cell = ''; }
    else if (!quoted && char === '\n') { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

function readSector(buffer, sector, sectorSize) {
  if (!Number.isInteger(sector) || sector < 0) return Buffer.alloc(0);
  const start = (sector + 1) * sectorSize;
  return buffer.subarray(start, start + sectorSize);
}

function chainSectors(buffer, firstSector, fat, sectorSize, maxBytes = Infinity) {
  const result = [];
  const seen = new Set();
  let sector = firstSector;
  while (sector !== END_OF_CHAIN && sector !== NO_STREAM && sector !== FREE_SECTOR && !seen.has(sector) && result.length * sectorSize < maxBytes) {
    seen.add(sector); result.push(readSector(buffer, sector, sectorSize)); sector = fat[sector] ?? END_OF_CHAIN;
  }
  return Buffer.concat(result).subarray(0, maxBytes);
}

function readCompoundStream(buffer, streamName) {
  if (buffer.subarray(0, 8).compare(Buffer.from('d0cf11e0a1b11ae1', 'hex')) !== 0) throw new Error('不是受支持的 BIFF OLE 工作簿');
  const sectorSize = 1 << buffer.readUInt16LE(30);
  const miniSectorSize = 1 << buffer.readUInt16LE(32);
  const fatSectorCount = buffer.readUInt32LE(44);
  const firstDirectorySector = buffer.readUInt32LE(48);
  const miniStreamCutoff = buffer.readUInt32LE(56);
  const firstMiniFatSector = buffer.readUInt32LE(60);
  const miniFatSectorCount = buffer.readUInt32LE(64);
  const firstDifatSector = buffer.readUInt32LE(68);
  const difat = [];
  for (let i = 0; i < 109; i += 1) difat.push(buffer.readUInt32LE(76 + i * 4));
  let difatSector = firstDifatSector;
  const difatSeen = new Set();
  while (difatSector !== END_OF_CHAIN && difatSector !== NO_STREAM && !difatSeen.has(difatSector)) {
    difatSeen.add(difatSector);
    const sector = readSector(buffer, difatSector, sectorSize);
    for (let i = 0; i < sectorSize / 4 - 1; i += 1) difat.push(sector.readUInt32LE(i * 4));
    difatSector = sector.readUInt32LE(sectorSize - 4);
  }
  const fat = [];
  for (const sectorId of difat.slice(0, fatSectorCount)) {
    if (sectorId === FREE_SECTOR || sectorId === NO_STREAM) continue;
    const sector = readSector(buffer, sectorId, sectorSize);
    for (let i = 0; i < sectorSize; i += 4) fat.push(sector.readUInt32LE(i));
  }
  const directory = chainSectors(buffer, firstDirectorySector, fat, sectorSize);
  const entries = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = directory.readUInt16LE(offset + 64);
    const name = nameLength >= 2 ? directory.subarray(offset, offset + nameLength - 2).toString('utf16le') : '';
    entries.push({ name, type: directory[offset + 66], startSector: directory.readUInt32LE(offset + 116), size: Number(directory.readBigUInt64LE(offset + 120)) });
  }
  const entry = entries.find((item) => item.type === 2 && item.name.toLowerCase() === streamName.toLowerCase())
    || entries.find((item) => item.type === 2 && /workbook|book/i.test(item.name));
  if (!entry) throw new Error('BIFF 工作簿流不存在');
  if (entry.size < miniStreamCutoff) {
    const root = entries.find((item) => item.type === 5);
    const miniStream = chainSectors(buffer, root?.startSector ?? NO_STREAM, fat, sectorSize, root?.size ?? Infinity);
    const miniFat = chainSectors(buffer, firstMiniFatSector, fat, sectorSize, miniFatSectorCount * sectorSize);
    const miniFatValues = [];
    for (let i = 0; i + 4 <= miniFat.length; i += 4) miniFatValues.push(miniFat.readUInt32LE(i));
    const parts = [];
    const seen = new Set(); let sector = entry.startSector;
    while (sector !== END_OF_CHAIN && sector !== NO_STREAM && !seen.has(sector) && parts.length * miniSectorSize < entry.size) {
      seen.add(sector);
      const start = sector * miniSectorSize; parts.push(miniStream.subarray(start, start + miniSectorSize)); sector = miniFatValues[sector] ?? END_OF_CHAIN;
    }
    return Buffer.concat(parts).subarray(0, entry.size);
  }
  return chainSectors(buffer, entry.startSector, fat, sectorSize, entry.size);
}

function xlString(buffer, offset, { short = false } = {}) {
  if (offset + 3 > buffer.length) return { value: '', next: buffer.length };
  const length = short ? buffer[offset] : buffer.readUInt16LE(offset);
  let cursor = offset + (short ? 1 : 2);
  const flags = buffer[cursor++];
  const rich = (flags & 0x08) ? buffer.readUInt16LE(cursor) : 0;
  if (flags & 0x08) cursor += 2;
  const phonetic = (flags & 0x04) ? buffer.readUInt32LE(cursor) : 0;
  if (flags & 0x04) cursor += 4;
  const bytes = length * ((flags & 0x01) ? 2 : 1);
  const value = buffer.subarray(cursor, cursor + bytes).toString((flags & 0x01) ? 'utf16le' : 'latin1');
  cursor += bytes + rich * 4 + phonetic;
  return { value, next: cursor };
}

function decodeRk(value) {
  const divided = value & 1; const integer = value & 2;
  let result;
  if (integer) result = value >> 2;
  else { const bits = BigInt(value & 0xfffffffc) << 32n; const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, bits, true); result = view.getFloat64(0, true); }
  return divided ? result / 100 : result;
}

function parseBiff(buffer) {
  const sheets = new Map(); const bounds = []; const sharedStrings = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const recordOffset = offset, id = buffer.readUInt16LE(offset), length = buffer.readUInt16LE(offset + 2);
    const payload = buffer.subarray(offset + 4, offset + 4 + length); offset += 4 + length;
    if (id === 0x0085 && payload.length >= 8) {
      const nameLength = payload[6];
      const unicode = Boolean(payload[7] & 0x01);
      bounds.push({ offset: payload.readUInt32LE(0), name: payload.subarray(8, 8 + nameLength * (unicode ? 2 : 1)).toString(unicode ? 'utf16le' : 'latin1') });
    } else if (id === 0x00fc && payload.length >= 8) {
      let cursor = 8;
      while (cursor + 3 <= payload.length && sharedStrings.length < payload.readUInt32LE(4)) { const parsed = xlString(payload, cursor); sharedStrings.push(parsed.value); if (parsed.next <= cursor) break; cursor = parsed.next; }
    }
    const current = bounds.slice().reverse().find((item) => recordOffset >= item.offset)?.name || 'Sheet1';
    if (!sheets.has(current)) sheets.set(current, new Map());
    const cells = sheets.get(current);
    const put = (row, col, value) => { if (!cells.has(row)) cells.set(row, new Map()); cells.get(row).set(col, value); };
    if (id === 0x00fd && payload.length >= 10) put(payload.readUInt16LE(0), payload.readUInt16LE(2), sharedStrings[payload.readUInt32LE(6)] ?? '');
    else if (id === 0x0204 && payload.length >= 8) put(payload.readUInt16LE(0), payload.readUInt16LE(2), xlString(payload, 6, { short: false }).value);
    else if (id === 0x0203 && payload.length >= 14) put(payload.readUInt16LE(0), payload.readUInt16LE(2), payload.readDoubleLE(6));
    else if (id === 0x027e && payload.length >= 10) put(payload.readUInt16LE(0), payload.readUInt16LE(2), decodeRk(payload.readUInt32LE(6)));
    else if (id === 0x00bd && payload.length >= 6) { const row = payload.readUInt16LE(0), firstCol = payload.readUInt16LE(2), lastCol = payload.readUInt16LE(payload.length - 2); let cursor = 4; for (let col = firstCol; col <= lastCol && cursor + 6 <= payload.length - 2; col += 1, cursor += 6) put(row, col, decodeRk(payload.readUInt32LE(cursor + 2))); }
    else if (id === 0x0205 && payload.length >= 8) put(payload.readUInt16LE(0), payload.readUInt16LE(2), payload[6] ? null : Boolean(payload[6]));
    else if (id === 0x0006 && payload.length >= 14) put(payload.readUInt16LE(0), payload.readUInt16LE(2), payload.readDoubleLE(6));
  }
  const result = [];
  for (const [name, rows] of sheets) {
    const maxRow = Math.max(-1, ...rows.keys()); const maxCol = Math.max(-1, ...[...rows.values()].flatMap((row) => [...row.keys()]));
    result.push({ name, rows: Array.from({ length: maxRow + 1 }, (_, rowIndex) => Array.from({ length: maxCol + 1 }, (_, colIndex) => rows.get(rowIndex)?.get(colIndex) ?? '')) });
  }
  return result;
}

export function parseWechatExport(buffer, fileName = '') {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const text = raw.toString('utf8');
  const rows = /^\s*</.test(text) && /<tr\b/i.test(text) ? parseHtmlTable(text) : /\.csv$|\.tsv$/i.test(fileName) || !raw.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) ? parseDelimited(text) : null;
  if (rows) return { format: /^\s*</.test(text) ? 'html-xls' : 'csv', sheets: [{ name: 'Sheet1', rows }] };
  return { format: 'biff-xls', sheets: parseBiff(readCompoundStream(raw, 'Workbook')) };
}

export function parseWechatExportFile(filePath) {
  return parseWechatExport(fs.readFileSync(filePath), filePath);
}
