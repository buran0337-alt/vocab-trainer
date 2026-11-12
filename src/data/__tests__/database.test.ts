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
  DATABASE_MIGRATIONS,
  DATABASE_VERSION,
  DatabaseOpenError,
  DataConflictError,
  DataValidationError,
  openDatabase,
  runTransaction,
  toBeijingDate,
  type AppDatabase,
  type AppStoreName,
  type Repositories,
  type ReviewState,
  type ReviewStateSnapshot,
  type Word,
} from "../index";

const OBJECT_STORES = [
  "words",
  "groups",
  "wordGroups",
  "reviewStates",
  "learningHistory",
  "dailyTasks",
  "settings",
];

let database: AppDatabase;
let repositories: Repositories;
let databaseName: string;
let sequence: number;
let currentTime: number;
let databaseSequence = 0;

function nextId(): string {
  sequence += 1;
  return `test-id-${sequence}`;
}

function createSnapshot(state: ReviewState): ReviewStateSnapshot {
  return {
    ef: state.ef,
    consecutiveSuccesses: state.consecutiveSuccesses,
    consecutiveForgets: state.consecutiveForgets,
    weakScore: state.weakScore,
    intervalMinutes: state.intervalMinutes,
    lastFeedbackAtMs: state.lastFeedbackAtMs,
    nextReviewAtMs: state.nextReviewAtMs,
  };
}

