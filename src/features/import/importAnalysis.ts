import {
  MAX_MEANING_LENGTH,
  MAX_WORD_DISPLAY_LENGTH,
  normalizeEnglishWord,
  textLength,
  type Word,
  type WordImportAction,
} from "../../data";
import {
  validateColumnMapping,
  type ParsedWorkbook,
  type SheetColumnMapping,
} from "./spreadsheetParser";

export type ImportRowStatus =
  | "new"
  | "existing-same"
  | "existing-conflict"
  | "file-duplicate-same"
  | "file-conflict"
  | "invalid"
  | "empty";

export interface ImportPreviewRow {
  id: string;
  sheetName: string;
  rowNumber: number;
  displayWord: string;
  chineseMeaning: string;
  normalizedWord: string;
  status: ImportRowStatus;
  messages: string[];
}

export interface ImportWordGroup {
  normalizedWord: string;
  rows: ImportPreviewRow[];
  meanings: string[];
  existingWord: Word | null;
  hasFileConflict: boolean;
  hasExistingConflict: boolean;
}

export interface ImportAnalysis {
  rows: ImportPreviewRow[];
  groups: ImportWordGroup[];
  newGroupCount: number;
  existingSameGroupCount: number;
  existingConflictGroupCount: number;
  fileConflictGroupCount: number;
  invalidRowCount: number;
  emptyRowCount: number;
}

export interface ExistingConflictResolution {
  mode: "keep" | "update" | "manual";
  manualDecisions: Record<string, "keep" | "update">;
}

export interface ImportResolutionState {
  existingConflictMode: ExistingConflictResolution["mode"];
  selectedFileMeanings: Record<string, string>;
  manualExistingDecisions: Record<string, "keep" | "update">;
}

export type ImportGroupDecisionType =
  | "create"
  | "update-meaning"
  | "skip"
  | "unresolved";

export interface ImportGroupDecision {
  normalizedWord: string;
  type: ImportGroupDecisionType;
  displayWord: string;
  chosenMeaning: string | null;
  existingWordId: string | null;
  reason: string;
}

export function analyzeImport(
  workbook: ParsedWorkbook,
  mappings: SheetColumnMapping[],
  existingWords: Word[],
): ImportAnalysis {
  const existingByNormalized = new Map(
    existingWords.map((word) => [word.normalizedWord, word]),
  );
  const rows: ImportPreviewRow[] = [];

  for (const mapping of mappings) {
    const sheet = workbook.sheets.find(
      (candidate) => candidate.name === mapping.sheetName,
    );
    if (!sheet) {
      throw new Error(`找不到工作表“${mapping.sheetName}”。`);
    }

    const mappingError = validateColumnMapping(sheet, mapping);
    if (mappingError) {
      throw new Error(mappingError);
    }

    for (const sourceRow of sheet.rows) {
      const displayWord =
        sourceRow.values[mapping.wordColumn as number] ?? "";
      const chineseMeaning =
        sourceRow.values[mapping.meaningColumn as number] ?? "";
      const messages: string[] = [];
      let status: ImportRowStatus;

      if (
        displayWord.trim().length === 0 &&
        chineseMeaning.trim().length === 0
      ) {
        status = "empty";
        messages.push("空行，将跳过。");
      } else {
        if (displayWord.trim().length === 0) {
          messages.push("英文单词为空。");
        }
        if (chineseMeaning.trim().length === 0) {
          messages.push("中文释义为空。");
        }
        if (textLength(displayWord) > MAX_WORD_DISPLAY_LENGTH) {
          messages.push(
            `英文单词超过 ${MAX_WORD_DISPLAY_LENGTH} 个字符。`,
          );
        }
        if (textLength(chineseMeaning) > MAX_MEANING_LENGTH) {
          messages.push(
            `中文释义超过 ${MAX_MEANING_LENGTH} 个字符。`,
          );
        }
        if (
          displayWord.includes("\uFFFD") ||
          chineseMeaning.includes("\uFFFD")
        ) {
          messages.push("内容包含无法识别的乱码字符。");
        }

        status = messages.length > 0 ? "invalid" : "new";
      }

      rows.push({
        id: `${mapping.sheetName}:${sourceRow.rowNumber}`,
        sheetName: sheet.name,
        rowNumber: sourceRow.rowNumber,
        displayWord,
        chineseMeaning,
        normalizedWord:
          messages.length === 0
            ? normalizeEnglishWord(displayWord)
            : "",
        status,
        messages,
      });
    }
  }

  const groupsByWord = new Map<string, ImportPreviewRow[]>();
  for (const row of rows) {
    if (row.status === "invalid" || row.status === "empty") {
      continue;
    }
    const group = groupsByWord.get(row.normalizedWord) ?? [];
    group.push(row);
    groupsByWord.set(row.normalizedWord, group);
  }

  const groups: ImportWordGroup[] = [];

  for (const [normalizedWord, groupRows] of groupsByWord) {
    const meanings = Array.from(
      new Set(groupRows.map((row) => row.chineseMeaning)),
    );
    const existingWord = existingByNormalized.get(normalizedWord) ?? null;
    const hasFileConflict = meanings.length > 1;
    const hasExistingConflict =
      existingWord !== null &&
      meanings.some(
        (meaning) => meaning !== existingWord.chineseMeaning,
      );
    const firstRowByMeaning = new Map<string, string>();

    for (const row of groupRows) {
      if (!firstRowByMeaning.has(row.chineseMeaning)) {
        firstRowByMeaning.set(row.chineseMeaning, row.id);
      }
    }

    for (const row of groupRows) {
      const isFirstForMeaning =
        firstRowByMeaning.get(row.chineseMeaning) === row.id;

      if (!isFirstForMeaning) {
        row.status = "file-duplicate-same";
        row.messages = ["同一文件中的相同释义重复，将跳过后出现的行。"];
      } else if (hasFileConflict) {
        row.status = "file-conflict";
        row.messages = ["同一单词在文件中存在多个不同释义，需要选择最终释义。"];
      } else if (existingWord) {
        row.status =
          row.chineseMeaning === existingWord.chineseMeaning
            ? "existing-same"
            : "existing-conflict";
        row.messages = [
          row.chineseMeaning === existingWord.chineseMeaning
            ? "词库已有相同单词和释义，将跳过。"
            : "词库已有相同单词但释义不同，需选择是否更新。",
        ];
      } else {
        row.status = "new";
        row.messages = ["将新增此单词。"];
      }
    }

    groups.push({
      normalizedWord,
      rows: groupRows,
      meanings,
      existingWord,
      hasFileConflict,
      hasExistingConflict,
    });
  }

  return {
    rows,
    groups,
    newGroupCount: groups.filter(
      (group) => group.existingWord === null,
    ).length,
    existingSameGroupCount: groups.filter(
      (group) =>
        group.existingWord !== null &&
        !group.hasExistingConflict &&
        !group.hasFileConflict,
    ).length,
    existingConflictGroupCount: groups.filter(
      (group) => group.hasExistingConflict,
    ).length,
    fileConflictGroupCount: groups.filter(
      (group) => group.hasFileConflict,
    ).length,
    invalidRowCount: rows.filter((row) => row.status === "invalid").length,
    emptyRowCount: rows.filter((row) => row.status === "empty").length,
  };
}

