import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

export type DeliverableSeverity = 'error' | 'warning';

export interface DeliverableDefect {
  code: string;
  severity: DeliverableSeverity;
  location: string;
  message: string;
}

export interface ExpectedShape {
  // For xlsx/csv/tsv:
  sheets?: string[];
  headers?: Record<string, string[]> | string[];
  strictColumns?: boolean;
  // For docx/md/txt:
  headings?: string[];
  // For json/jsonl:
  requiredKeys?: string[];
  strictKeys?: boolean;
}

export interface DeliverableInspectorOptions {
  filePath?: string;
  format?: string;
  expectedShape?: ExpectedShape;
  checkPlaceholders?: boolean;
  maxUncompressedBytes?: number;
}

export interface DeliverableInspectionResult {
  ok: boolean;
  format: string;
  filePath?: string;
  canonicalText: string;
  defects: DeliverableDefect[];
  stats: Record<string, unknown>;
}

export interface ZipEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  crc32: number;
  data?: Buffer;
}

export interface ZipArchive {
  entries: Map<string, ZipEntry>;
  readEntry(fileName: string): Buffer | null;
  readEntryText(fileName: string): string | null;
  defect?: DeliverableDefect;
}

// ---------------------------------------------------------------------------
// CRC32 IEEE 802.3 Standard Implementation
// ---------------------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Pure In-Memory ZIP Builder (Supports Standard & Bit-3 Data Descriptor)
// ---------------------------------------------------------------------------
export interface InMemoryZipFile {
  name: string;
  content: string | Buffer;
  useBit3Descriptor?: boolean;
}