async function createWordAndGroup(): Promise<{
  word: Word;
  groupId: string;
}> {
  const word = await repositories.words.create({
    displayWord: "Abandon",
    chineseMeaning: "放弃；抛弃",
  });
  const group = await repositories.groups.create("阅读词汇");
  return { word, groupId: group.id };
}

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-test-${databaseSequence}`;
  sequence = 0;
  currentTime = Date.UTC(2026, 0, 1, 4, 0, 0);
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => currentTime,
    createId: nextId,
  });
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

describe("数据库创建与升级", () => {
  it("创建当前版本和全部 object store", () => {
    expect(database.version).toBe(DATABASE_VERSION);
    expect(Array.from(database.objectStoreNames)).toEqual(
      expect.arrayContaining(OBJECT_STORES),
    );
  });

  it("建立查询所需的全部索引", async () => {
    const expectedIndexes: Record<AppStoreName, string[]> = {
      words: ["byNormalizedWord", "byCreatedAtMs"],
      groups: ["byName", "byCreatedAtMs"],
      wordGroups: ["byWordGroup", "byWordId", "byGroupId"],
      reviewStates: ["byNextReviewAtMs", "byUpdatedAtMs"],
      learningHistory: [
        "byWordId",
        "byWordAndFeedbackAt",
        "byFeedbackAtMs",
        "byBeijingDate",
        "bySourceAndBeijingDate",
        "byGroupId",
      ],
      dailyTasks: ["byUpdatedAtMs"],
      settings: [],
    };

    for (const [storeName, indexNames] of Object.entries(
      expectedIndexes,
    ) as [AppStoreName, string[]][]) {
      const transaction = database.transaction(storeName, "readonly");
      expect(Array.from(transaction.store.indexNames)).toEqual(
        expect.arrayContaining(indexNames),
      );
      await transaction.done;
    }
  });

  it("通过版本迁移入口升级且不破坏已有单词", async () => {
    const word = await repositories.words.create({
      displayWord: "meticulous",
      chineseMeaning: "一丝不苟的",
    });

    closeDatabase(database);
    database = await openDatabase({
      name: databaseName,
      version: 2,
      migrations: {
        ...DATABASE_MIGRATIONS,
        2() {
          // A future release would add stores or indexes here.
        },
      },
    });
    repositories = createRepositories(database, {
      now: () => currentTime,
      createId: nextId,
    });

    expect(database.version).toBe(2);
    await expect(repositories.words.getById(word.id)).resolves.toEqual(word);
  });

  it("数据库打开参数错误时返回可理解的打开错误", async () => {
    await expect(
      openDatabase({
        name: `${databaseName}-invalid`,
        version: 0,
      }),
    ).rejects.toBeInstanceOf(DatabaseOpenError);
  });
});

describe("单词数据", () => {
  it("保存显示形式并使用独立标准化形式查询", async () => {
    const word = await repositories.words.create({
      displayWord: "  Abandon  ",
      chineseMeaning: "放弃；抛弃",
    });

    expect(word.displayWord).toBe("  Abandon  ");
    expect(word.normalizedWord).toBe("abandon");
    await expect(repositories.words.getById(word.id)).resolves.toEqual(word);
    await expect(
      repositories.words.getByNormalizedWord(" abandon "),
    ).resolves.toEqual(word);
  });

  it("同一标准化形式不能产生重复单词", async () => {
    await repositories.words.create({
      displayWord: "ＡＢＣ",
      chineseMeaning: "甲",
    });

    await expect(
      repositories.words.create({
        displayWord: " abc ",
        chineseMeaning: "乙",
      }),
    ).rejects.toBeInstanceOf(DataConflictError);
  });

  it("不同词形分别保存", async () => {
    await repositories.words.create({
      displayWord: "study",
      chineseMeaning: "学习",
    });
    await repositories.words.create({
      displayWord: "studies",
      chineseMeaning: "研究；学习（复数形式）",
    });

    await expect(repositories.words.list()).resolves.toHaveLength(2);
  });

  it("数据写入入口拒绝超过长度限制的单词和释义", async () => {
    await expect(
      repositories.words.create({
        displayWord: "a".repeat(101),
        chineseMeaning: "有效释义",
      }),
    ).rejects.toBeInstanceOf(DataValidationError);
    await expect(
      repositories.words.create({
        displayWord: "valid",
        chineseMeaning: "释".repeat(2001),
      }),
    ).rejects.toBeInstanceOf(DataValidationError);
  });

  it("修改单词释义不会覆盖复习状态", async () => {
    const word = await repositories.words.create({
      displayWord: "abandon",
      chineseMeaning: "放弃",
    });
    const state = await repositories.reviewStates.create(word.id);

    await repositories.words.update(word.id, {
      chineseMeaning: "放弃；抛弃",
    });

    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
  });
});

describe("分组与关联", () => {
  it("分组名称去除首尾空格、区分大小写并阻止重复", async () => {
    const review = await repositories.groups.create(" Review ");
    const lowercase = await repositories.groups.create("review");

    expect(review.name).toBe("Review");
    expect(lowercase.name).toBe("review");
    await expect(
      repositories.groups.create("Review  "),
    ).rejects.toBeInstanceOf(DataConflictError);
  });

  it("分组写入入口拒绝空名称和超过 50 个字符的名称", async () => {
    await expect(
      repositories.groups.create("   "),
    ).rejects.toBeInstanceOf(DataValidationError);
    await expect(
      repositories.groups.create("组".repeat(51)),
    ).rejects.toBeInstanceOf(DataValidationError);
  });

  it("同一单词不能重复加入同一分组", async () => {
    const { word, groupId } = await createWordAndGroup();
    await repositories.wordGroups.add(word.id, groupId);

    await expect(
      repositories.wordGroups.add(word.id, groupId),
    ).rejects.toBeInstanceOf(DataConflictError);
  });

  it("删除分组关联不会删除单词或复习状态", async () => {
    const { word, groupId } = await createWordAndGroup();
    await repositories.wordGroups.add(word.id, groupId);
    const state = await repositories.reviewStates.create(word.id);

    await expect(
      repositories.wordGroups.remove(word.id, groupId),
    ).resolves.toBe(true);
    await expect(repositories.words.getById(word.id)).resolves.not.toBeNull();
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
  });

  it("按分组 ID 查询单词", async () => {
    const { word, groupId } = await createWordAndGroup();
    await repositories.wordGroups.add(word.id, groupId);

    await expect(
      repositories.wordGroups.getWordsForGroup(groupId),
    ).resolves.toEqual([word]);
  });

  it("删除分组只删除组和关联，不删除单词或复习状态", async () => {
    const { word, groupId } = await createWordAndGroup();
    await repositories.wordGroups.add(word.id, groupId);
    const state = await repositories.reviewStates.create(word.id);

    await repositories.groups.delete(groupId);

    await expect(repositories.groups.getById(groupId)).resolves.toBeNull();
    await expect(
      repositories.wordGroups.listForGroup(groupId),
    ).resolves.toEqual([]);
    await expect(repositories.words.getById(word.id)).resolves.not.toBeNull();
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
  });
});

describe("复习状态与学习历史", () => {
  it("每个单词只有一份初始 EF 为 2.5 的复习状态", async () => {
    const word = await repositories.words.create({
      displayWord: "brittle",
      chineseMeaning: "脆弱的",
    });
    const state = await repositories.reviewStates.create(word.id);

    expect(state.ef).toBe(2.5);
    expect(state.consecutiveSuccesses).toBe(0);
    expect(state.weakScore).toBe(0);
    await expect(
      repositories.reviewStates.create(word.id),
    ).rejects.toBeInstanceOf(DataConflictError);
  });

  it("多条学习历史独立保存，更新状态不修改旧历史", async () => {
    const word = await repositories.words.create({
      displayWord: "diligent",
      chineseMeaning: "勤奋的",
    });
    const initialState = await repositories.reviewStates.create(word.id);
    const first = await repositories.learningHistory.add({
      wordId: word.id,
      mode: "english-to-chinese",
      source: "global",
      groupId: null,
      feedback: "fuzzy",
      feedbackOccurredAtMs: currentTime,
      stateBefore: createSnapshot(initialState),
      stateAfter: createSnapshot(initialState),
    });
    currentTime += 60_000;
    const changedState = await repositories.reviewStates.update(word.id, {
      consecutiveForgets: 1,
      weakScore: 3,
    });
    const second = await repositories.learningHistory.add({
      wordId: word.id,
      mode: "chinese-to-english",
      source: "weak",
      groupId: null,
      feedback: "forgotten",
      feedbackOccurredAtMs: currentTime,
      stateBefore: createSnapshot(initialState),
      stateAfter: createSnapshot(changedState),
    });

    const histories =
      await repositories.learningHistory.listForWord(word.id);

    expect(histories.map((history) => history.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(histories[0]).toEqual(first);
    expect(histories[0].stateAfter).toEqual(createSnapshot(initialState));
    await expect(
      repositories.learningHistory.listByBeijingDate(first.beijingDate),
    ).resolves.toEqual(expect.arrayContaining([first, second]));
  });

  it("分组学习历史必须引用存在的分组", async () => {
    const word = await repositories.words.create({
      displayWord: "coherent",
      chineseMeaning: "连贯的",
    });

    await expect(
      repositories.learningHistory.add({
        wordId: word.id,
        mode: "english-to-chinese",
        source: "group",
        groupId: "missing-group",
        feedback: "remembered",
        feedbackOccurredAtMs: currentTime,
        stateBefore: null,
        stateAfter: null,
      }),
    ).rejects.toThrow("不存在的分组");
  });

  it("可以通过到期时间索引查询已有到期时间的复习状态", async () => {
    const firstWord = await repositories.words.create({
      displayWord: "prompt",
      chineseMeaning: "及时的",
    });
    const secondWord = await repositories.words.create({
      displayWord: "vivid",
      chineseMeaning: "生动的",
    });
    await repositories.reviewStates.create(firstWord.id);
    await repositories.reviewStates.create(secondWord.id);
    await repositories.reviewStates.update(firstWord.id, {
      nextReviewAtMs: currentTime + 60_000,
    });
    await repositories.reviewStates.update(secondWord.id, {
      nextReviewAtMs: currentTime + 120_000,
    });

    const due = await repositories.reviewStates.listDueAt(
      currentTime + 90_000,
    );

    expect(due.map((state) => state.wordId)).toEqual([firstWord.id]);
  });
});

describe("每日任务与设置", () => {
  it("按北京日期保存和读取每日任务及去重集合", async () => {
    const task = await repositories.dailyTasks.create({
      beijingDate: "2026-01-01",
      baseGoal: 20,
      carryoverTasks: 8,
      nominalTaskCount: 28,
      effectiveTaskCount: 28,
      completedCount: 12,
      completedGlobalNewWordIds: ["word-1", "word-2"],
      completedGlobalReviewWordIds: ["word-3"],
    });

    await expect(
      repositories.dailyTasks.getByDate("2026-01-01"),
    ).resolves.toEqual(task);
  });

  it("每日任务拒绝重复单词 ID 和非法日期", async () => {
    await expect(
      repositories.dailyTasks.create({
        beijingDate: "2026-01-01",
        baseGoal: 20,
        carryoverTasks: 0,
        nominalTaskCount: 20,
        effectiveTaskCount: 20,
        completedCount: 0,
        completedGlobalNewWordIds: ["same", "same"],
        completedGlobalReviewWordIds: [],
      }),
    ).rejects.toBeInstanceOf(DataValidationError);
  });

  it("设置使用北京时间、校验 0–999 目标并支持更新", async () => {
    const settings = await repositories.settings.create(20);

    expect(settings.timeZone).toBe("Asia/Shanghai");
    await expect(
      repositories.settings.updateDailyBaseGoal(30),
    ).resolves.toMatchObject({ dailyBaseGoal: 30 });
    await expect(
      repositories.settings.updateDailyBaseGoal(1000),
    ).rejects.toBeInstanceOf(DataValidationError);
  });
});

describe("时间、事务与持久化", () => {
  it("按北京时间计算跨日边界，不受设备本地时区影响", () => {
    expect(toBeijingDate(Date.parse("2026-07-01T15:59:59.999Z"))).toBe(
      "2026-07-01",
    );
    expect(toBeijingDate(Date.parse("2026-07-01T16:00:00.000Z"))).toBe(
      "2026-07-02",
    );
  });

  it("多 object store 事务失败后全部回滚", async () => {
    const word: Word = {
      id: "rollback-word",
      displayWord: "rollback",
      normalizedWord: "rollback",
      chineseMeaning: "回滚测试",
      createdAtMs: currentTime,
      updatedAtMs: currentTime,
    };

    await expect(
      runTransaction(
        database,
        ["words", "reviewStates"],
        "readwrite",
        async (transaction) => {
          await transaction.objectStore("words").add(word);
          await transaction.objectStore("reviewStates").add({
            wordId: word.id,
            ef: 2.5,
            consecutiveSuccesses: 0,
            consecutiveForgets: 0,
            weakScore: 0,
            intervalMinutes: null,
            lastFeedbackAtMs: null,
            nextReviewAtMs: null,
            createdAtMs: currentTime,
            updatedAtMs: currentTime,
          });
          throw new Error("模拟事务失败");
        },
      ),
    ).rejects.toMatchObject({
      code: "OPERATION",
      message: "数据事务失败，未提交任何更改。",
    });

    await expect(repositories.words.getById(word.id)).resolves.toBeNull();
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toBeNull();
  });

  it("关闭并重新打开数据库后保留已提交数据", async () => {
    const word = await repositories.words.create({
      displayWord: "persistent",
      chineseMeaning: "持久的",
    });

    closeDatabase(database);
    database = await openDatabase({ name: databaseName });
    repositories = createRepositories(database, {
      now: () => currentTime,
      createId: nextId,
    });

    await expect(repositories.words.getById(word.id)).resolves.toEqual(word);
  });

  it("删除单词会级联清理关联、状态和历史，但保留分组", async () => {
    const { word, groupId } = await createWordAndGroup();
    await repositories.wordGroups.add(word.id, groupId);
    await repositories.reviewStates.create(word.id);
    await repositories.learningHistory.add({
      wordId: word.id,
      mode: "english-to-chinese",
      source: "group",
      groupId,
      feedback: "remembered",
      feedbackOccurredAtMs: currentTime,
      stateBefore: null,
      stateAfter: null,
    });

    await repositories.words.delete(word.id);

    await expect(repositories.words.getById(word.id)).resolves.toBeNull();
    await expect(
      repositories.wordGroups.listForWord(word.id),
    ).resolves.toEqual([]);
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toBeNull();
    await expect(
      repositories.learningHistory.listForWord(word.id),
    ).resolves.toEqual([]);
    await expect(repositories.groups.getById(groupId)).resolves.not.toBeNull();
  });

  it("删除不存在的单词返回明确错误", async () => {
    await expect(
      repositories.words.delete("missing-word"),
    ).rejects.toThrow("没有找到要删除的单词");
  });
});
