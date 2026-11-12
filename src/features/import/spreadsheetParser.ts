import type * as XLSXType from "xlsx";

export type SpreadsheetFileKind = "excel" | "csv";

export interface ParsedColumn {
  index: number;
  name: string;
  label: string;
}

export interface ParsedDataRow {
  rowNumber: number;
  values: string[];
}

export interface ParsedSheet {
  name: string;
  columns: ParsedColumn[];
  rows: ParsedDataRow[];
}

export interface ParsedWorkbook {
  fileName: string;
  kind: SpreadsheetFileKind;
  sheets: ParsedSheet[];
}

export interface SheetColumnMapping {
  sheetName: string;
  wordColumn: number | null;
  meaningColumn: number | null;
}

export interface SuggestedColumnMapping {
  wordColumn: number | null;
  meaningColumn: number | null;
}

export class ImportFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImportFileError";
  }
}

const SUPPORTED_EXTENSIONS = new Set(["xlsx", "xls", "csv"]);

function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

function columnLetter(index: number): string {
  let value = index + 1;
  let result = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }

  return result;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    );
  });
}

function decodeCsvText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  if (bytes.length === 0) {
    throw new ImportFileError("CSV 文件为空。");
  }

  const hasUtf8Bom =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const hasUtf16LeBom = bytes[0] === 0xff && bytes[1] === 0xfe;
  const hasUtf16BeBom = bytes[0] === 0xfe && bytes[1] === 0xff;

  try {
    if (hasUtf16LeBom || hasUtf16BeBom) {
      return new TextDecoder(
        hasUtf16LeBom ? "utf-16le" : "utf-16be",
        { fatal: true },
      ).decode(bytes);
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\uFFFD")) {
      throw new Error("CSV 包含无法识别的替换字符。");
    }
    return hasUtf8Bom ? text.replace(/^\uFEFF/, "") : text;
  } catch (error) {
    throw new ImportFileError(
      "CSV 编码无法可靠识别。当前支持 UTF-8，以及带 BOM 的 UTF-16。",
      { cause: error },
    );
  }
}

function parseSheet(
  name: string,
  worksheet: XLSXType.WorkSheet,
  sheetToJson: typeof XLSXType.utils.sheet_to_json,
): ParsedSheet {
  const matrix = sheetToJson<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    blankrows: true,
    raw: false,
  });
  const headerIndex = matrix.findIndex((row) =>
    row.some((value) => cellText(value).trim().length > 0),
  );

  if (headerIndex < 0) {
    return { name, columns: [], rows: [] };
  }

  const columnCount = Math.max(
    ...matrix.map((row) => row.length),
    0,
  );
  const headerValues = matrix[headerIndex] ?? [];
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const name = cellText(headerValues[index]).trim();
    return {
      index,
      name,
      label: `${columnLetter(index)} · ${name || "未命名列"}`,
    };
  });

  const rows = matrix.slice(headerIndex + 1).map((row, rowIndex) => ({
    rowNumber: headerIndex + rowIndex + 2,
    values: Array.from({ length: columnCount }, (_, columnIndex) =>
      cellText(row[columnIndex]),
    ),
  }));

  return { name, columns, rows };
}

export async function parseSpreadsheetFile(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParsedWorkbook> {
  const extension = getExtension(fileName);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ImportFileError(
      "不支持此文件类型。请选择 .xlsx、.xls 或 .csv 文件。",
    );
  }
  if (buffer.byteLength === 0) {
    throw new ImportFileError("所选文件为空。");
  }

  const kind: SpreadsheetFileKind =
    extension === "csv" ? "csv" : "excel";

  try {
    const XLSX = await import("xlsx");
    const workbook =
      kind === "csv"
        ? XLSX.read(decodeCsvText(buffer), {
            type: "string",
            cellFormula: false,
          })
        : XLSX.read(new Uint8Array(buffer), {
            type: "array",
            cellFormula: false,
          });

    if (workbook.SheetNames.length === 0) {
      throw new ImportFileError("文件中没有可读取的工作表。");
    }

    const sheets = workbook.SheetNames.map((name) =>
      parseSheet(
        name,
        workbook.Sheets[name],
        XLSX.utils.sheet_to_json,
      ),
    );

    if (sheets.every((sheet) => sheet.columns.length === 0)) {
      throw new ImportFileError("文件中没有可读取的工作表数据。");
    }
    if (
      sheets.some((sheet) =>
        sheet.columns.some((column) =>
          containsControlCharacters(column.name),
        ),
      )
    ) {
      throw new ImportFileError("文件内容无法正确读取，可能已损坏。");
    }

    return {
      fileName,
      kind,
      sheets:
        kind === "csv"
          ? [
              {
                ...sheets[0],
                name: "CSV",
              },
            ]
          : sheets,
    };
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw error;
    }
    throw new ImportFileError(
      "文件无法读取，可能已损坏或格式不正确。",
      { cause: error },
    );
  }
}

export function suggestColumnMapping(
  sheet: ParsedSheet,
): SuggestedColumnMapping {
  const findColumn = (pattern: RegExp): number | null =>
    sheet.columns.find((column) => pattern.test(column.name))?.index ?? null;

  const wordColumn = findColumn(
    /^(英文单词|英文|单词|english|word|vocabulary)$/i,
  );
  const meaningColumn = findColumn(
    /^(中文含义|中文释义|中文|释义|chinese|meaning|definition)$/i,
  );

  return {
    wordColumn,
    meaningColumn:
      meaningColumn === wordColumn ? null : meaningColumn,
  };
}

export function validateColumnMapping(
  sheet: ParsedSheet,
  mapping: SheetColumnMapping,
): string | null {
  if (mapping.wordColumn === null || mapping.meaningColumn === null) {
    return `请为工作表“${sheet.name}”选择英文单词列和中文释义列。`;
  }
  if (mapping.wordColumn === mapping.meaningColumn) {
    return `工作表“${sheet.name}”的英文列和释义列不能相同。`;
  }
  if (
    !sheet.columns.some((column) => column.index === mapping.wordColumn) ||
    !sheet.columns.some((column) => column.index === mapping.meaningColumn)
  ) {
    return `工作表“${sheet.name}”的列映射无效。`;
  }
  return null;
}