export function buildInMemoryZip(files: InMemoryZipFile[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const rawData = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf8');
    const checksum = crc32(rawData);
    const compressed = zlib.deflateRawSync(rawData);
    const fileNameBytes = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
    const useBit3 = file.useBit3Descriptor === true;
    const flag = useBit3 ? 0x0008 : 0x0000;
    const method = 8; // Deflate

    // 1. Local File Header
    const localHeader = Buffer.alloc(30 + fileNameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(flag, 6); // general purpose bit flag
    localHeader.writeUInt16LE(method, 8); // compression method
    localHeader.writeUInt16LE(0, 10); // last mod time
    localHeader.writeUInt16LE(0, 12); // last mod date
    localHeader.writeUInt32LE(useBit3 ? 0 : checksum, 14); // crc32
    localHeader.writeUInt32LE(useBit3 ? 0 : compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(useBit3 ? 0 : rawData.length, 22); // uncompressed size
    localHeader.writeUInt16LE(fileNameBytes.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra field length
    fileNameBytes.copy(localHeader, 30);

    const fileChunks: Buffer[] = [localHeader, compressed];
    let fileBlockLen = localHeader.length + compressed.length;

    // Optional bit-3 Data Descriptor after compressed data
    if (useBit3) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0); // signature
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(rawData.length, 12);
      fileChunks.push(descriptor);
      fileBlockLen += descriptor.length;
    }

    localHeaders.push(Buffer.concat(fileChunks));

    // 2. Central Directory Header
    const centralHeader = Buffer.alloc(46 + fileNameBytes.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(flag, 8); // general purpose bit flag
    centralHeader.writeUInt16LE(method, 10); // compression method
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(checksum, 16); // authoritative crc32
    centralHeader.writeUInt32LE(compressed.length, 20); // authoritative compressed size
    centralHeader.writeUInt32LE(rawData.length, 24); // authoritative uncompressed size
    centralHeader.writeUInt16LE(fileNameBytes.length, 28); // name len
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(currentOffset, 42); // local header offset
    fileNameBytes.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    currentOffset += fileBlockLen;
  }

  const centralDirOffset = currentOffset;
  const centralDirBuffer = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuffer.length;

  // 3. End of Central Directory Record (EOCD)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(files.length, 8); // entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // CD size
  eocd.writeUInt32LE(centralDirOffset, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

// ---------------------------------------------------------------------------
// Zero-Dep EOCD + Central Directory ZIP Reader
// ---------------------------------------------------------------------------
const OLE2_MAGIC = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
const MAX_CUMULATIVE_UNCOMPRESSED_BYTES = 32 * 1024 * 1024; // 32MB zip bomb protection

export function isOle2CompoundDocument(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== OLE2_MAGIC[i]) return false;
  }
  return true;
}

export function readZipEntries(
  buf: Buffer,
  maxUncompressedBytes = MAX_CUMULATIVE_UNCOMPRESSED_BYTES
): { archive?: ZipArchive; defect?: DeliverableDefect } {
  // Check OLE2 legacy magic
  if (isOle2CompoundDocument(buf)) {
    return {
      defect: {
        code: 'UNSUPPORTED_LEGACY_OLE2',
        severity: 'error',
        location: 'archive',
        message:
          'Legacy binary OLE2 Compound Document format (.xls/.doc/.ppt) is unsupported. Please convert or re-save as modern OOXML (.xlsx/.docx/.pptx) or export as plain text/CSV.',
      },
    };
  }

  // Scan backwards for EOCD (0x06054b50)
  const minPos = Math.max(0, buf.length - 65557);
  let eocdOffset = -1;
  for (let pos = buf.length - 22; pos >= minPos; pos--) {
    if (buf.readUInt32LE(pos) === 0x06054b50) {
      const commentLen = buf.readUInt16LE(pos + 20);
      if (pos + 22 + commentLen === buf.length) {
        eocdOffset = pos;
        break;
      }
    }
  }

  if (eocdOffset === -1) {
    return {
      defect: {
        code: 'ERR_ARCHIVE_CORRUPTED',
        severity: 'error',
        location: 'archive',
        message: 'End of Central Directory (EOCD) signature not found.',
      },
    };
  }

  const diskNumber = buf.readUInt16LE(eocdOffset + 4);
  const cdDisk = buf.readUInt16LE(eocdOffset + 6);
  const diskEntries = buf.readUInt16LE(eocdOffset + 8);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buf.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  // Check for ZIP64 EOCD locator (0x07064b50), ZIP64 EOCD record (0x06064b50), or 0xFFFFFFFF overflow
  if (
    diskNumber === 0xffff ||
    cdDisk === 0xffff ||
    diskEntries === 0xffff ||
    totalEntries === 0xffff ||
    centralDirSize === 0xffffffff ||
    centralDirOffset === 0xffffffff ||
    (eocdOffset >= 20 && buf.readUInt32LE(eocdOffset - 20) === 0x07064b50) ||
    (eocdOffset >= 56 && buf.readUInt32LE(eocdOffset - 56) === 0x06064b50) ||
    (eocdOffset >= 76 && buf.readUInt32LE(eocdOffset - 76) === 0x06064b50)
  ) {
    return {
      defect: {
        code: 'ERR_ARCHIVE_TOO_LARGE',
        severity: 'error',
        location: 'archive',
        message:
          'ZIP64 archives exceeding standard 32-bit limits are not supported.',
      },
    };
  }

  if (centralDirOffset + centralDirSize > buf.length) {
    return {
      defect: {
        code: 'ERR_ARCHIVE_CORRUPTED',
        severity: 'error',
        location: 'archive',
        message: 'Central Directory extends beyond buffer boundary.',
      },
    };
  }

  // Parse Central Directory entries
  const entries = new Map<string, ZipEntry>();
  let cdPos = centralDirOffset;
  const cdEnd = centralDirOffset + centralDirSize;
  let cumulativeUncompressedBytes = 0;
  let totalActualUncompressedBytes = 0;
  let archiveDefect: DeliverableDefect | undefined;

  while (cdPos < cdEnd) {
    if (cdPos + 46 > cdEnd) break;
    const sig = buf.readUInt32LE(cdPos);
    if (sig !== 0x02014b50) break;

    const compressionMethod = buf.readUInt16LE(cdPos + 10);
    const crc32Val = buf.readUInt32LE(cdPos + 16);
    const compressedSize = buf.readUInt32LE(cdPos + 20);
    const uncompressedSize = buf.readUInt32LE(cdPos + 24);
    const fileNameLen = buf.readUInt16LE(cdPos + 28);
    const extraLen = buf.readUInt16LE(cdPos + 30);
    const commentLen = buf.readUInt16LE(cdPos + 32);
    const localHeaderOffset = buf.readUInt32LE(cdPos + 42);

    const nameStart = cdPos + 46;
    const rawFileName = buf
      .subarray(nameStart, nameStart + fileNameLen)
      .toString('utf8');
    const normalizedName = rawFileName.replace(/\\/g, '/').replace(/^\/+/, '');

    cumulativeUncompressedBytes += uncompressedSize;
    if (cumulativeUncompressedBytes > maxUncompressedBytes) {
      return {
        defect: {
          code: 'ERR_ARCHIVE_TOO_LARGE',
          severity: 'error',
          location: normalizedName,
          message: `Cumulative uncompressed archive size exceeded safe limit of ${maxUncompressedBytes} bytes.`,
        },
      };
    }

    entries.set(normalizedName, {
      fileName: normalizedName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      crc32: crc32Val,
    });

    cdPos += 46 + fileNameLen + extraLen + commentLen;
  }

  // Helper for lazy reading of decompressed entries
  const readEntry = (fileName: string): Buffer | null => {
    const norm = fileName.replace(/\\/g, '/').replace(/^\/+/, '');
    const entry = entries.get(norm);
    if (!entry) return null;
    if (entry.data) return entry.data;

    const remainingBudget = maxUncompressedBytes - totalActualUncompressedBytes;
    if (remainingBudget <= 0) {
      archiveDefect = {
        code: 'ERR_ARCHIVE_TOO_LARGE',
        severity: 'error',
        location: norm,
        message: `Cumulative uncompressed archive size exceeded safe limit of ${maxUncompressedBytes} bytes.`,
      };
      return null;
    }

    // Locate data in local file header
    const lOffset = entry.localHeaderOffset;
    if (lOffset + 30 > buf.length) return null;
    if (buf.readUInt32LE(lOffset) !== 0x04034b50) return null;

    const localNameLen = buf.readUInt16LE(lOffset + 26);
    const localExtraLen = buf.readUInt16LE(lOffset + 28);
    const dataStart = lOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;

    if (dataEnd > buf.length) return null;
    const compressedData = buf.subarray(dataStart, dataEnd);

    let decompressed: Buffer;
    try {
      if (entry.compressionMethod === 0) {
        if (compressedData.length > remainingBudget) {
          archiveDefect = {
            code: 'ERR_ARCHIVE_TOO_LARGE',
            severity: 'error',
            location: norm,
            message: `Cumulative uncompressed archive size exceeded safe limit of ${maxUncompressedBytes} bytes.`,
          };
          return null;
        }
        decompressed = Buffer.from(compressedData);
      } else if (entry.compressionMethod === 8) {
        decompressed = zlib.inflateRawSync(compressedData, {
          maxOutputLength: Math.max(1, remainingBudget),
        });
      } else {
        return null;
      }
    } catch (err: any) {
      if (
        err &&
        (err.code === 'ERR_BUFFER_TOO_LARGE' ||
          (err.message && err.message.includes('output length')))
      ) {
        archiveDefect = {
          code: 'ERR_ARCHIVE_TOO_LARGE',
          severity: 'error',
          location: norm,
          message: `Cumulative uncompressed archive size exceeded safe limit of ${maxUncompressedBytes} bytes.`,
        };
      }
      return null;
    }

    totalActualUncompressedBytes += decompressed.length;
    if (totalActualUncompressedBytes > maxUncompressedBytes) {
      archiveDefect = {
        code: 'ERR_ARCHIVE_TOO_LARGE',
        severity: 'error',
        location: norm,
        message: `Cumulative uncompressed archive size exceeded safe limit of ${maxUncompressedBytes} bytes.`,
      };
      return null;
    }

    entry.data = decompressed;
    return decompressed;
  };

  const readEntryText = (fileName: string): string | null => {
    const raw = readEntry(fileName);
    return raw ? raw.toString('utf8') : null;
  };

  return {
    archive: {
      entries,
      readEntry,
      readEntryText,
      get defect() {
        return archiveDefect;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers: XML Entity Decoding, Excel Column Conversion, Placeholders
// ---------------------------------------------------------------------------
export function decodeXmlEntities(str: string): string {
  return str.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|quot|apos|amp);/g,
    (match, entity) => {
      switch (entity) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default: {
          try {
            const code = entity.startsWith('#x')
              ? parseInt(entity.slice(2), 16)
              : parseInt(entity.slice(1), 10);
            if (code === 0) {
              return '';
            }
            if (
              Number.isFinite(code) &&
              code > 0 &&
              code <= 0x10ffff &&
              !(code >= 0xd800 && code <= 0xdfff)
            ) {
              return String.fromCodePoint(code);
            }
          } catch {
            // fallback to original match
          }
          return match;
        }
      }
    }
  );
}

export function colLettersToIndex(letters: string): number {
  let index = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

export function indexToColLetters(index: number): string {
  let col = '';
  let temp = index + 1;
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    temp = Math.floor((temp - 1) / 26);
  }
  return col;
}

const PLACEHOLDER_PATTERNS = [
  /\b(?:TODO|FIXME|TBD|XXX)\b/,
  /\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/,
  /\[INSERT\s+[^\]]+\]/i,
  /<placeholder[^>]*>/i,
];

export function findPlaceholderLeaks(
  text: string,
  location: string
): DeliverableDefect[] {
  const defects: DeliverableDefect[] = [];
  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    for (const pattern of PLACEHOLDER_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        defects.push({
          code: 'PLACEHOLDER_LEAK',
          severity: 'warning',
          location: `${location}:${idx + 1}`,
          message: `Unresolved placeholder leak detected: "${match[0]}"`,
        });
        break; // Report once per line
      }
    }
  }
  return defects;
}