function firstRowForMeaning(
  group: ImportWordGroup,
  meaning: string,
): ImportPreviewRow {
  return (
    group.rows.find((row) => row.chineseMeaning === meaning) ??
    group.rows[0]
  );
}

export function decideImportGroups(
  analysis: ImportAnalysis,
  resolution: ImportResolutionState,
): ImportGroupDecision[] {
  return analysis.groups.map((group) => {
    if (group.hasFileConflict) {
      const selectedMeaning =
        resolution.selectedFileMeanings[group.normalizedWord];
      if (
        !selectedMeaning ||
        !group.meanings.includes(selectedMeaning)
      ) {
        return {
          normalizedWord: group.normalizedWord,
          type: "unresolved",
          displayWord: group.rows[0].displayWord,
          chosenMeaning: null,
          existingWordId: group.existingWord?.id ?? null,
          reason: "请先选择该单词在文件中采用的最终释义。",
        };
      }
    }

    const chosenMeaning = group.hasFileConflict
      ? resolution.selectedFileMeanings[group.normalizedWord]
      : group.meanings[0];
    const sourceRow = firstRowForMeaning(group, chosenMeaning as string);

    if (!group.existingWord) {
      return {
        normalizedWord: group.normalizedWord,
        type: "create",
        displayWord: sourceRow.displayWord,
        chosenMeaning,
        existingWordId: null,
        reason: "新增单词。",
      };
    }

    if (chosenMeaning === group.existingWord.chineseMeaning) {
      return {
        normalizedWord: group.normalizedWord,
        type: "skip",
        displayWord: group.existingWord.displayWord,
        chosenMeaning,
        existingWordId: group.existingWord.id,
        reason: "最终释义与原释义相同，无需更新。",
      };
    }

    const effectiveMode: ExistingConflictResolution["mode"] =
      resolution.existingConflictMode;
    const useUpdate =
      effectiveMode === "update" ||
      (effectiveMode === "manual" &&
        resolution.manualExistingDecisions[group.normalizedWord] ===
          "update");

    return {
      normalizedWord: group.normalizedWord,
      type: useUpdate ? "update-meaning" : "skip",
      displayWord: group.existingWord.displayWord,
      chosenMeaning,
      existingWordId: group.existingWord.id,
      reason: useUpdate
        ? "更新已有单词的中文释义，保留显示形式、学习状态和历史。"
        : "保留已有中文释义，跳过本次导入。",
    };
  });
}

export function countUnresolvedDecisions(
  decisions: ImportGroupDecision[],
): number {
  return decisions.filter((decision) => decision.type === "unresolved")
    .length;
}

export function createImportActions(
  decisions: ImportGroupDecision[],
): WordImportAction[] {
  const actions: WordImportAction[] = [];

  for (const decision of decisions) {
    if (decision.type === "create" && decision.chosenMeaning !== null) {
      actions.push({
        type: "create",
        displayWord: decision.displayWord,
        chineseMeaning: decision.chosenMeaning,
      });
    } else if (
      decision.type === "update-meaning" &&
      decision.chosenMeaning !== null &&
      decision.existingWordId !== null
    ) {
      actions.push({
        type: "update-meaning",
        wordId: decision.existingWordId,
        chineseMeaning: decision.chosenMeaning,
      });
    }
  }

  return actions;
}

