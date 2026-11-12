import { deleteDB } from "idb";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type AppDatabase,
  type Repositories,
} from "../../data";
import { decideImportGroups } from "./importAnalysis";
import type { SheetColumnMapping } from "./spreadsheetParser";
import { WordImportService } from "./wordImportService";

let database: AppDatabase;
let repositories: Repositories;
let service: WordImportService;
let databaseName: string;
let currentTime: number;
let sequence: number;
let databaseSequence = 0;

const mapping: SheetColumnMapping = {
  sheetName: "CSV",
  wordColumn: 0,
  meaningColumn: 1,
};

function csv(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-import-service-test-${databaseSequence}`;
  currentTime = Date.UTC(2026, 0, 1, 4, 0, 0);
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => currentTime,
    createId: () => {
      sequence += 1;
      return `import-id-${sequence}`;
    },
  });
  service = new WordImportService(repositories);
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

describe("导入服务", () => {
  it("解析、分析并新增 CSV 单词", async () => {
    const workbook = await service.parseFile(
      "words.csv",
      csv("英文,中文含义\nabandon,放弃\nbrittle,脆弱的"),
    );
    const analysis = await service.analyze(workbook, [mapping]);
    const decisions = decideImportGroups(analysis, {
      existingConflictMode: "keep",
      selectedFileMeanings: {},
      manualExistingDecisions: {},
    });

    const result = await service.execute(decisions);

    expect(result).toEqual({ createdCount: 2, updatedCount: 0 });
    await expect(repositories.words.list()).resolves.toHaveLength(2);
  });

  it("更新释义保留显示形式、学习状态、历史和分组关联", async () => {
    const word = await repositories.words.create({
      displayWord: "Abandon",
      chineseMeaning: "放弃",
    });
    const group = await repositories.groups.create("阅读");
    await repositories.wordGroups.add(word.id, group.id);
    const state = await repositories.reviewStates.create(word.id);
    await repositories.learningHistory.add({
      wordId: word.id,
      mode: "english-to-chinese",
      source: "global",
      groupId: null,
      feedback: "fuzzy",
      feedbackOccurredAtMs: currentTime,
      stateBefore: null,
      stateAfter: null,
    });
    const workbook = await service.parseFile(
      "conflict.csv",
      csv("英文,中文含义\nabandon,遗弃"),
    );
    const analysis = await service.analyze(workbook, [mapping]);
    const decisions = decideImportGroups(analysis, {
      existingConflictMode: "update",
      selectedFileMeanings: {},
      manualExistingDecisions: {},
    });

    await expect(service.execute(decisions)).resolves.toEqual({
      createdCount: 0,
      updatedCount: 1,
    });
    await expect(repositories.words.getById(word.id)).resolves.toMatchObject({
      id: word.id,
      displayWord: "Abandon",
      normalizedWord: "abandon",
      chineseMeaning: "遗弃",
    });
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(1);
    await expect(
      repositories.wordGroups.getByPair(word.id, group.id),
    ).resolves.not.toBeNull();
  });

  it("重复导入相同文件不创建重复单词或重置进度", async () => {
    const payload = csv("英文,中文含义\nstudy,学习");
    const workbook = await service.parseFile("repeat.csv", payload);
    const firstAnalysis = await service.analyze(workbook, [mapping]);
    const firstDecisions = decideImportGroups(firstAnalysis, {
      existingConflictMode: "keep",
      selectedFileMeanings: {},
      manualExistingDecisions: {},
    });
    await service.execute(firstDecisions);
    const word = (await repositories.words.list())[0];
    const state = await repositories.reviewStates.create(word.id);

    const secondAnalysis = await service.analyze(workbook, [mapping]);
    const secondDecisions = decideImportGroups(secondAnalysis, {
      existingConflictMode: "update",
      selectedFileMeanings: {},
      manualExistingDecisions: {},
    });
    const result = await service.execute(secondDecisions);

    expect(result).toEqual({ createdCount: 0, updatedCount: 0 });
    await expect(repositories.words.list()).resolves.toHaveLength(1);
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
  });

  it("导入批次遇到后置失败时整体回滚", async () => {
    await expect(
      repositories.words.applyImportBatch([
        {
          type: "create",
          displayWord: "temporary",
          chineseMeaning: "临时的",
        },
        {
          type: "update-meaning",
          wordId: "missing-word",
          chineseMeaning: "不应写入",
        },
      ]),
    ).rejects.toThrow("未写入任何导入数据");

    await expect(
      repositories.words.getByNormalizedWord("temporary"),
    ).resolves.toBeNull();
  });
});

