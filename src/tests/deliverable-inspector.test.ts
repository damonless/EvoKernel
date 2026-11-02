import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import {
  crc32,
  buildInMemoryZip,
  readZipEntries,
  inspectDeliverable,
  inspectDeliverableBuffer,
  runDeliverableInspectorSelfTest,
  colLettersToIndex,
  indexToColLetters,
  parseDelimited,
  decodeXmlEntities,
} from '../core/deliverable.js';
import { executeSandboxedScript } from '../core/sandbox.js';

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evo-deliverable-test-'));
}

describe('Zero-Dependency Deliverable Canonical Consumer-Reader Suite', () => {
  // =========================================================================
  // 1. LOW-LEVEL ZIP & CRC32 INVARIANTS
  // =========================================================================
  test('1. CRC32 calculation matches IEEE 802.3 standard values', () => {
    assert.equal(crc32(Buffer.from('123456789', 'utf8')), 0xcbf43926);
    assert.equal(crc32(Buffer.alloc(0)), 0);
    assert.equal(crc32(Buffer.from('hello world', 'utf8')), 0x0d4a1185);
  });

  test('2. buildInMemoryZip builds valid archives readable by readZipEntries (Standard & Bit-3)', () => {
    const files = [
      { name: 'hello.txt', content: 'Hello World!' },
      { name: 'sub/test.json', content: '{"status":"ok"}', useBit3Descriptor: true },
    ];
    const zipBuf = buildInMemoryZip(files);
    assert.ok(zipBuf.length > 0);

    const { archive, defect } = readZipEntries(zipBuf);
    assert.equal(defect, undefined);
    assert.ok(archive);
    assert.equal(archive.entries.size, 2);

    const hello = archive.readEntryText('hello.txt');
    assert.equal(hello, 'Hello World!');

    const json = archive.readEntryText('sub/test.json');
    assert.equal(json, '{"status":"ok"}');
  });

  test('3. readZipEntries detects OLE2 binary Compound Document magic bytes and returns UNSUPPORTED_LEGACY_OLE2', () => {
    const ole2Buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
    const { archive, defect } = readZipEntries(ole2Buf);
    assert.equal(archive, undefined);
    assert.ok(defect);
    assert.equal(defect.code, 'UNSUPPORTED_LEGACY_OLE2');
    assert.equal(defect.severity, 'error');

    // Also verify via inspectDeliverableBuffer
    const res = inspectDeliverableBuffer(ole2Buf, { filePath: 'test.xls' });
    assert.equal(res.ok, false);
    assert.equal(res.format, 'ole2');
    assert.equal(res.defects[0].code, 'UNSUPPORTED_LEGACY_OLE2');
  });

  test('4. readZipEntries detects ZIP64 markers and returns ERR_ARCHIVE_TOO_LARGE', () => {
    // Synthesize valid minimal ZIP with ZIP64 locator signature preceding EOCD
    const zipBuf = buildInMemoryZip([{ name: 'test.txt', content: 'data' }]);
    // Inject ZIP64 locator signature (0x07064b50) immediately before EOCD
    const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const eocdIndex = zipBuf.indexOf(eocdSig);
    assert.ok(eocdIndex > 20);

    const zipWithZip64 = Buffer.concat([
      zipBuf.subarray(0, eocdIndex - 20),
      Buffer.from([0x50, 0x4b, 0x06, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]),
      zipBuf.subarray(eocdIndex),
    ]);

    const { defect } = readZipEntries(zipWithZip64);
    assert.ok(defect);
    assert.equal(defect.code, 'ERR_ARCHIVE_TOO_LARGE');
  });

  test('5. readZipEntries enforces 32MB cumulative uncompressed size cap', () => {
    // Create archive that declares 100 bytes but we limit to 50 bytes
    const zipBuf = buildInMemoryZip([
      { name: 'big1.txt', content: 'A'.repeat(30) },
      { name: 'big2.txt', content: 'B'.repeat(30) },
    ]);
    const { defect } = readZipEntries(zipBuf, 50); // cap at 50 bytes
    assert.ok(defect);
    assert.equal(defect.code, 'ERR_ARCHIVE_TOO_LARGE');
    assert.ok(defect.message.includes('safe limit of 50 bytes'));
  });

  // =========================================================================
  // 2. EXCEL & DELIVERABLE HELPERS
  // =========================================================================
  test('6. colLettersToIndex and indexToColLetters bi-directional conversion', () => {
    assert.equal(colLettersToIndex('A'), 0);
    assert.equal(colLettersToIndex('B'), 1);
    assert.equal(colLettersToIndex('Z'), 25);
    assert.equal(colLettersToIndex('AA'), 26);
    assert.equal(colLettersToIndex('AB'), 27);
    assert.equal(colLettersToIndex('AZ'), 51);
    assert.equal(colLettersToIndex('BA'), 52);
    assert.equal(colLettersToIndex('D'), 3);

    assert.equal(indexToColLetters(0), 'A');
    assert.equal(indexToColLetters(1), 'B');
    assert.equal(indexToColLetters(25), 'Z');
    assert.equal(indexToColLetters(26), 'AA');
    assert.equal(indexToColLetters(27), 'AB');
    assert.equal(indexToColLetters(3), 'D');
  });

  test('7. decodeXmlEntities decodes named and numeric decimal/hex entities', () => {
    const raw = '&lt;div class=&quot;main&apos;&gt;Tom &amp; Jerry &#65; &#x42;&lt;/div&gt;';
    const decoded = decodeXmlEntities(raw);
    assert.equal(decoded, '<div class="main\'>Tom & Jerry A B</div>');
  });

  // =========================================================================
  // 3. XLSX CANONICAL CONSUMER & DEFECT DETECTION
  // =========================================================================
  test('8. XLSX: Normalizes openpyxl leading slash /xl/worksheets/sheet1.xml targets', () => {
    const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/>
</Relationships>`;
    const wb = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="str"><v>OpenPyXL Data</v></c></row>
  </sheetData>
</worksheet>`;

    const zip = buildInMemoryZip([
      { name: 'xl/_rels/workbook.xml.rels', content: rels },
      { name: 'xl/workbook.xml', content: wb },
      { name: 'xl/worksheets/sheet1.xml', content: sheet },
    ]);

    const res = inspectDeliverableBuffer(zip, { format: 'xlsx' });
    assert.equal(res.ok, true);
    assert.equal(res.format, 'xlsx');
    assert.ok(res.canonicalText.includes('OpenPyXL Data'));
  });

  test('9. XLSX: Strips <rPh> phonetic runs before concatenating <t> nodes', () => {
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;
    const wb = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
    const sst = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><rPh t="とうきょう"/><t>Tokyo</t></si>
  <si><t>Kyoto</t><rPh t="きょうと"/></si>
</sst>`;
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
  </sheetData>
</worksheet>`;

    const zip = buildInMemoryZip([
      { name: 'xl/_rels/workbook.xml.rels', content: rels },
      { name: 'xl/workbook.xml', content: wb },
      { name: 'xl/sharedStrings.xml', content: sst },
      { name: 'xl/worksheets/sheet1.xml', content: sheet },
    ]);

    const res = inspectDeliverableBuffer(zip, { format: 'xlsx' });
    assert.equal(res.ok, true);
    assert.ok(res.canonicalText.includes('Tokyo\tKyoto'));
    assert.ok(!res.canonicalText.includes('とうきょう'));
    assert.ok(!res.canonicalText.includes('きょうと'));
  });

  test('10. XLSX: Detects uncached shared formula followers and renders cell as blank', () => {
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
    const wb = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="str"><v>Cost</v></c>
      <c r="B1"><f>A1*2</f></c>
      <c r="C1"><f t="shared" si="0"/></c>
    </row>
  </sheetData>
</worksheet>`;

    const zip = buildInMemoryZip([
      { name: 'xl/_rels/workbook.xml.rels', content: rels },
      { name: 'xl/workbook.xml', content: wb },
      { name: 'xl/worksheets/sheet1.xml', content: sheet },
    ]);

    const res = inspectDeliverableBuffer(zip, { format: 'xlsx' });
    assert.equal(res.ok, false);
    const uncachedDefects = res.defects.filter((d) => d.code === 'UNCACHED_FORMULA');
    assert.equal(uncachedDefects.length, 2);
    assert.equal(uncachedDefects[0].location, 'Sales!B1');
    assert.equal(uncachedDefects[1].location, 'Sales!C1');
    // Both B1 and C1 should be rendered blank: "Cost\t\t"
    assert.ok(res.canonicalText.includes('Cost\t\t'));
  });

  test('11. XLSX: Flags formula errors (#REF!, #DIV/0!, #VALUE!, t="e")', () => {
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
    const wb = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Finance" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="e"><v>#REF!</v></c>
      <c r="B1"><v>#DIV/0!</v></c>
      <c r="C1"><v>#VALUE!</v></c>
    </row>
  </sheetData>
</worksheet>`;

    const zip = buildInMemoryZip([
      { name: 'xl/_rels/workbook.xml.rels', content: rels },
      { name: 'xl/workbook.xml', content: wb },
      { name: 'xl/worksheets/sheet1.xml', content: sheet },
    ]);

    const res = inspectDeliverableBuffer(zip, { format: 'xlsx' });
    assert.equal(res.ok, false);
    const formulaErrors = res.defects.filter((d) => d.code === 'FORMULA_ERROR');
    assert.equal(formulaErrors.length, 3);
  });

  test('12. XLSX: Flags EMPTY_SHEET and validates expectedShape sheets and headers', () => {
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;
    const wb = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Summary" sheetId="1" r:id="rId1"/>
    <sheet name="EmptyTab" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;
    const sheet1 = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="str"><v>ID</v></c>
      <c r="B1" t="str"><v>Title</v></c>
    </row>
  </sheetData>
</worksheet>`;
    const sheet2 = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;

    const zip = buildInMemoryZip([
      { name: 'xl/_rels/workbook.xml.rels', content: rels },
      { name: 'xl/workbook.xml', content: wb },
      { name: 'xl/worksheets/sheet1.xml', content: sheet1 },
      { name: 'xl/worksheets/sheet2.xml', content: sheet2 },
    ]);

    const res = inspectDeliverableBuffer(zip, {
      format: 'xlsx',
      expectedShape: {
        sheets: ['Summary', 'MissingTab'],
        headers: {
          Summary: ['ID', 'Title', 'ExtraMissingCol'],
        },
      },
    });

    assert.equal(res.ok, false);
    assert.ok(res.defects.some((d) => d.code === 'EMPTY_SHEET' && d.location === 'EmptyTab'));
    assert.ok(res.defects.some((d) => d.code === 'SHAPE_CONFORMANCE_DEVIATION' && d.location === 'MissingTab'));
    assert.ok(res.defects.some((d) => d.code === 'SHAPE_CONFORMANCE_DEVIATION' && d.message.includes('ExtraMissingCol')));
  });

  // =========================================================================
  // 4. DOCX CANONICAL CONSUMER & DEFECT DETECTION
  // =========================================================================
  test('13. DOCX: Extracts headings, paragraphs, and tables into canonical text', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Project Specification</w:t></w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:t>Section 1:</w:t>
        <w:tab/>
        <w:t>Architecture</w:t>
        <w:br/>
        <w:t>Details</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Module</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Kernel</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Active</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const zip = buildInMemoryZip([{ name: 'word/document.xml', content: docXml }]);
    const res = inspectDeliverableBuffer(zip, {
      format: 'docx',
      expectedShape: { headings: ['Project Specification'] },
    });

    assert.equal(res.ok, true);
    assert.equal(res.format, 'docx');
    assert.ok(res.canonicalText.includes('# Project Specification'));
    assert.ok(res.canonicalText.includes('Section 1:\tArchitecture\nDetails'));
    assert.ok(res.canonicalText.includes('| Module | Status |'));
    assert.ok(res.canonicalText.includes('| Kernel | Active |'));
  });

  test('14. DOCX: Flags EMPTY_DOCUMENT when document body is blank', () => {
    const docXml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;
    const zip = buildInMemoryZip([{ name: 'word/document.xml', content: docXml }]);
    const res = inspectDeliverableBuffer(zip, { format: 'docx' });
    assert.equal(res.ok, false);
    assert.equal(res.defects[0].code, 'EMPTY_DOCUMENT');
  });

  // =========================================================================
  // 5. PPTX CANONICAL CONSUMER & DEFECT DETECTION
  // =========================================================================
  test('15. PPTX: Sorts slides numerically and extracts text into ## Slide N blocks', () => {
    const slide1Xml = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Title Slide</a:t></p:sld>`;
    const slide2Xml = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Content Slide</a:t></p:sld>`;
    const slide10Xml = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Appendix Slide</a:t></p:sld>`;

    const zip = buildInMemoryZip([
      { name: 'ppt/slides/slide10.xml', content: slide10Xml },
      { name: 'ppt/slides/slide1.xml', content: slide1Xml },
      { name: 'ppt/slides/slide2.xml', content: slide2Xml },
    ]);

    const res = inspectDeliverableBuffer(zip, { format: 'pptx' });
    assert.equal(res.ok, true);
    assert.equal(res.format, 'pptx');
    const text = res.canonicalText;
    const pos1 = text.indexOf('## Slide 1\nTitle Slide');
    const pos2 = text.indexOf('## Slide 2\nContent Slide');
    const pos10 = text.indexOf('## Slide 10\nAppendix Slide');
    assert.ok(pos1 !== -1 && pos2 !== -1 && pos10 !== -1);
    assert.ok(pos1 < pos2 && pos2 < pos10, 'Slides must be sorted numerically (1, 2, 10)');
  });

  test('16. PPTX: Flags EMPTY_SLIDE warning on blank slide and EMPTY_PRESENTATION on empty deck', () => {
    const emptySlideXml = `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>`;
    const zip = buildInMemoryZip([{ name: 'ppt/slides/slide1.xml', content: emptySlideXml }]);
    const res = inspectDeliverableBuffer(zip, { format: 'pptx' });
    assert.equal(res.ok, false);
    assert.ok(res.defects.some((d) => d.code === 'EMPTY_SLIDE' && d.severity === 'warning'));
    assert.ok(res.defects.some((d) => d.code === 'EMPTY_PRESENTATION' && d.severity === 'error'));
  });

  // =========================================================================
  // 6. CSV & TSV CANONICAL CONSUMER & RAGGED COLUMNS
  // =========================================================================
  test('17. CSV: RFC-4180 parser handles quotes, escaped quotes, and newlines', () => {
    const csvContent = 'Name,Bio,Role\r\n"Alice","Engineer\r\nSpecialist","Lead"\r\n"Bob","Says ""Hello""","Senior"';
    const rows = parseDelimited(csvContent, ',');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], ['Name', 'Bio', 'Role']);
    assert.deepEqual(rows[1], ['Alice', 'Engineer\r\nSpecialist', 'Lead']);
    assert.deepEqual(rows[2], ['Bob', 'Says "Hello"', 'Senior']);
  });

  test('18. CSV: Flags RAGGED_COLUMNS and validates expected headers', () => {
    const csvContent = 'ID,Name,Email\n1,Alice,alice@example.com\n2,Bob\n3,Charlie,c@test.com,Extra';
    const res = inspectDeliverableBuffer(Buffer.from(csvContent, 'utf8'), {
      format: 'csv',
      expectedShape: {
        headers: ['ID', 'Name', 'Email'],
        strictColumns: true,
      },
    });

    assert.equal(res.ok, false);
    const ragged = res.defects.filter((d) => d.code === 'RAGGED_COLUMNS');
    assert.equal(ragged.length, 2);
    assert.equal(ragged[0].location, 'Row 3');
    assert.equal(ragged[1].location, 'Row 4');
  });

  // =========================================================================
  // 7. JSON & JSONL CANONICAL CONSUMER & SHAPE CONFORMANCE
  // =========================================================================
  test('19. JSON: Validates JSON syntax, requiredKeys, strictKeys, and canonical formatting', () => {
    const validJson = JSON.stringify({ id: 1, name: 'Alice', role: 'admin' });
    const res = inspectDeliverableBuffer(Buffer.from(validJson, 'utf8'), {
      format: 'json',
      expectedShape: {
        requiredKeys: ['id', 'name'],
        strictKeys: true,
      },
    });

    // Should flag strictKeys error because 'role' is not in requiredKeys
    assert.equal(res.ok, false);
    assert.ok(res.defects.some((d) => d.code === 'SHAPE_CONFORMANCE_DEVIATION' && d.location === 'role'));

    // Malformed JSON check
    const badJson = '{ "unclosed": "string ';
    const badRes = inspectDeliverableBuffer(Buffer.from(badJson, 'utf8'), { format: 'json' });
    assert.equal(badRes.ok, false);
    assert.equal(badRes.defects[0].code, 'INVALID_JSON');
  });

  test('20. JSONL: Validates per-line JSON and requiredKeys across lines', () => {
    const jsonlContent = '{"id":1,"type":"A"}\n{"id":2}\n{"invalid":';
    const res = inspectDeliverableBuffer(Buffer.from(jsonlContent, 'utf8'), {
      format: 'jsonl',
      expectedShape: { requiredKeys: ['id', 'type'] },
    });

    assert.equal(res.ok, false);
    assert.ok(res.defects.some((d) => d.code === 'SHAPE_CONFORMANCE_DEVIATION' && d.location === 'Line 2:type'));
    assert.ok(res.defects.some((d) => d.code === 'INVALID_JSON' && d.location === 'Line 3'));
  });

  // =========================================================================
  // 8. MARKDOWN & TEXT UNCLOSED CODE FENCE & PLACEHOLDER LEAKS
  // =========================================================================
  test('21. Markdown: Detects UNCLOSED_CODE_FENCE and ignores placeholders inside code fences', () => {
    const mdWithLeak = `# User Guide\n\nPlease complete: TODO: write this section.\n\n\`\`\`js\n// TODO: ignore this inside code\nconst a = 1;\n\`\`\`\n`;
    const res = inspectDeliverableBuffer(Buffer.from(mdWithLeak, 'utf8'), { format: 'md' });
    assert.equal(res.ok, true); // only warning defects
    const leaks = res.defects.filter((d) => d.code === 'PLACEHOLDER_LEAK');
    assert.equal(leaks.length, 1);
    assert.ok(leaks[0].location.includes(':3')); // Line 3 outside code fence

    // Unclosed code fence check
    const unclosedMd = `# Title\n\`\`\`ts\nconst x = 10;\n`;
    const unclosedRes = inspectDeliverableBuffer(Buffer.from(unclosedMd, 'utf8'), { format: 'md' });
    assert.equal(unclosedRes.ok, false);
    assert.equal(unclosedRes.defects[0].code, 'UNCLOSED_CODE_FENCE');
  });

  test('22. Placeholder Detector detects {{VARIABLE}}, [INSERT ...], and <placeholder>', () => {
    const text = 'Hello {{USER_NAME}}, please [INSERT details] and check <placeholder text>.';
    const res = inspectDeliverableBuffer(Buffer.from(text, 'utf8'), { format: 'txt' });
    const leaks = res.defects.filter((d) => d.code === 'PLACEHOLDER_LEAK');
    assert.ok(leaks.length >= 1);
  });

  // =========================================================================
  // 9. PURE IN-MEMORY SELF-TEST RUNNER & STANDALONE MICRO-TOOL RUNNER
  // =========================================================================
  test('23. runDeliverableInspectorSelfTest runs in RAM with zero disk files and passes', () => {
    const testRes = runDeliverableInspectorSelfTest();
    assert.equal(testRes.passed, true);
    assert.equal(testRes.diagnostics.format, 'xlsx');
    assert.ok(typeof testRes.diagnostics.defectsCount === 'number');
  });

  test('24. Standalone run.mjs --self-test succeeds via executeSandboxedScript', () => {
    const rootDir = process.cwd();
    const toolScript = path.join(rootDir, '.evo', 'tools', 'deliverable-canonical-inspector', 'run.mjs');
    assert.ok(fs.existsSync(toolScript), 'run.mjs must exist in .evo/tools/deliverable-canonical-inspector');

    const result = executeSandboxedScript(
      'node',
      toolScript,
      {},
      {
        cwd: rootDir,
        selfTest: true,
        timeoutMs: 10000,
      }
    );

    assert.equal(result.exitCode, 0, `Self-test failed with code ${result.exitCode}: ${result.stderr}`);
    assert.ok(result.stdout.includes('"self_test":"passed"'));
  });

  test('25. Byte-parity: .evo/tools and templates/seed-evo/tools are byte-for-byte identical', () => {
    const rootDir = process.cwd();
    const activeDir = path.join(rootDir, '.evo', 'tools', 'deliverable-canonical-inspector');
    const seedDir = path.join(rootDir, 'templates', 'seed-evo', 'tools', 'deliverable-canonical-inspector');

    const activeManifest = fs.readFileSync(path.join(activeDir, 'manifest.json'));
    const seedManifest = fs.readFileSync(path.join(seedDir, 'manifest.json'));
    assert.equal(Buffer.compare(activeManifest, seedManifest), 0, 'manifest.json must be byte-for-byte identical');

    const activeRun = fs.readFileSync(path.join(activeDir, 'run.mjs'));
    const seedRun = fs.readFileSync(path.join(seedDir, 'run.mjs'));
    assert.equal(Buffer.compare(activeRun, seedRun), 0, 'run.mjs must be byte-for-byte identical');
  });

  test('26. Standalone run.mjs inspects file via CLI flags and emits JSON output', () => {
    const ws = createTempWorkspace();
    try {
      const filePath = path.join(ws, 'test.csv');
      fs.writeFileSync(filePath, 'Col1,Col2\nVal1,Val2\n', 'utf8');

      const rootDir = process.cwd();
      const toolScript = path.join(rootDir, '.evo', 'tools', 'deliverable-canonical-inspector', 'run.mjs');

      // 1. Sandboxed MCP execution with payload
      const sandboxedRes = executeSandboxedScript(
        'node',
        toolScript,
        { filePath },
        {
          cwd: ws,
          timeoutMs: 10000,
        }
      );
      assert.equal(sandboxedRes.exitCode, 0, `Sandboxed run failed: ${sandboxedRes.stderr}`);
      const parsedSandbox = JSON.parse(sandboxedRes.stdout);
      assert.equal(parsedSandbox.ok, true);
      assert.equal(parsedSandbox.format, 'csv');
      assert.ok(parsedSandbox.canonicalText.includes('Col1\tCol2'));

      // 2. Direct CLI flag execution (--file <path>)
      const cliRes = spawnSync(process.execPath, [toolScript, '--file', filePath], {
        cwd: ws,
        encoding: 'utf8',
      });
      assert.equal(cliRes.status, 0, `CLI run failed: ${cliRes.stderr}`);
      const parsedCli = JSON.parse(cliRes.stdout);
      assert.equal(parsedCli.ok, true);
      assert.equal(parsedCli.format, 'csv');
      assert.ok(parsedCli.canonicalText.includes('Col1\tCol2'));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 10. EDGE CASE HARDENING & RECENT BUG FIX PROBES (TESTS 27 - 33)
  // =========================================================================
  test('27. XLSX: Self-closing <c .../> preserves subsequent sibling cells without swallowing them', () => {
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
    const wb = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="str"><v>First</v></c>
      <c r="B1"/>
      <c r="C1" t="str"><v>Third</v></c>
    </row>
  </sheetData>
</worksheet>`;

    const zip = buildInMemoryZip([
      { name: 'xl/_rels/workbook.xml.rels', content: rels },
      { name: 'xl/workbook.xml', content: wb },
      { name: 'xl/worksheets/sheet1.xml', content: sheet },
    ]);

    const res = inspectDeliverableBuffer(zip, { format: 'xlsx' });
    assert.equal(res.ok, true);
    assert.ok(res.canonicalText.includes('First\t\tThird'));
  });

  test('28. JSONL: Enforces strictKeys per line and flags unexpected extra keys', () => {
    const jsonlContent = '{"id":1,"type":"A"}\n{"id":2,"type":"B","unexpectedKey":"forbidden"}\n';
    const res = inspectDeliverableBuffer(Buffer.from(jsonlContent, 'utf8'), {
      format: 'jsonl',
      expectedShape: {
        requiredKeys: ['id', 'type'],
        strictKeys: true,
      },
    });

    assert.equal(res.ok, false);
    const deviations = res.defects.filter((d) => d.code === 'SHAPE_CONFORMANCE_DEVIATION');
    assert.equal(deviations.length, 1);
    assert.equal(deviations[0].location, 'Line 2:unexpectedKey');
  });

  test('29. Markdown: Does not close code fence when line starts with nested fence info string', () => {
    const mdContent = '# Documentation\n\n```markdown\n```js\n// TODO: comment inside nested example\nconst x = 1;\n```\n```\n';
    const res = inspectDeliverableBuffer(Buffer.from(mdContent, 'utf8'), { format: 'md' });
    const leaks = res.defects.filter((d) => d.code === 'PLACEHOLDER_LEAK');
    assert.equal(leaks.length, 0);
  });

  test('30. DOCX: Detects headings with spaces like Heading 1, Heading 2, and Title', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading 1"/></w:pPr>
      <w:r><w:t>Main Section</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r><w:t>Document Title</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
    const zip = buildInMemoryZip([{ name: 'word/document.xml', content: docXml }]);
    const res = inspectDeliverableBuffer(zip, { format: 'docx' });
    assert.equal(res.ok, true);
    assert.ok(res.canonicalText.includes('# Main Section'));
    assert.ok(res.canonicalText.includes('# Document Title'));
  });

  test('31. ZIP: Detects standalone ZIP64 EOCD record signature 0x06064b50', () => {
    const zipBuf = buildInMemoryZip([{ name: 'test.txt', content: 'test content' }]);
    const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const eocdIndex = zipBuf.indexOf(eocdSig);
    assert.ok(eocdIndex > 56);

    const zipWithZip64Record = Buffer.concat([
      zipBuf.subarray(0, eocdIndex - 56),
      Buffer.from([0x50, 0x4b, 0x06, 0x06, ...new Array(52).fill(0)]),
      zipBuf.subarray(eocdIndex),
    ]);

    const { defect } = readZipEntries(zipWithZip64Record);
    assert.ok(defect);
    assert.equal(defect.code, 'ERR_ARCHIVE_TOO_LARGE');
  });

  test('32. ZIP: Handles corrupt deflate stream gracefully without throwing unhandled error', () => {
    const zipBuf = buildInMemoryZip([{ name: 'corrupt.txt', content: 'hello world' }]);
    const corruptedZip = Buffer.from(zipBuf);
    for (let i = 35; i < 45; i++) {
      corruptedZip[i] = 0xff;
    }
    const res = inspectDeliverableBuffer(corruptedZip, { format: 'docx' });
    assert.equal(res.ok, false);
    assert.ok(res.defects.length >= 1);
  });

  test('33. XLSX: Decodes XML entities in string formula results (t="str")', () => {
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
    const wb = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="str"><v>AT&amp;T &lt;Corp&gt;</v></c>
    </row>
  </sheetData>
</worksheet>`;
    const zip = buildInMemoryZip([
      { name: 'xl/_rels/workbook.xml.rels', content: rels },
      { name: 'xl/workbook.xml', content: wb },
      { name: 'xl/worksheets/sheet1.xml', content: sheet },
    ]);
    const res = inspectDeliverableBuffer(zip, { format: 'xlsx' });
    assert.equal(res.ok, true);
    assert.ok(res.canonicalText.includes('AT&T <Corp>'));
  });
});
