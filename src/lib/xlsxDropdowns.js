import * as XLSX from "xlsx";

export const OPTIONS_SHEET_NAME = "Options";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function writeUint16(out, value) {
  out.push(value & 255, (value >>> 8) & 255);
}

function writeUint32(out, value) {
  out.push(
    value & 255,
    (value >>> 8) & 255,
    (value >>> 16) & 255,
    (value >>> 24) & 255,
  );
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "Your browser cannot add Excel dropdowns. Please use a Chromium-based browser.",
    );
  }
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (readUint32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid XLSX file");

  const entryCount = readUint16(bytes, eocd + 10);
  let centralOffset = readUint32(bytes, eocd + 16);
  const entries = new Map();

  for (let i = 0; i < entryCount; i++) {
    if (readUint32(bytes, centralOffset) !== 0x02014b50)
      throw new Error("Invalid XLSX directory");
    const method = readUint16(bytes, centralOffset + 10);
    const compressedSize = readUint32(bytes, centralOffset + 20);
    const fileNameLength = readUint16(bytes, centralOffset + 28);
    const extraLength = readUint16(bytes, centralOffset + 30);
    const commentLength = readUint16(bytes, centralOffset + 32);
    const localOffset = readUint32(bytes, centralOffset + 42);
    const name = decoder.decode(
      bytes.slice(centralOffset + 46, centralOffset + 46 + fileNameLength),
    );

    const localNameLength = readUint16(bytes, localOffset + 26);
    const localExtraLength = readUint16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`Unsupported XLSX compression method ${method}`);

    entries.set(name, data);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function writeZipEntries(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, data] of entries.entries()) {
    const nameBytes = encoder.encode(name);
    const checksum = crc32(data);
    const local = [];
    writeUint32(local, 0x04034b50);
    writeUint16(local, 20);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint16(local, 0);
    writeUint32(local, checksum);
    writeUint32(local, data.length);
    writeUint32(local, data.length);
    writeUint16(local, nameBytes.length);
    writeUint16(local, 0);
    local.push(...nameBytes);
    localParts.push(new Uint8Array(local), data);

    const central = [];
    writeUint32(central, 0x02014b50);
    writeUint16(central, 20);
    writeUint16(central, 20);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, checksum);
    writeUint32(central, data.length);
    writeUint32(central, data.length);
    writeUint16(central, nameBytes.length);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, 0);
    writeUint32(central, offset);
    central.push(...nameBytes);
    centralParts.push(new Uint8Array(central));

    offset += local.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = [];
  writeUint32(end, 0x06054b50);
  writeUint16(end, 0);
  writeUint16(end, 0);
  writeUint16(end, entries.size);
  writeUint16(end, entries.size);
  writeUint32(end, centralSize);
  writeUint32(end, centralOffset);
  writeUint16(end, 0);

  return new Blob([...localParts, ...centralParts, new Uint8Array(end)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function patchWorksheetValidations(xml, validations) {
  const dataValidations = [
    `<dataValidations count="${validations.length}">`,
    ...validations.map((validation) => {
      const type = validation.type || "list";
      const allowBlank = validation.allowBlank === false ? "0" : "1";
      const operator = validation.operator
        ? ` operator="${escapeXml(validation.operator)}"`
        : "";
      const errorTitle = validation.errorTitle
        ? ` errorTitle="${escapeXml(validation.errorTitle)}"`
        : "";
      const error = validation.error
        ? ` error="${escapeXml(validation.error)}"`
        : "";
      const promptTitle = validation.promptTitle
        ? ` promptTitle="${escapeXml(validation.promptTitle)}"`
        : "";
      const prompt = validation.prompt
        ? ` prompt="${escapeXml(validation.prompt)}"`
        : "";
      return (
        `<dataValidation type="${escapeXml(type)}" allowBlank="${allowBlank}" showErrorMessage="${validation.showErrorMessage === false ? "0" : "1"}" showInputMessage="1"${operator}${errorTitle}${error}${promptTitle}${prompt} sqref="${escapeXml(validation.range)}">` +
        `<formula1>${escapeXml(validation.formula)}</formula1>` +
        "</dataValidation>"
      );
    }),
    "</dataValidations>",
  ].join("");
  const withoutExisting = xml.replace(
    /<dataValidations[\s\S]*?<\/dataValidations>/,
    "",
  );
  if (withoutExisting.includes("</sheetData>")) {
    return withoutExisting.replace(
      "</sheetData>",
      `</sheetData>${dataValidations}`,
    );
  }
  return withoutExisting.replace(
    "</worksheet>",
    `${dataValidations}</worksheet>`,
  );
}

function patchStylesQuotePrefix(xml) {
  const match = xml.match(/<cellXfs\b([^>]*)count="(\d+)"([^>]*)>/);
  if (!match) return { xml, styleIndex: 0 };

  const styleIndex = Number(match[2]);
  const nextOpenTag = match[0].replace(
    /count="\d+"/,
    `count="${styleIndex + 1}"`,
  );
  const quotePrefixStyle =
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>';

  return {
    styleIndex,
    xml: xml
      .replace(match[0], nextOpenTag)
      .replace("</cellXfs>", `${quotePrefixStyle}</cellXfs>`),
  };
}

function parseCellRange(range) {
  const match = String(range || "").match(
    /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i,
  );
  if (!match) return [];
  const startColumn = match[1].toUpperCase();
  const endColumn = (match[3] || match[1]).toUpperCase();
  if (startColumn !== endColumn) return [];
  const startRow = Number(match[2]);
  const endRow = Number(match[4] || match[2]);
  if (!Number.isFinite(startRow) || !Number.isFinite(endRow)) return [];
  const refs = [];
  for (let row = startRow; row <= endRow; row++)
    refs.push(`${startColumn}${row}`);
  return refs;
}

function patchWorksheetQuotePrefix(xml, ranges, styleIndex) {
  const withoutIgnoredErrors = xml.replace(
    /<ignoredErrors[\s\S]*?<\/ignoredErrors>/g,
    "",
  );
  const refs = ranges.flatMap(parseCellRange);
  return refs.reduce((nextXml, ref) => {
    const cellPattern = new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*)>`, "i");
    return nextXml.replace(cellPattern, (cellTag, attributes) => {
      const nextAttributes = /\bs="\d+"/.test(attributes)
        ? attributes.replace(/\bs="\d+"/, `s="${styleIndex}"`)
        : `${attributes} s="${styleIndex}"`;
      return `<c${nextAttributes}>`;
    });
  }, withoutIgnoredErrors);
}

export function uniqueOptions(values) {
  return [
    ...new Set(
      values.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ];
}

export function sortOptions(values) {
  return [...values].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: "base" }),
  );
}

export function excelText(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function normalizeSpreadsheetCell(value, cell) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const normalized =
    trimmed.startsWith("'") && trimmed.length > 1 ? trimmed.slice(1) : trimmed;
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(normalized)) {
    const raw = cell?.v;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Number.isInteger(raw) ? String(raw) : String(raw);
    }
  }
  return normalized;
}

export function isBlankSpreadsheetRow(row) {
  return Object.values(row || {}).every(
    (value) => String(value ?? "").trim() === "",
  );
}

export function sheetToJsonRows(worksheet, options = {}) {
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false,
    ...options,
  });
  if (options.header === 1) {
    return rows
      .map((row, rowIndex) =>
        row.map((value, columnIndex) =>
          normalizeSpreadsheetCell(
            value,
            worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })],
          ),
        ),
      )
      .filter((row) => !isBlankSpreadsheetRow(row));
  }

  const headerRow = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  })[options.range || 0];
  return rows
    .map((row, rowIndex) =>
      Object.fromEntries(
        Object.entries(row || {}).map(([key, value]) => {
          const columnIndex = Array.isArray(headerRow)
            ? headerRow.findIndex((header) => String(header) === String(key))
            : -1;
          const cell =
            columnIndex >= 0
              ? worksheet[
                  XLSX.utils.encode_cell({
                    r: rowIndex + 1 + (Number(options.range) || 0),
                    c: columnIndex,
                  })
                ]
              : null;
          return [key, normalizeSpreadsheetCell(value, cell)];
        }),
      ),
    )
    .filter((row) => !isBlankSpreadsheetRow(row));
}

export function applyTextFormatToColumns(
  worksheet,
  headers,
  columnHeaders,
  rowLimit = 5001,
) {
  const textHeaders = new Set(columnHeaders);
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
  headers.forEach((header, columnIndex) => {
    if (!textHeaders.has(header)) return;
    const column = XLSX.utils.encode_col(columnIndex);
    for (let row = 2; row <= rowLimit; row++) {
      const ref = `${column}${row}`;
      if (!worksheet[ref]) worksheet[ref] = { t: "s", v: "" };
      worksheet[ref].t = "s";
      worksheet[ref].v = excelText(worksheet[ref].v);
      worksheet[ref].w = excelText(worksheet[ref].v);
      worksheet[ref].z = "@";
    }
    range.e.r = Math.max(range.e.r, rowLimit - 1);
    range.e.c = Math.max(range.e.c, columnIndex);
  });
  worksheet["!ref"] = XLSX.utils.encode_range(range);
}

export function buildOptionsSheet(optionGroups) {
  const maxRows = Math.max(
    1,
    ...optionGroups.map((group) => group.values.length + 1),
  );
  const rows = Array.from({ length: maxRows }, () => []);
  optionGroups.forEach((group, col) => {
    rows[0][col] = group.key;
    group.values.forEach((value, row) => {
      rows[row + 1][col] = excelText(value);
    });
  });
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  optionGroups.forEach((group, col) => {
    if (!group.values.length) return;
    const column = XLSX.utils.encode_col(col);
    for (let row = 2; row <= group.values.length + 1; row++) {
      const ref = `${column}${row}`;
      if (!worksheet[ref]) continue;
      worksheet[ref].t = "s";
      worksheet[ref].z = "@";
    }
  });
  return worksheet;
}

export function optionFormula(optionGroups, key) {
  const index = optionGroups.findIndex((group) => group.key === key);
  if (index < 0) return "";
  const count = optionGroups[index].values.length;
  if (!count) return "";
  return optionGroups[index].name || makeExcelName(key);
}

export function prefixMatchOptionFormula(optionGroups, key, inputCell) {
  const index = optionGroups.findIndex((group) => group.key === key);
  if (index < 0 || !optionGroups[index].values.length) return "";

  const column = XLSX.utils.encode_col(index);
  const firstCell = `'${OPTIONS_SHEET_NAME}'!$${column}$2`;
  const optionRange = `'${OPTIONS_SHEET_NAME}'!$${column}$2:$${column}$${optionGroups[index].values.length + 1}`;
  const fallback = optionFormula(optionGroups, key);

  return `IF(LEN(TRIM(${inputCell}))=0,${fallback},IFERROR(OFFSET(${firstCell},MATCH(TRIM(${inputCell})&"*",${optionRange},0)-1,0,COUNTIF(${optionRange},TRIM(${inputCell})&"*"),1),${fallback}))`;
}

function makeExcelName(value) {
  const name = String(value || "options")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^[^A-Za-z_]+/, "");
  return name || "options";
}

export function addOptionNamedRanges(workbook, optionGroups) {
  workbook.Workbook = workbook.Workbook || {};
  workbook.Workbook.Names = Array.isArray(workbook.Workbook.Names)
    ? workbook.Workbook.Names
    : [];

  optionGroups.forEach((group, index) => {
    if (!group.values.length) return;
    const col = XLSX.utils.encode_col(index);
    workbook.Workbook.Names.push({
      Name: group.name || makeExcelName(group.key),
      Ref: `'${OPTIONS_SHEET_NAME}'!$${col}$2:$${col}$${group.values.length + 1}`,
    });
  });
}

export function hideOptionsSheet(workbook) {
  const sheetIndex = workbook.SheetNames.indexOf(OPTIONS_SHEET_NAME);
  if (sheetIndex < 0) return;
  workbook.Workbook = workbook.Workbook || {};
  workbook.Workbook.Sheets =
    workbook.Workbook.Sheets || workbook.SheetNames.map((name) => ({ name }));
  workbook.Workbook.Sheets[sheetIndex] = {
    ...(workbook.Workbook.Sheets[sheetIndex] || {}),
    name: OPTIONS_SHEET_NAME,
    Hidden: 1,
  };
}

export async function saveWorkbookWithValidations(
  workbook,
  fileName,
  validations,
  worksheetPath = "xl/worksheets/sheet1.xml",
  options = {},
) {
  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  });
  const entries = await readZipEntries(buffer);
  const worksheet = entries.get(worksheetPath);
  if (!worksheet) throw new Error("Template worksheet not found");
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let worksheetXml = patchWorksheetValidations(
    decoder.decode(worksheet),
    validations,
  );
  const quotePrefixRanges = Array.isArray(options.quotePrefixRanges)
    ? options.quotePrefixRanges
    : [];
  if (quotePrefixRanges.length) {
    const stylesPath = "xl/styles.xml";
    const styles = entries.get(stylesPath);
    if (styles) {
      const patchedStyles = patchStylesQuotePrefix(decoder.decode(styles));
      entries.set(stylesPath, encoder.encode(patchedStyles.xml));
      worksheetXml = patchWorksheetQuotePrefix(
        worksheetXml,
        quotePrefixRanges,
        patchedStyles.styleIndex,
      );
    }
  }
  entries.set(worksheetPath, encoder.encode(worksheetXml));

  const url = URL.createObjectURL(writeZipEntries(entries));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
