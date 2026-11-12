import { deleteDB } from "idb";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  closeDatabase,
  createRepositories,
  DataConflictError,
  DataValidationError,
  openDatabase,
  type AppDatabase,
  type Repositories,
} from "../../data";
import {
  validateWordForm,
  WordLibraryService,
} from "./wordLibraryService";

let database: AppDatabase;
let repositories: Repositories;
let service: WordLibraryService;
let databaseName: string;
let currentTime: number;
let sequence: number;
let databaseSequence = 0;

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-word-service-test-${databaseSequence}`;
  currentTime = Date.UTC(2026, 0, 1, 4, 0, 0);
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => currentTime,
    createId: () => {
      sequence += 1;
      return `service-id-${sequence}`;
    },
  });
  service = new WordLibraryService(repositories);
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeDatabase(database);
  await deleteDB(databaseName);
});

describe("单词表单验证", () => {
  it("拒绝空英文单词和空中文释义", () => {
    const errors = validateWordForm({
      displayWord: " ",
      chineseMeaning: "\n",
    });

    expect(errors.displayWord).toContain("不能为空");
    expect(errors.chineseMeaning).toContain("不能为空");
  });

  it("按字符数拒绝超长输入", () => {
    const errors = validateWordForm({
      displayWord: "a".repeat(101),
      chineseMeaning: "释".repeat(2001),
    });

    expect(errors.displayWord).toContain("100");
    expect(errors.chineseMeaning).toContain("2000");
  });
});

describe("手动添加和释义冲突", () => {
  it("列表通过批量读取状态和历史避免逐词查询", async () => {
    const first = await repositories.words.create({
      displayWord: "bulk-one",
      chineseMeaning: "批量一",
    });
    const second = await repositories.words.create({
      displayWord: "bulk-two",
      chineseMeaning: "批量二",
    });
    await repositories.reviewStates.create(first.id);
    await repositories.learningHistory.add({
      wordId: first.id,
      mode: "english-to-chinese",
      source: "global",
      groupId: null,
      feedback: "remembered",
      feedbackOccurredAtMs: currentTime,
      stateBefore: null,
      stateAfter: null,
    });
    const stateLookup = vi.spyOn(
      repositories.reviewStates,
      "getByWordId",
    );
    const historyCount = vi.spyOn(
      repositories.learningHistory,
      "countForWord",
    );

    const items = await service.listWords();

    expect(items).toHaveLength(2);
    expect(items.find((item) => item.word.id === first.id)).toMatchObject({
      learningCount: 1,
      reviewState: { wordId: first.id },
    });
    expect(items.find((item) => item.word.id === second.id)).toMatchObject({
      learningCount: 0,
      reviewState: null,
    });
    expect(stateLookup).not.toHaveBeenCalled();
    expect(historyCount).not.toHaveBeenCalled();
  });

  it("正常添加并保留用户输入的显示形式", async () => {
    const result = await service.addWord({
      displayWord: " Abandon ",
      chineseMeaning: "放弃；抛弃",
    });

    expect(result.status).toBe("created");
    expect(result.word.displayWord).toBe(" Abandon ");
    expect(result.word.normalizedWord).toBe("abandon");
  });

  it("相同单词和相同释义不创建新记录，也不改变显示形式或状态", async () => {
    const first = await repositories.words.create({
      displayWord: "Abandon",
      chineseMeaning: "放弃",
    });
    const state = await repositories.reviewStates.create(first.id);

    const result = await service.addWord({
      displayWord: " abandon ",
      chineseMeaning: "放弃",
    });

    expect(result.status).toBe("unchanged");
    expect(result.word.displayWord).toBe("Abandon");
    await expect(repositories.words.list()).resolves.toHaveLength(1);
    await expect(
      repositories.reviewStates.getByWordId(first.id),
    ).resolves.toEqual(state);
  });

  it("释义冲突默认不改数据，明确更新时只改变释义", async () => {
    const first = await repositories.words.create({
      displayWord: "Abandon",
      chineseMeaning: "放弃",
    });
    const state = await repositories.reviewStates.create(first.id);

    const result = await service.addWord({
      displayWord: "abandon",
      chineseMeaning: "放弃；抛弃",
    });

    expect(result.status).toBe("conflict");
    await expect(repositories.words.getById(first.id)).resolves.toMatchObject({
      displayWord: "Abandon",
      chineseMeaning: "放弃",
    });

    await service.updateMeaning(first.id, "放弃；抛弃");

    await expect(repositories.words.getById(first.id)).resolves.toMatchObject({
      displayWord: "Abandon",
      chineseMeaning: "放弃；抛弃",
    });
    await expect(
      repositories.reviewStates.getByWordId(first.id),
    ).resolves.toEqual(state);
  });

  it("不同词形可以独立创建", async () => {
    await service.addWord({
      displayWord: "study",
      chineseMeaning: "学习",
    });
    await service.addWord({
      displayWord: "studies",
      chineseMeaning: "研究",
    });

    await expect(repositories.words.list()).resolves.toHaveLength(2);
  });
});

describe("编辑单词", () => {
  it("修改大小写后显示形式采用本次输入", async () => {
    const word = await repositories.words.create({
      displayWord: "Abandon",
      chineseMeaning: "放弃",
    });

    const updated = await service.updateWord(word.id, {
      displayWord: "abandon",
      chineseMeaning: "放弃",
    });

    expect(updated.displayWord).toBe("abandon");
    expect(updated.normalizedWord).toBe("abandon");
  });

  it("编辑为已有标准化形式时阻止保存并保留双方状态和历史", async () => {
    const first = await repositories.words.create({
      displayWord: "study",
      chineseMeaning: "学习",
    });
    const second = await repositories.words.create({
      displayWord: "studies",
      chineseMeaning: "研究",
    });
    const firstState = await repositories.reviewStates.create(first.id);
    const secondState = await repositories.reviewStates.create(second.id);
    await repositories.learningHistory.add({
      wordId: first.id,
      mode: "english-to-chinese",
      source: "global",
      groupId: null,
      feedback: "remembered",
      feedbackOccurredAtMs: currentTime,
      stateBefore: null,
      stateAfter: null,
    });
    await repositories.learningHistory.add({
      wordId: second.id,
      mode: "english-to-chinese",
      source: "global",
      groupId: null,
      feedback: "fuzzy",
      feedbackOccurredAtMs: currentTime,
      stateBefore: null,
      stateAfter: null,
    });

    await expect(
      service.updateWord(first.id, {
        displayWord: " Studies ",
        chineseMeaning: "新的释义",
      }),
    ).rejects.toBeInstanceOf(DataConflictError);

    await expect(repositories.words.getById(first.id)).resolves.toEqual(first);
    await expect(repositories.words.getById(second.id)).resolves.toEqual(
      second,
    );
    await expect(
      repositories.reviewStates.getByWordId(first.id),
    ).resolves.toEqual(firstState);
    await expect(
      repositories.reviewStates.getByWordId(second.id),
    ).resolves.toEqual(secondState);
    await expect(
      repositories.learningHistory.countForWord(first.id),
    ).resolves.toBe(1);
    await expect(
      repositories.learningHistory.countForWord(second.id),
    ).resolves.toBe(1);
  });

  it("数据层再次拒绝超长编辑内容", async () => {
    const word = await repositories.words.create({
      displayWord: "valid",
      chineseMeaning: "有效",
    });

    await expect(
      service.updateWord(word.id, {
        displayWord: "a".repeat(101),
        chineseMeaning: "有效",
      }),
    ).rejects.toBeInstanceOf(DataValidationError);
    await expect(repositories.words.getById(word.id)).resolves.toEqual(word);
  });
});

