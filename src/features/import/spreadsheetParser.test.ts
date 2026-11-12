/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { analyzeImport } from "./importAnalysis";
import {
  ImportFileError,
  parseSpreadsheetFile,
  suggestColumnMapping,
  validateColumnMapping,
} from "./spreadsheetParser";

function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer;
  }
  throw new Error("XLSX 未返回二进制数据。");
}

function makeWorkbook(
  sheets: Array<{ name: string; rows: unknown[][] }>,
  bookType: "xlsx" | "biff8",
): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sheet.rows),
      sheet.name,
    );
  }
  return toArrayBuffer(
    XLSX.write(workbook, { bookType, type: "array" }),
  );
}

function csvBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe("Excel 文件解析", () => {
  it("解析用户提供的六级高频词工作簿", async () => {
    const fixturePath = resolve(
      process.cwd(),
      "src/features/import/__tests__/fixtures/cet6-frequency-sample.xlsx",
    );
    const bytes = readFileSync(fixturePath);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const workbook = await parseSpreadsheetFile(
      "cet6-frequency-sample.xlsx",
      buffer,
    );
    const sheet = workbook.sheets[0];

    expect(workbook.sheets.map((item) => item.name)).toEqual([
      "六级高频词",
    ]);
    expect(sheet.columns).toHaveLength(3);
    expect(sheet.rows).toHaveLength(204);
    expect(suggestColumnMapping(sheet)).toEqual({
      wordColumn: 0,
      meaningColumn: 2,
    });
    expect(sheet.rows[0].rowNumber).toBe(2);
    expect(sheet.rows[0].values[0]).toBe("accord");
    const analysis = analyzeImport(
      workbook,
      [
        {
          sheetName: sheet.name,
          wordColumn: 0,
          meaningColumn: 2,
        },
      ],
      [],
    );
    expect(analysis.rows).toHaveLength(204);
    expect(analysis.invalidRowCount).toBe(0);
    expect(analysis.groups).toHaveLength(204);
  });

  it("解析正常 xlsx、表头、行号和中文内容", async () => {
    const buffer = makeWorkbook(
      [
        {
          name: "六级词汇",
          rows: [
            ["英文", "词性", "中文含义"],
            ["abandon", "动词", "放弃；抛弃"],
            ["bilingual", "形容词", "双语的"],
          ],
        },
      ],
      "xlsx",
    );
    const workbook = await parseSpreadsheetFile("words.xlsx", buffer);
    const sheet = workbook.sheets[0];

    expect(workbook.kind).toBe("excel");
    expect(sheet.name).toBe("六级词汇");
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toMatchObject({
      rowNumber: 2,
      values: ["abandon", "动词", "放弃；抛弃"],
    });
    expect(suggestColumnMapping(sheet)).toEqual({
      wordColumn: 0,
      meaningColumn: 2,
    });
  });

  it("解析旧版 xls", async () => {
    const buffer = makeWorkbook(
      [
        {
          name: "词汇",
          rows: [
            ["word", "meaning"],
            ["vivid", "生动的"],
          ],
        },
      ],
      "biff8",
    );
    const workbook = await parseSpreadsheetFile("words.xls", buffer);

    expect(workbook.sheets[0].rows[0].values).toEqual([
      "vivid",
      "生动的",
    ]);
  });

  it("读取全部工作表并保留不同表的列结构", async () => {
    const buffer = makeWorkbook(
      [
        {
          name: "基础词",
          rows: [
            ["英文", "中文"],
            ["study", "学习"],
          ],
        },
        {
          name: "进阶词",
          rows: [
            ["单词", "词性", "释义"],
            ["coherent", "形容词", "连贯的"],
          ],
        },
      ],
      "xlsx",
    );
    const workbook = await parseSpreadsheetFile("multiple.xlsx", buffer);

    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
      "基础词",
      "进阶词",
    ]);
    expect(workbook.sheets[0].columns).toHaveLength(2);
    expect(workbook.sheets[1].columns).toHaveLength(3);
    expect(suggestColumnMapping(workbook.sheets[1])).toEqual({
      wordColumn: 0,
      meaningColumn: 2,
    });
  });

  it("空工作簿提示没有可读取数据", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([]),
      "空表",
    );
    const buffer = toArrayBuffer(
      XLSX.write(workbook, { bookType: "xlsx", type: "array" }),
    );

    await expect(
      parseSpreadsheetFile("empty.xlsx", buffer),
    ).rejects.toThrow("没有可读取的工作表数据");
  });
});

describe("CSV 解析与编码", () => {
  it("解析中文 CSV 的逗号、双引号和换行", async () => {
    const text =
      '英文,中文含义\r\nabandon,"放弃, 抛弃"\r\nquote,"他说：""你好"""\r\nmultiline,"第一行\n第二行"';
    const workbook = await parseSpreadsheetFile(
      "words.csv",
      csvBuffer(text),
    );

    expect(workbook.kind).toBe("csv");
    expect(workbook.sheets[0].name).toBe("CSV");
    expect(workbook.sheets[0].rows[0].values).toEqual([
      "abandon",
      "放弃, 抛弃",
    ]);
    expect(workbook.sheets[0].rows[1].values[1]).toBe('他说："你好"');
    expect(workbook.sheets[0].rows[2].values[1]).toBe("第一行\n第二行");
  });

  it("读取带 BOM 的 UTF-16LE 中文 CSV", async () => {
    const text = "\uFEFF英文,中文含义\r\nbrittle,脆弱的";
    const bytes = new Uint8Array(text.length * 2);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      bytes[index * 2] = code & 0xff;
      bytes[index * 2 + 1] = code >> 8;
    }
    const buffer = bytes.buffer;
    const workbook = await parseSpreadsheetFile("utf16.csv", buffer);

    expect(workbook.sheets[0].rows[0].values).toEqual([
      "brittle",
      "脆弱的",
    ]);
  });

  it("无法可靠解码的 CSV 明确报错", async () => {
    const invalidUtf8 = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]).buffer;

    await expect(
      parseSpreadsheetFile("gbk.csv", invalidUtf8),
    ).rejects.toThrow("CSV 编码无法可靠识别");
  });
});

describe("文件错误和列映射", () => {
  it("拒绝不支持的文件扩展名", async () => {
    await expect(
      parseSpreadsheetFile("words.txt", csvBuffer("word,meaning")),
    ).rejects.toBeInstanceOf(ImportFileError);
  });

  it("拒绝空文件和损坏文件", async () => {
    await expect(
      parseSpreadsheetFile("empty.csv", new ArrayBuffer(0)),
    ).rejects.toThrow("文件为空");
    await expect(
      parseSpreadsheetFile(
        "broken.xlsx",
        new Uint8Array([1, 2, 3, 4, 5]).buffer,
      ),
    ).rejects.toThrow("可能已损坏");
  });

  it("允许手动选择不同列，并拒绝映射到同一列", async () => {
    const workbook = await parseSpreadsheetFile(
      "columns.csv",
      csvBuffer("第一列,第二列\nstudy,学习"),
    );
    const sheet = workbook.sheets[0];

    expect(suggestColumnMapping(sheet)).toEqual({
      wordColumn: null,
      meaningColumn: null,
    });
    expect(
      validateColumnMapping(sheet, {
        sheetName: sheet.name,
        wordColumn: 0,
        meaningColumn: 1,
      }),
    ).toBeNull();
    expect(
      validateColumnMapping(sheet, {
        sheetName: sheet.name,
        wordColumn: 0,
        meaningColumn: 0,
      }),
    ).toContain("不能相同");
  });
});