// ---------------------------------------------------------------------------
// Format Inspector: XLSX
// ---------------------------------------------------------------------------
const FORMULA_ERROR_VALUES = new Set([
  '#REF!',
  '#DIV/0!',
  '#VALUE!',
  '#NAME?',
  '#N/A',
  '#N/A!',
  '#NUM!',
  '#NULL!',
]);

export function inspectXlsx(
  archive: ZipArchive,
  options: DeliverableInspectorOptions
): DeliverableInspectionResult {
  const defects: DeliverableDefect[] = [];
  const stats: Record<string, unknown> = {
    sheets: 0,
    cells: 0,
    uncachedFormulas: 0,
    formulaErrors: 0,
  };

  // 1. Parse xl/_rels/workbook.xml.rels
  const relsText = archive.readEntryText('xl/_rels/workbook.xml.rels') || '';
  const relMap = new Map<string, string>();
  const relMatches = relsText.matchAll(/<Relationship\s+([^>]+?)\/?>/g);
  for (const match of relMatches) {
    const attrs = match[1];
    const idMatch = attrs.match(/\bId="([^"]+)"/);
    const targetMatch = attrs.match(/\bTarget="([^"]+)"/);
    if (idMatch && targetMatch) {
      const id = idMatch[1];
      const target = targetMatch[1];
      // Normalize openpyxl (/xl/worksheets/sheet1.xml) vs Excel (worksheets/sheet1.xml)
      const cleanTarget = target.replace(/^\/+/, '').replace(/^\.\//, '');
      const normalizedTarget = cleanTarget.startsWith('xl/')
        ? cleanTarget
        : 'xl/' + cleanTarget;
      relMap.set(id, normalizedTarget);
    }
  }

  // 2. Parse xl/workbook.xml for sheets
  const wbText = archive.readEntryText('xl/workbook.xml') || '';
  const sheetList: Array<{ name: string; path: string }> = [];
  const sheetMatches = wbText.matchAll(/<sheet\s+([^>]+?)\/?>/g);
  for (const match of sheetMatches) {
    const attrs = match[1];
    const nameMatch = attrs.match(/\bname="([^"]+)"/);
    const rIdMatch = attrs.match(/\b(?:r:id|id)="([^"]+)"/);
    if (nameMatch && rIdMatch) {
      const name = decodeXmlEntities(nameMatch[1]);
      const rId = rIdMatch[1];
      const targetPath = relMap.get(rId);
      if (targetPath) {
        sheetList.push({ name, path: targetPath });
      }
    }
  }
  stats.sheets = sheetList.length;

  if (!wbText || sheetList.length === 0) {
    if (archive.defect) {
      defects.push(archive.defect);
    } else {
      defects.push({
        code: 'ERR_ARCHIVE_CORRUPTED',
        severity: 'error',
        location: 'xl/workbook.xml',
        message: 'Missing or empty xl/workbook.xml in XLSX archive.',
      });
    }
    return {
      ok: false,
      format: 'xlsx',
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  // 3. Parse xl/sharedStrings.xml
  const sharedStrings: string[] = [];
  const sstText = archive.readEntryText('xl/sharedStrings.xml');
  if (sstText) {
    const siMatches = sstText.matchAll(/<si\b([^>]*?)(?:\/>|>([\s\S]*?)<\/si>)/g);
    for (const siMatch of siMatches) {
      if (!siMatch[2]) {
        sharedStrings.push('');
        continue;
      }
      const siContent = siMatch[2];
      // Strip phonetic runs <rPh...>...</rPh> or <rPh.../> BEFORE concatenating <t>
      const cleanSi = siContent.replace(
        /<rPh\b[^>]*\/>|<rPh\b[^>]*>[\s\S]*?<\/rPh>/g,
        ''
      );
      const tMatches = cleanSi.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g);
      let text = '';
      for (const tm of tMatches) {
        text += tm[1];
      }
      sharedStrings.push(decodeXmlEntities(text));
    }
  }

  // 4. Inspect each worksheet
  const canonicalParts: string[] = [];
  const sheetNamesInWb = sheetList.map((s) => s.name);

  // Check expectedShape sheet presence
  if (options.expectedShape?.sheets) {
    for (const reqSheet of options.expectedShape.sheets) {
      if (!sheetNamesInWb.includes(reqSheet)) {
        defects.push({
          code: 'SHAPE_CONFORMANCE_DEVIATION',
          severity: 'error',
          location: reqSheet,
          message: `Expected sheet "${reqSheet}" is missing from workbook.`,
        });
      }
    }
    if (options.expectedShape.strictColumns) {
      for (const actSheet of sheetNamesInWb) {
        if (!options.expectedShape.sheets.includes(actSheet)) {
          defects.push({
            code: 'SHAPE_CONFORMANCE_DEVIATION',
            severity: 'error',
            location: actSheet,
            message: `Unexpected sheet "${actSheet}" present in workbook.`,
          });
        }
      }
    }
  }

  let totalCellsCount = 0;
  for (const sheet of sheetList) {
    const sheetXml = archive.readEntryText(sheet.path) || '';
    const sheetRows: string[][] = [];
    let sheetCellCount = 0;

    // Match each <row>
    const rowMatches = sheetXml.matchAll(
      /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
    );
    for (const rowMatch of rowMatches) {
      const rowContent = rowMatch[2] || '';
      const rowCells: string[] = [];
      let maxCol = -1;

      // Match each <c>
      const cellMatches = rowContent.matchAll(
        /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
      );
      for (const cellMatch of cellMatches) {
        const attrs = cellMatch[1];
        const inner = cellMatch[2] || '';

        const rMatch = attrs.match(/\br="([A-Za-z]+)(\d+)"/);
        const tMatch = attrs.match(/\bt="([^"]+)"/);
        const cellType = tMatch ? tMatch[1] : '';
        const cellRef = rMatch ? `${rMatch[1]}${rMatch[2]}` : '';
        const colLetters = rMatch ? rMatch[1] : '';
        const colIdx = colLetters ? colLettersToIndex(colLetters) : rowCells.length;

        if (colIdx > 16383) {
          defects.push({
            code: 'INVALID_CELL_COORDINATE',
            severity: 'error',
            location: `${sheet.name}!${cellRef || attrs}`,
            message: `Cell column index ${colIdx} exceeds Excel maximum limit of 16383 (XFD).`,
          });
          continue;
        }

        // Check for formula: <f...>...</f> or self-closing <f.../>
        const hasFormula =
          /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.test(inner) ||
          /<f\b[^>]*\/>/.test(inner);

        // Check for value: <v>...</v> or inline string <is>...</is>
        const vMatch = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        const isBlockMatch = inner.match(/<is>([\s\S]*?)<\/is>/);
        let inlineText: string | null = null;
        if (isBlockMatch) {
          const cleanIs = isBlockMatch[1].replace(
            /<rPh\b[^>]*\/>|<rPh\b[^>]*>[\s\S]*?<\/rPh>/g,
            ''
          );
          const tMatches = cleanIs.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g);
          let acc = '';
          for (const tm of tMatches) {
            acc += tm[1];
          }
          inlineText = decodeXmlEntities(acc);
        }

        let cellVal = '';
        if (vMatch && vMatch[1].trim().length > 0) {
          const rawV = vMatch[1].trim();
          if (cellType === 's') {
            const idx = parseInt(rawV, 10);
            cellVal = sharedStrings[idx] ?? '';
          } else if (cellType === 'b') {
            cellVal = rawV === '1' ? 'TRUE' : 'FALSE';
          } else if (cellType === 'str') {
            cellVal = decodeXmlEntities(rawV);
          } else {
            cellVal = rawV;
          }
        } else if (inlineText !== null) {
          cellVal = inlineText;
        }

        // Uncached formula detection
        if (hasFormula && (!vMatch || vMatch[1].trim().length === 0) && inlineText === null) {
          stats.uncachedFormulas = ((stats.uncachedFormulas as number) || 0) + 1;
          defects.push({
            code: 'UNCACHED_FORMULA',
            severity: 'error',
            location: `${sheet.name}!${cellRef}`,
            message: `Uncached formula in cell ${sheet.name}!${cellRef} (no precomputed cached value found).`,
          });
          cellVal = ''; // Canonical view renders blank
        }

        // Formula error detection
        if (cellType === 'e' || FORMULA_ERROR_VALUES.has(cellVal)) {
          stats.formulaErrors = ((stats.formulaErrors as number) || 0) + 1;
          defects.push({
            code: 'FORMULA_ERROR',
            severity: 'error',
            location: `${sheet.name}!${cellRef}`,
            message: `Excel formula error "${cellVal || '#ERROR!'}" in cell ${sheet.name}!${cellRef}.`,
          });
        }

        // Place cell value at sparse colIdx
        while (rowCells.length < colIdx) {
          rowCells.push('');
        }
        rowCells[colIdx] = cellVal;
        if (colIdx > maxCol) maxCol = colIdx;
        sheetCellCount++;
      }

      sheetRows.push(rowCells);
    }

    totalCellsCount += sheetCellCount;
    const hasAnyContent = sheetRows.some((r) => r.some((c) => c.trim().length > 0));
    if (sheetCellCount === 0 || !hasAnyContent) {
      defects.push({
        code: 'EMPTY_SHEET',
        severity: 'error',
        location: sheet.name,
        message: `Worksheet "${sheet.name}" is completely empty.`,
      });
    }

    // Header shape validation
    if (options.expectedShape?.headers) {
      const headersMap = options.expectedShape.headers;
      const expectedCols = Array.isArray(headersMap)
        ? headersMap
        : headersMap[sheet.name];
      if (expectedCols && expectedCols.length > 0) {
        const actualHeaders = sheetRows[0] || [];
        for (const reqCol of expectedCols) {
          if (!actualHeaders.includes(reqCol)) {
            defects.push({
              code: 'SHAPE_CONFORMANCE_DEVIATION',
              severity: 'error',
              location: `${sheet.name}!Headers`,
              message: `Missing required header column "${reqCol}" in sheet "${sheet.name}".`,
            });
          }
        }
        // Extra column check
        if (options.expectedShape.strictColumns) {
          for (const actCol of actualHeaders) {
            if (actCol && !expectedCols.includes(actCol)) {
              defects.push({
                code: 'SHAPE_CONFORMANCE_DEVIATION',
                severity: 'error',
                location: `${sheet.name}!Headers`,
                message: `Unexpected extra header column "${actCol}" in sheet "${sheet.name}".`,
              });
            }
          }
        }
      }
    }

    // Render canonical sheet TSV
    canonicalParts.push(`## Sheet: ${sheet.name}`);
    for (const r of sheetRows) {
      canonicalParts.push(r.join('\t'));
    }
  }

  stats.cells = totalCellsCount;
  const canonicalText = canonicalParts.join('\n');

  // Check placeholder leaks
  if (options.checkPlaceholders !== false) {
    defects.push(...findPlaceholderLeaks(canonicalText, options.filePath || 'xlsx'));
  }

  if (archive.defect && !defects.includes(archive.defect)) {
    defects.unshift(archive.defect);
  }

  const ok = defects.filter((d) => d.severity === 'error').length === 0;
  return {
    ok,
    format: 'xlsx',
    filePath: options.filePath,
    canonicalText,
    defects,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Format Inspector: DOCX
// ---------------------------------------------------------------------------
export function inspectDocx(
  archive: ZipArchive,
  options: DeliverableInspectorOptions
): DeliverableInspectionResult {
  const defects: DeliverableDefect[] = [];
  const stats: Record<string, unknown> = { paragraphs: 0, tables: 0 };

  const docXml = archive.readEntryText('word/document.xml');
  if (!docXml) {
    if (archive.defect) {
      defects.push(archive.defect);
    } else {
      defects.push({
        code: 'ERR_ARCHIVE_CORRUPTED',
        severity: 'error',
        location: 'word/document.xml',
        message: 'Missing word/document.xml in DOCX archive.',
      });
    }
    return {
      ok: false,
      format: 'docx',
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  const canonicalParts: string[] = [];
  // Parse paragraphs and tables in sequence
  const blockMatches = docXml.matchAll(
    /<w:(p|tbl)(?:\s+[^>]*)?>([\s\S]*?)<\/w:\1>/g
  );

  for (const block of blockMatches) {
    const tag = block[1];
    const content = block[2];

    if (tag === 'p') {
      stats.paragraphs = ((stats.paragraphs as number) || 0) + 1;
      // Heading check
      let headingPrefix = '';
      const styleMatch = content.match(
        /<w:pStyle\s+[^>]*?w:val=["'](?:Heading\s*(\d+)|heading\s*(\d+)|Title)["']/i
      );
      if (styleMatch) {
        const level = styleMatch[1] || styleMatch[2]
          ? Math.min(6, Math.max(1, parseInt(styleMatch[1] || styleMatch[2], 10)))
          : 1;
        headingPrefix = '#'.repeat(level) + ' ';
      }

      // Runs
      let pText = '';
      const runMatches = content.matchAll(/<w:r(?:\s+[^>]*)?>([\s\S]*?)<\/w:r>/g);
      for (const run of runMatches) {
        const runContent = run[1];
        const innerMatches = runContent.matchAll(
          /<w:(t|tab|br)(?:\s+[^>]*)?>([\s\S]*?)<\/w:\1>|<w:(tab|br)\/>/g
        );
        for (const im of innerMatches) {
          const innerTag = im[1] || im[3];
          if (innerTag === 't') {
            pText += decodeXmlEntities(im[2] || '');
          } else if (innerTag === 'tab') {
            pText += '\t';
          } else if (innerTag === 'br') {
            pText += '\n';
          }
        }
      }

      if (pText.trim().length > 0) {
        canonicalParts.push(headingPrefix + pText.trim());
      }
    } else if (tag === 'tbl') {
      stats.tables = ((stats.tables as number) || 0) + 1;
      const rowMatches = content.matchAll(
        /<w:tr(?:\s+[^>]*)?>([\s\S]*?)<\/w:tr>/g
      );
      for (const rm of rowMatches) {
        const rowContent = rm[1];
        const cellParts: string[] = [];
        const cellMatches = rowContent.matchAll(
          /<w:tc(?:\s+[^>]*)?>([\s\S]*?)<\/w:tc>/g
        );
        for (const cm of cellMatches) {
          const tMatches = cm[1].matchAll(
            /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g
          );
          let cellText = '';
          for (const tm of tMatches) {
            cellText += decodeXmlEntities(tm[1]);
          }
          cellParts.push(cellText.trim());
        }
        if (cellParts.length > 0) {
          canonicalParts.push('| ' + cellParts.join(' | ') + ' |');
        }
      }
    }
  }

  const canonicalText = canonicalParts.join('\n\n');
  if (canonicalText.trim().length === 0) {
    defects.push({
      code: 'EMPTY_DOCUMENT',
      severity: 'error',
      location: options.filePath || 'document',
      message: 'Word document (.docx) contains no readable text or content.',
    });
  }

  // Check expected headings
  if (options.expectedShape?.headings) {
    for (const h of options.expectedShape.headings) {
      if (!canonicalText.toLowerCase().includes(h.toLowerCase())) {
        defects.push({
          code: 'SHAPE_CONFORMANCE_DEVIATION',
          severity: 'error',
          location: 'headings',
          message: `Expected heading "${h}" was not found in document.`,
        });
      }
    }
  }

  // Placeholder check
  if (options.checkPlaceholders !== false) {
    defects.push(...findPlaceholderLeaks(canonicalText, options.filePath || 'docx'));
  }

  if (archive.defect && !defects.includes(archive.defect)) {
    defects.unshift(archive.defect);
  }

  const ok = defects.filter((d) => d.severity === 'error').length === 0;
  return {
    ok,
    format: 'docx',
    filePath: options.filePath,
    canonicalText,
    defects,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Format Inspector: PPTX
// ---------------------------------------------------------------------------
export function inspectPptx(
  archive: ZipArchive,
  options: DeliverableInspectorOptions
): DeliverableInspectionResult {
  const defects: DeliverableDefect[] = [];
  const stats: Record<string, unknown> = { slides: 0, emptySlides: 0 };

  const slideEntries: Array<{ num: number; path: string }> = [];
  for (const name of archive.entries?.keys() || []) {
    const match = name.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
    if (match) {
      slideEntries.push({ num: parseInt(match[1], 10), path: name });
    }
  }
  slideEntries.sort((a, b) => a.num - b.num);
  stats.slides = slideEntries.length;

  if (slideEntries.length === 0) {
    if (archive.defect) {
      defects.push(archive.defect);
    } else {
      defects.push({
        code: 'EMPTY_PRESENTATION',
        severity: 'error',
        location: options.filePath || 'pptx',
        message: 'Presentation (.pptx) contains no slides.',
      });
    }
    return {
      ok: false,
      format: 'pptx',
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  const canonicalParts: string[] = [];
  let nonEmptySlides = 0;

  for (const slide of slideEntries) {
    const slideXml = archive.readEntryText(slide.path) || '';
    const pMatches = Array.from(
      slideXml.matchAll(/<a:p(?:\s+[^>]*)?>([\s\S]*?)<\/a:p>/g)
    );
    const slideTexts: string[] = [];
    if (pMatches.length > 0) {
      for (const pm of pMatches) {
        const tMatches = pm[1].matchAll(/<a:t(?:\s+[^>]*)?>([\s\S]*?)<\/a:t>/g);
        let pText = '';
        for (const tm of tMatches) {
          pText += decodeXmlEntities(tm[1]);
        }
        if (pText.trim().length > 0) {
          slideTexts.push(pText.trim());
        }
      }
    } else {
      const textMatches = slideXml.matchAll(
        /<a:t(?:\s+[^>]*)?>([\s\S]*?)<\/a:t>/g
      );
      for (const tm of textMatches) {
        const decoded = decodeXmlEntities(tm[1]).trim();
        if (decoded.length > 0) {
          slideTexts.push(decoded);
        }
      }
    }

    const slideContent = slideTexts.join('\n');
    if (slideContent.trim().length === 0) {
      stats.emptySlides = ((stats.emptySlides as number) || 0) + 1;
      defects.push({
        code: 'EMPTY_SLIDE',
        severity: 'warning',
        location: `Slide ${slide.num}`,
        message: `Slide ${slide.num} contains no readable text.`,
      });
    } else {
      nonEmptySlides++;
    }

    canonicalParts.push(`## Slide ${slide.num}\n${slideContent}`);
  }

  if (nonEmptySlides === 0) {
    if (archive.defect) {
      if (!defects.includes(archive.defect)) {
        defects.push(archive.defect);
      }
    } else {
      defects.push({
        code: 'EMPTY_PRESENTATION',
        severity: 'error',
        location: options.filePath || 'pptx',
        message: 'All slides in presentation (.pptx) are empty.',
      });
    }
  }

  const canonicalText = canonicalParts.join('\n\n');

  // Placeholder check
  if (options.checkPlaceholders !== false) {
    defects.push(...findPlaceholderLeaks(canonicalText, options.filePath || 'pptx'));
  }

  if (archive.defect && !defects.includes(archive.defect)) {
    defects.unshift(archive.defect);
  }

  const ok = defects.filter((d) => d.severity === 'error').length === 0;
  return {
    ok,
    format: 'pptx',
    filePath: options.filePath,
    canonicalText,
    defects,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Format Inspector: CSV / TSV
// ---------------------------------------------------------------------------
export function parseDelimited(
  text: string,
  delimiter: string
): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export function inspectDelimited(
  content: string,
  delimiter: string,
  format: 'csv' | 'tsv',
  options: DeliverableInspectorOptions
): DeliverableInspectionResult {
  const defects: DeliverableDefect[] = [];
  const stats: Record<string, unknown> = { rows: 0, cols: 0 };

  if (content.trim().length === 0) {
    defects.push({
      code: 'EMPTY_TABLE',
      severity: 'error',
      location: options.filePath || format,
      message: `Delimited file (.${format}) is empty.`,
    });
    return {
      ok: false,
      format,
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  const rows = parseDelimited(content, delimiter);
  // Filter trailing completely empty rows
  while (
    rows.length > 0 &&
    rows[rows.length - 1].every((c) => c.trim().length === 0)
  ) {
    rows.pop();
  }

  stats.rows = rows.length;
  if (rows.length === 0) {
    defects.push({
      code: 'EMPTY_TABLE',
      severity: 'error',
      location: options.filePath || format,
      message: `Delimited file (.${format}) contains no rows.`,
    });
    return {
      ok: false,
      format,
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  const headerRow = rows[0];
  const expectedCols = headerRow.length;
  stats.cols = expectedCols;

  // Ragged column check
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length !== expectedCols) {
      defects.push({
        code: 'RAGGED_COLUMNS',
        severity: 'error',
        location: `Row ${r + 1}`,
        message: `Row ${r + 1} has ${rows[r].length} columns, expected header count of ${expectedCols}.`,
      });
    }
  }

  // Header conformance check
  if (options.expectedShape?.headers) {
    const headersMap = options.expectedShape.headers;
    const reqHeaders: string[] = Array.isArray(headersMap)
      ? headersMap
      : headersMap.default || headersMap[format] || Object.values(headersMap)[0] || [];

    if (reqHeaders.length > 0) {
      for (const reqCol of reqHeaders) {
        if (!headerRow.includes(reqCol)) {
          defects.push({
            code: 'SHAPE_CONFORMANCE_DEVIATION',
            severity: 'error',
            location: 'Headers',
            message: `Missing required header column "${reqCol}".`,
          });
        }
      }
      if (options.expectedShape.strictColumns) {
        for (const actCol of headerRow) {
          if (actCol && !reqHeaders.includes(actCol)) {
            defects.push({
              code: 'SHAPE_CONFORMANCE_DEVIATION',
              severity: 'error',
              location: 'Headers',
              message: `Unexpected extra header column "${actCol}".`,
            });
          }
        }
      }
    }
  }

  // Canonical TSV text
  const canonicalText = rows.map((r) => r.join('\t')).join('\n');

  // Placeholder check
  if (options.checkPlaceholders !== false) {
    defects.push(...findPlaceholderLeaks(canonicalText, options.filePath || format));
  }

  const ok = defects.filter((d) => d.severity === 'error').length === 0;
  return {
    ok,
    format,
    filePath: options.filePath,
    canonicalText,
    defects,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Format Inspector: JSON / JSONL
// ---------------------------------------------------------------------------
export function inspectJson(
  content: string,
  options: DeliverableInspectorOptions
): DeliverableInspectionResult {
  const defects: DeliverableDefect[] = [];
  const stats: Record<string, unknown> = { keys: 0 };

  if (content.trim().length === 0) {
    defects.push({
      code: 'INVALID_JSON',
      severity: 'error',
      location: options.filePath || 'json',
      message: 'JSON document is empty.',
    });
    return {
      ok: false,
      format: 'json',
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    defects.push({
      code: 'INVALID_JSON',
      severity: 'error',
      location: options.filePath || 'json',
      message: `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      ok: false,
      format: 'json',
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  const canonicalText = JSON.stringify(parsed, null, 2);

  // Shape conformance (requiredKeys, strictKeys)
  if (
    options.expectedShape &&
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed)
  ) {
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);
    stats.keys = keys.length;

    if (options.expectedShape.requiredKeys) {
      for (const reqKey of options.expectedShape.requiredKeys) {
        if (!(reqKey in obj)) {
          defects.push({
            code: 'SHAPE_CONFORMANCE_DEVIATION',
            severity: 'error',
            location: reqKey,
            message: `Required top-level key "${reqKey}" is missing.`,
          });
        }
      }
    }

    if (options.expectedShape.strictKeys && options.expectedShape.requiredKeys) {
      for (const k of keys) {
        if (!options.expectedShape.requiredKeys.includes(k)) {
          defects.push({
            code: 'SHAPE_CONFORMANCE_DEVIATION',
            severity: 'error',
            location: k,
            message: `Unexpected extra key "${k}" in JSON document.`,
          });
        }
      }
    }
  }

  // Placeholder check
  if (options.checkPlaceholders !== false) {
    defects.push(...findPlaceholderLeaks(canonicalText, options.filePath || 'json'));
  }

  const ok = defects.filter((d) => d.severity === 'error').length === 0;
  return {
    ok,
    format: 'json',
    filePath: options.filePath,
    canonicalText,
    defects,
    stats,
  };
}

export function inspectJsonl(
  content: string,
  options: DeliverableInspectorOptions
): DeliverableInspectionResult {
  const defects: DeliverableDefect[] = [];
  const stats: Record<string, unknown> = { lines: 0 };

  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  stats.lines = lines.length;

  if (lines.length === 0) {
    defects.push({
      code: 'EMPTY_DOCUMENT',
      severity: 'error',
      location: options.filePath || 'jsonl',
      message: 'JSONL document is empty.',
    });
    return {
      ok: false,
      format: 'jsonl',
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  const canonicalLines: string[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[idx]);
      canonicalLines.push(JSON.stringify(parsed));
    } catch (err) {
      defects.push({
        code: 'INVALID_JSON',
        severity: 'error',
        location: `Line ${lineNum}`,
        message: `Invalid JSON on line ${lineNum}: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      const obj = parsed as Record<string, unknown>;
      if (options.expectedShape?.requiredKeys) {
        for (const reqKey of options.expectedShape.requiredKeys) {
          if (!(reqKey in obj)) {
            defects.push({
              code: 'SHAPE_CONFORMANCE_DEVIATION',
              severity: 'error',
              location: `Line ${lineNum}:${reqKey}`,
              message: `Required key "${reqKey}" is missing on line ${lineNum}.`,
            });
          }
        }
      }
      if (options.expectedShape?.strictKeys) {
        const reqKeys = options.expectedShape.requiredKeys || [];
        for (const k of Object.keys(obj)) {
          if (!reqKeys.includes(k)) {
            defects.push({
              code: 'SHAPE_CONFORMANCE_DEVIATION',
              severity: 'error',
              location: `Line ${lineNum}:${k}`,
              message: `Unexpected extra key "${k}" on line ${lineNum}.`,
            });
          }
        }
      }
    }
  }

  const canonicalText = canonicalLines.join('\n');

  // Placeholder check
  if (options.checkPlaceholders !== false) {
    defects.push(...findPlaceholderLeaks(canonicalText, options.filePath || 'jsonl'));
  }

  const ok = defects.filter((d) => d.severity === 'error').length === 0;
  return {
    ok,
    format: 'jsonl',
    filePath: options.filePath,
    canonicalText,
    defects,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Format Inspector: Markdown / Plain Text
// ---------------------------------------------------------------------------
export function inspectMarkdown(
  content: string,
  options: DeliverableInspectorOptions
): DeliverableInspectionResult {
  const defects: DeliverableDefect[] = [];
  const stats: Record<string, unknown> = { lines: 0 };

  if (content.trim().length === 0) {
    defects.push({
      code: 'EMPTY_DOCUMENT',
      severity: 'error',
      location: options.filePath || 'md',
      message: 'Document is empty.',
    });
    return {
      ok: false,
      format: 'md',
      filePath: options.filePath,
      canonicalText: '',
      defects,
      stats,
    };
  }

  const lines = content.split(/\r?\n/);
  stats.lines = lines.length;

  // Track fenced code blocks and detect unclosed fences
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let fenceStartLine = 0;
  const nonCodeLines: Array<{ text: string; lineNum: number }> = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!inFence) {
      const fenceMatch = line.match(/^\s*(```+|~~~+)/);
      if (fenceMatch) {
        inFence = true;
        fenceChar = fenceMatch[1][0];
        fenceLen = fenceMatch[1].length;
        fenceStartLine = idx + 1;
      } else {
        nonCodeLines.push({ text: line, lineNum: idx + 1 });
      }
    } else {
      const closeMatch = line.match(/^\s*(```+|~~~+)\s*$/);
      if (closeMatch) {
        const char = closeMatch[1][0];
        const len = closeMatch[1].length;
        if (char === fenceChar && len >= fenceLen) {
          inFence = false;
        }
      }
    }
  }

  if (inFence) {
    defects.push({
      code: 'UNCLOSED_CODE_FENCE',
      severity: 'error',
      location: `Line ${fenceStartLine}`,
      message: `Unclosed code fence starting at line ${fenceStartLine}.`,
    });
  }

  // Check expected headings
  if (options.expectedShape?.headings) {
    for (const h of options.expectedShape.headings) {
      if (!content.toLowerCase().includes(h.toLowerCase())) {
        defects.push({
          code: 'SHAPE_CONFORMANCE_DEVIATION',
          severity: 'error',
          location: 'headings',
          message: `Expected heading "${h}" was not found in document.`,
        });
      }
    }
  }

  // Placeholder check (ONLY outside code fences)
  if (options.checkPlaceholders !== false) {
    for (const item of nonCodeLines) {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        const match = item.text.match(pattern);
        if (match) {
          defects.push({
            code: 'PLACEHOLDER_LEAK',
            severity: 'warning',
            location: `${options.filePath || 'md'}:${item.lineNum}`,
            message: `Unresolved placeholder leak detected: "${match[0]}"`,
          });
          break;
        }
      }
    }
  }

  const ok = defects.filter((d) => d.severity === 'error').length === 0;
  return {
    ok,
    format: 'md',
    filePath: options.filePath,
    canonicalText: content,
    defects,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Main Inspectors: inspectDeliverableBuffer & inspectDeliverable
// ---------------------------------------------------------------------------
export function inspectDeliverableBuffer(
  buf: Buffer,
  options: DeliverableInspectorOptions = {}
): DeliverableInspectionResult {
  // 1. Check legacy OLE2
  if (isOle2CompoundDocument(buf)) {
    return {
      ok: false,
      format: 'ole2',
      filePath: options.filePath,
      canonicalText: '',
      defects: [
        {
          code: 'UNSUPPORTED_LEGACY_OLE2',
          severity: 'error',
          location: options.filePath || 'archive',
          message:
            'Legacy binary OLE2 Compound Document format (.xls/.doc/.ppt) is unsupported. Please convert or re-save as modern OOXML (.xlsx/.docx/.pptx) or export as plain text/CSV.',
        },
      ],
      stats: { legacy_ole2: true },
    };
  }

  // 2. Resolve format from extension or options
  let format = options.format;
  if (!format && options.filePath) {
    const ext = path.extname(options.filePath).toLowerCase().replace(/^\./, '');
    if (ext === 'xls' || ext === 'doc' || ext === 'ppt') {
      return {
        ok: false,
        format: 'ole2',
        filePath: options.filePath,
        canonicalText: '',
        defects: [
          {
            code: 'UNSUPPORTED_LEGACY_OLE2',
            severity: 'error',
            location: options.filePath,
            message:
              'Legacy binary OLE2 Compound Document format (.xls/.doc/.ppt) is unsupported. Please convert or re-save as modern OOXML (.xlsx/.docx/.pptx) or export as plain text/CSV.',
          },
        ],
        stats: { legacy_ole2: true },
      };
    }
    format = ext;
  }

  // 3. Check if buffer is a ZIP archive
  const isZip =
    buf.length >= 4 &&
    (buf.readUInt32LE(0) === 0x04034b50 ||
      buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])));

  try {
    if (isZip || format === 'xlsx' || format === 'docx' || format === 'pptx') {
      const zipRes = readZipEntries(buf, options.maxUncompressedBytes);
      if (zipRes.defect) {
        return {
          ok: false,
          format: format || 'zip',
          filePath: options.filePath,
          canonicalText: '',
          defects: [zipRes.defect],
          stats: {},
        };
      }

      const archive = zipRes.archive!;
      if (format === 'xlsx' || archive.entries.has('xl/workbook.xml')) {
        return inspectXlsx(archive, options);
      }
      if (format === 'docx' || archive.entries.has('word/document.xml')) {
        return inspectDocx(archive, options);
      }
      if (
        format === 'pptx' ||
        archive.entries.has('ppt/presentation.xml') ||
        Array.from(archive.entries.keys()).some((k) =>
          k.startsWith('ppt/slides/')
        )
      ) {
        return inspectPptx(archive, options);
      }
    }

    // 4. Text-based formats
    const textContent = buf.toString('utf8');
    if (format === 'csv') {
      return inspectDelimited(textContent, ',', 'csv', options);
    }
    if (format === 'tsv') {
      return inspectDelimited(textContent, '\t', 'tsv', options);
    }
    if (format === 'json') {
      return inspectJson(textContent, options);
    }
    if (format === 'jsonl') {
      return inspectJsonl(textContent, options);
    }
    if (format === 'md' || format === 'txt') {
      return inspectMarkdown(textContent, options);
    }

    // Auto-detect text format
    const trimmed = textContent.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return inspectJson(textContent, options);
      } catch {
        // ignore
      }
    }

    return inspectMarkdown(textContent, options);
  } catch (err) {
    return {
      ok: false,
      format: format || 'unknown',
      filePath: options.filePath,
      canonicalText: '',
      defects: [
        {
          code: 'ERR_ARCHIVE_CORRUPTED',
          severity: 'error',
          location: options.filePath || 'archive',
          message: `Failed to inspect deliverable: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      stats: {},
    };
  }
}

export function inspectDeliverable(
  filePath: string,
  options: DeliverableInspectorOptions = {}
): DeliverableInspectionResult {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.env.EVO_WORKSPACE || process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      format: 'unknown',
      filePath,
      canonicalText: '',
      defects: [
        {
          code: 'ERR_FILE_NOT_FOUND',
          severity: 'error',
          location: filePath,
          message: `Target deliverable file "${filePath}" does not exist.`,
        },
      ],
      stats: {},
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (err: any) {
    return {
      ok: false,
      format: 'unknown',
      filePath,
      canonicalText: '',
      defects: [
        {
          code: 'ERR_FILE_NOT_FOUND',
          severity: 'error',
          location: filePath,
          message: `Cannot access target deliverable "${filePath}": ${err?.message || String(err)}`,
        },
      ],
      stats: {},
    };
  }

  if (stat.isDirectory()) {
    return {
      ok: false,
      format: 'unknown',
      filePath,
      canonicalText: '',
      defects: [
        {
          code: 'ERR_IS_DIRECTORY',
          severity: 'error',
          location: filePath,
          message: `Target deliverable path "${filePath}" is a directory, expected a file.`,
        },
      ],
      stats: {},
    };
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(resolvedPath);
  } catch (err: any) {
    return {
      ok: false,
      format: 'unknown',
      filePath,
      canonicalText: '',
      defects: [
        {
          code: err?.code === 'EISDIR' ? 'ERR_IS_DIRECTORY' : 'ERR_FILE_READ_FAILED',
          severity: 'error',
          location: filePath,
          message: `Failed to read target deliverable file "${filePath}": ${err?.message || String(err)}`,
        },
      ],
      stats: {},
    };
  }

  return inspectDeliverableBuffer(buf, { ...options, filePath });
}

export const inspectDeliverableFile = inspectDeliverable;

// ---------------------------------------------------------------------------
// Pure In-Memory Self-Test Runner
// ---------------------------------------------------------------------------
export function runDeliverableInspectorSelfTest(): {
  passed: boolean;
  diagnostics: Record<string, unknown>;
} {
  // Synthesize in RAM (ZERO temp files on disk!) a bit-3 .xlsx with:
  // - /xl/worksheets/sheet1.xml in rels (leading slash)
  // - <rPh> phonetic text inside xl/sharedStrings.xml
  // - Sparse cell D2 in sheet1.xml
  // - Uncached shared formula <f t="shared" si="0"/> in sheet1.xml
  // - Extra unrequested header column in sheet1.xml with strictColumns: true
  const relsContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const wbContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const sstContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
  <si><t>HeaderA</t></si>
  <si><t>HeaderB</t></si>
  <si><t>HeaderC</t></si>
  <si><t>ExtraCol</t></si>
  <si><t>東京</t><rPh sb="0" eb="2"><t>とうきょう</t></rPh></si>
  <si><rPh sb="0" eb="0"/><t>Preserved</t><rPh sb="0" eb="1"><t>カナ</t></rPh></si>
</sst>`;

  const sheet1Content = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
      <c r="D1" t="s"><v>3</v></c>
    </row>
    <row r="2">
      <c r="B2"><f t="shared" si="0"/></c>
      <c r="C2" t="s"><v>4</v></c>
      <c r="D2" t="s"><v>5</v></c>
    </row>
  </sheetData>
</worksheet>`;

  // Build in-memory bit-3 ZIP
  const zipBuf = buildInMemoryZip([
    { name: 'xl/_rels/workbook.xml.rels', content: relsContent, useBit3Descriptor: true },
    { name: 'xl/workbook.xml', content: wbContent, useBit3Descriptor: true },
    { name: 'xl/sharedStrings.xml', content: sstContent, useBit3Descriptor: true },
    { name: 'xl/worksheets/sheet1.xml', content: sheet1Content, useBit3Descriptor: true },
  ]);

  const result = inspectDeliverableBuffer(zipBuf, {
    filePath: 'memory-test.xlsx',
    expectedShape: {
      sheets: ['Sheet1'],
      headers: {
        Sheet1: ['HeaderA', 'HeaderB', 'HeaderC'],
      },
      strictColumns: true,
    },
    checkPlaceholders: true,
  });

  const uncachedDefect = result.defects.find((d) => d.code === 'UNCACHED_FORMULA');
  const shapeDefect = result.defects.find((d) => d.code === 'SHAPE_CONFORMANCE_DEVIATION');

  if (!uncachedDefect) {
    throw new Error('Self-test failure: UNCACHED_FORMULA defect was not flagged.');
  }
  if (!shapeDefect) {
    throw new Error('Self-test failure: SHAPE_CONFORMANCE_DEVIATION defect was not flagged.');
  }
  if (!result.canonicalText.includes('東京')) {
    throw new Error('Self-test failure: Phonetic text was not stripped cleanly to "東京".');
  }
  if (!result.canonicalText.includes('Preserved')) {
    throw new Error('Self-test failure: Cell text "Preserved" following self-closing rPh was lost.');
  }
  if (result.canonicalText.includes('とうきょう')) {
    throw new Error('Self-test failure: <rPh> phonetic text leaked into canonicalText.');
  }
  if (result.canonicalText.includes('カナ')) {
    throw new Error('Self-test failure: <rPh> phonetic text "カナ" leaked into canonicalText.');
  }

  // Verify sparse cell D2 preserves exact empty tab-separated slots
  const lines = result.canonicalText.split('\n');
  const row2 = lines.find((l) => l.includes('Preserved'));
  if (!row2) {
    throw new Error('Self-test failure: Row 2 with sparse cell D2 not found.');
  }
  const cells = row2.split('\t');
  // Expected row2: col 0 = '', col 1 = '' (uncached formula renders blank), col 2 = '東京', col 3 = 'Preserved'
  if (cells.length < 4 || cells[3] !== 'Preserved' || cells[2] !== '東京') {
    throw new Error(`Self-test failure: Sparse column D2 was not rendered at column index 3. Got: ${JSON.stringify(cells)}`);
  }

  return {
    passed: true,
    diagnostics: {
      format: result.format,
      defectsCount: result.defects.length,
      uncachedFormulaLocation: uncachedDefect.location,
      shapeDefectMessage: shapeDefect.message,
      canonicalPreview: result.canonicalText.slice(0, 200),
    },
  };
}
