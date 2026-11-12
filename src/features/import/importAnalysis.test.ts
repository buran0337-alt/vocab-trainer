import { describe, expect, it } from "vitest";

import type { Word } from "../../data";
import {
  analyzeImport,
  countUnresolvedDecisions,
  createImportActions,
  decideImportGroups,
  type ImportResolutionState,
} from "./importAnalysis";
import type {
  ParsedSheet,
  ParsedWorkbook,
  SheetColumnMapping,
} from "./spreadsheetParser";

function existingWord(
  normalizedWord: string,
  chineseMeaning: string,
): Word {
  return {
    id: `id-${normalizedWord}`,
    displayWord: normalizedWord.toUpperCase(),
    normalizedWord,
    chineseMeaning,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function sheet(
  name: string,
  rows: Array<[string, string]>,
): ParsedSheet {
  return {
    name,
    columns: [
      { index: 0, name: "英文", label: "A · 英文" },
      { index: 1, name: "中文含义", label: "B · 中文含义" },
    ],
    rows: rows.map(([word, meaning], index) => ({
      rowNumber: index + 2,
      values: [word, meaning],
    })),
  };
}

function workbook(sheets: ParsedSheet[]): ParsedWorkbook {
  return {
    fileName: "test.xlsx",
    kind: "excel",
    sheets,
  };
}

function mapping(sheetName: string): SheetColumnMapping {
  return { sheetName, wordColumn: 0, meaningColumn: 1 };
}

const defaultResolution = (
  mode: ImportResolutionState["existingConflictMode"] = "manual",
): ImportResolutionState => ({
  existingConflictMode: mode,
  selectedFileMeanings: {},
  manualExistingDecisions: {},
});

describe("导入预览分类", () => {
  it("区分新增、已有相同、已有冲突、无效和空行", () => {
    const input = workbook([
      sheet("词汇", [
        ["newWord", "新的"],
        ["study", "研究"],
        ["", "缺少英文"],
        ["", ""],
        ["valid", "有效"],
      ]),
    ]);
    const analysis = analyzeImport(
      input,
      [mapping("词汇")],
      [existingWord("study", "学习")],
    );

    expect(analysis.rows.map((row) => row.status)).toEqual([
      "new",
      "existing-conflict",
      "invalid",
      "empty",
      "new",
    ]);
    expect(analysis.invalidRowCount).toBe(1);
    expect(analysis.emptyRowCount).toBe(1);
  });

  it("全角、大小写重复归为一组，不同词形分开", () => {
    const input = workbook([
      sheet("词汇", [
        ["ＡＢＣ", "字母"],
        [" abc ", "字母"],
        ["study", "学习"],
        ["studies", "研究"],
      ]),
    ]);
    const analysis = analyzeImport(input, [mapping("词汇")], []);

    expect(analysis.groups).toHaveLength(3);
    expect(
      analysis.rows.find((row) => row.displayWord === " abc ")?.status,
    ).toBe("file-duplicate-same");
  });

  it("同一文件内同词不同释义全部标记为需选择", () => {
    const input = workbook([
      sheet("词汇", [
        ["abandon", "放弃"],
        ["abandon", "抛弃"],
        ["abandon", "放弃"],
      ]),
    ]);
    const analysis = analyzeImport(input, [mapping("词汇")], []);
    const group = analysis.groups[0];
    const decisions = decideImportGroups(
      analysis,
      defaultResolution(),
    );

    expect(group.hasFileConflict).toBe(true);
    expect(group.meanings).toEqual(["放弃", "抛弃"]);
    expect(analysis.rows.map((row) => row.status)).toEqual([
      "file-conflict",
      "file-conflict",
      "file-duplicate-same",
    ]);
    expect(decisionType(decisions[0])).toBe("unresolved");
  });

  it("文件内冲突与已有释义冲突可以同时识别", () => {
    const input = workbook([
      sheet("词汇", [
        ["abandon", "放弃"],
        ["abandon", "遗弃"],
      ]),
    ]);
    const analysis = analyzeImport(
      input,
      [mapping("词汇")],
      [existingWord("abandon", "抛弃")],
    );

    expect(analysis.groups[0].hasFileConflict).toBe(true);
    expect(analysis.groups[0].hasExistingConflict).toBe(true);
    expect(analysis.existingConflictGroupCount).toBe(1);
    expect(analysis.fileConflictGroupCount).toBe(1);
  });

  it("多个工作表使用各自列映射，忽略未选工作表", () => {
    const input = workbook([
      sheet("A", [["alpha", "阿尔法"]]),
      sheet("B", [["beta", "贝塔"]]),
    ]);
    const analysis = analyzeImport(input, [mapping("B")], []);

    expect(analysis.groups).toHaveLength(1);
    expect(analysis.groups[0].normalizedWord).toBe("beta");
    expect(analysis.rows[0].sheetName).toBe("B");
  });
});

describe("冲突决策", () => {
  it("全部保留时不更新已有释义", () => {
    const input = workbook([
      sheet("词汇", [["abandon", "遗弃"]]),
    ]);
    const analysis = analyzeImport(
      input,
      [mapping("词汇")],
      [existingWord("abandon", "放弃")],
    );
    const decisions = decideImportGroups(
      analysis,
      defaultResolution("keep"),
    );

    expect(decisionType(decisions[0])).toBe("skip");
    expect(createImportActions(decisions)).toEqual([]);
  });

  it("全部更新时生成只更新释义的动作", () => {
    const input = workbook([
      sheet("词汇", [["abandon", "遗弃"]]),
    ]);
    const analysis = analyzeImport(
      input,
      [mapping("词汇")],
      [existingWord("abandon", "放弃")],
    );
    const decisions = decideImportGroups(
      analysis,
      defaultResolution("update"),
    );

    expect(createImportActions(decisions)).toEqual([
      {
        type: "update-meaning",
        wordId: "id-abandon",
        chineseMeaning: "遗弃",
      },
    ]);
  });

  it("逐项选择默认保留，也可单独更新", () => {
    const input = workbook([
      sheet("词汇", [
        ["abandon", "遗弃"],
        ["brittle", "易碎"],
      ]),
    ]);
    const analysis = analyzeImport(
      input,
      [mapping("词汇")],
      [
        existingWord("abandon", "放弃"),
        existingWord("brittle", "脆弱的"),
      ],
    );
    const resolution = defaultResolution();
    resolution.manualExistingDecisions.brittle = "update";
    const decisions = decideImportGroups(analysis, resolution);

    expect(decisions.map((decision) => decision.type)).toEqual([
      "skip",
      "update-meaning",
    ]);
  });

  it("文件内冲突选择最终释义后只生成一个动作", () => {
    const input = workbook([
      sheet("词汇", [
        ["abandon", "放弃"],
        ["abandon", "遗弃"],
      ]),
    ]);
    const analysis = analyzeImport(input, [mapping("词汇")], []);
    const resolution = defaultResolution();
    resolution.selectedFileMeanings.abandon = "遗弃";
    const decisions = decideImportGroups(analysis, resolution);

    expect(createImportActions(decisions)).toEqual([
      {
        type: "create",
        displayWord: "abandon",
        chineseMeaning: "遗弃",
      },
    ]);
  });

  it("文件内冲突同时更新已有单词时使用选定释义", () => {
    const input = workbook([
      sheet("词汇", [
        ["abandon", "放弃"],
        ["abandon", "遗弃"],
      ]),
    ]);
    const analysis = analyzeImport(
      input,
      [mapping("词汇")],
      [existingWord("abandon", "抛弃")],
    );
    const resolution = defaultResolution("update");
    resolution.selectedFileMeanings.abandon = "遗弃";
    const decisions = decideImportGroups(analysis, resolution);

    expect(createImportActions(decisions)).toEqual([
      {
        type: "update-meaning",
        wordId: "id-abandon",
        chineseMeaning: "遗弃",
      },
    ]);
  });

  it("文件内冲突未选择时无法进入导入", () => {
    const input = workbook([
      sheet("词汇", [
        ["abandon", "放弃"],
        ["abandon", "遗弃"],
      ]),
    ]);
    const analysis = analyzeImport(input, [mapping("词汇")], []);
    const decisions = decideImportGroups(
      analysis,
      defaultResolution(),
    );
    const invalidSelectionDecisions = decideImportGroups(analysis, {
      ...defaultResolution(),
      selectedFileMeanings: { abandon: "不存在" },
    });

    expect(countUnresolvedDecisions(decisions)).toBe(1);
    expect(countUnresolvedDecisions(invalidSelectionDecisions)).toBe(1);
  });
});

function decisionType(
  decision: ReturnType<typeof decideImportGroups>[number],
): string {
  return decision.type;
}

