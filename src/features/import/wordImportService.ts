import type { Repositories } from "../../data";
import {
  analyzeImport,
  createImportActions,
  type ImportAnalysis,
  type ImportGroupDecision,
} from "./importAnalysis";
import {
  parseSpreadsheetFile,
  type ParsedWorkbook,
  type SheetColumnMapping,
} from "./spreadsheetParser";

export interface ImportExecutionResult {
  createdCount: number;
  updatedCount: number;
}

export class WordImportService {
  private readonly repositories: Repositories;

  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }

  async parseFile(
    fileName: string,
    buffer: ArrayBuffer,
  ): Promise<ParsedWorkbook> {
    return parseSpreadsheetFile(fileName, buffer);
  }

  async analyze(
    workbook: ParsedWorkbook,
    mappings: SheetColumnMapping[],
  ): Promise<ImportAnalysis> {
    return analyzeImport(
      workbook,
      mappings,
      await this.repositories.words.list(),
    );
  }

  async execute(
    decisions: ImportGroupDecision[],
  ): Promise<ImportExecutionResult> {
    if (decisions.some((decision) => decision.type === "unresolved")) {
      throw new Error("仍有单词没有完成冲突选择，不能导入。");
    }

    const actions = createImportActions(decisions);
    return this.repositories.words.applyImportBatch(actions);
  }
}

