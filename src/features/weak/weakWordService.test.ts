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
  openDatabase,
  type AppDatabase,
  type Repositories,
} from "../../data";
import { DailyProgressService } from "../daily/dailyProgressService";
import { GroupLibraryService } from "../groups/groupLibraryService";
import { LearningSessionService } from "../learning/learningSessionService";
import {
  sortWeakWordItems,
  WeakWordService,
  type WeakWordItem,
} from "./weakWordService";

let database: AppDatabase;
let repositories: Repositories;
let learningService: LearningSessionService;
let weakService: WeakWordService;
let dailyService: DailyProgressService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const NOW = Date.UTC(2026, 0, 1, 4, 0, 40);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-weak-service-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => NOW,
    createId: () => {
      sequence += 1;
      return `weak-test-id-${sequence}`;
    },
  });
  await repositories.settings.create(20);
  learningService = new LearningSessionService(repositories, {
    createId: () => {
      sequence += 1;
      return `weak-learning-submission-${sequence}`;
    },
  });
  weakService = new WeakWordService(repositories, {
    createId: () => {
      sequence += 1;
      return `weak-submission-${sequence}`;
    },
  });
  dailyService = new DailyProgressService(repositories);
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeDatabase(database);
  await deleteDB(databaseName);
});

describe("薄弱词评分与排序", () => {
  it("从全部历史累计评分，并排除未学习或无薄弱分的词", async () => {
    const weakWord = await repositories.words.create({
      displayWord: "weak-history",
      chineseMeaning: "历史薄弱的",
    });
    const group = await repositories.groups.create("历史分组");
    await repositories.wordGroups.add(weakWord.id, group.id);
    await repositories.reviewStates.create(weakWord.id);
    await repositories.reviewStates.update(weakWord.id, {
      consecutiveForgets: 2,
      ef: 1.8,
    });
    await repositories.learningHistory.add({
      wordId: weakWord.id,
      mode: "english-to-chinese",
      source: "global",
      groupId: null,
      feedback: "forgotten",
      feedbackOccurredAtMs: NOW - 90 * DAY,
      stateBefore: null,
      stateAfter: null,
    });
    await repositories.learningHistory.add({
      wordId: weakWord.id,
      mode: "english-to-chinese",
      source: "group",
      groupId: group.id,
      feedback: "fuzzy",
      feedbackOccurredAtMs: NOW - 30 * DAY,
      stateBefore: null,
      stateAfter: null,
    });
    await repositories.learningHistory.add({
      wordId: weakWord.id,
      mode: "english-to-chinese",
      source: "weak",
      groupId: null,
      feedback: "remembered",
      feedbackOccurredAtMs: NOW,
      stateBefore: null,
      stateAfter: null,
    });

    const zeroScoreWord = await repositories.words.create({
      displayWord: "only-remembered",
      chineseMeaning: "只记住过",
    });
    await repositories.reviewStates.create(zeroScoreWord.id);
    await repositories.learningHistory.add({
      wordId: zeroScoreWord.id,
      mode: "english-to-chinese",
      source: "global",
      groupId: null,
      feedback: "remembered",
      feedbackOccurredAtMs: NOW,
      stateBefore: null,
      stateAfter: null,
    });
    await repositories.words.create({
      displayWord: "never-learned",
      chineseMeaning: "从未学习",
    });

    const items = await weakService.list();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      word: { id: weakWord.id },
      weakScore: 4,
      historyCount: 3,
      lastLearnedAtMs: NOW,
      reviewState: {
        consecutiveForgets: 2,
        ef: 1.8,
      },
    });
    await expect(weakService.count()).resolves.toBe(1);
  });

  it("依次按薄弱分、连续忘记、EF、学习时间和英文显示形式稳定排序", () => {
    const items = [
      createItem("zeta", 1, 0, 2, NOW - 1000),
      createItem("newer", 1, 0, 2, NOW),
      createItem("older", 1, 0, 2, NOW - 5000),
      createItem("lower-ef", 1, 0, 1.5, NOW),
      createItem("more-forgets", 1, 2, 2.5, NOW),
      createItem("highest", 5, 0, 2.5, NOW),
    ];
    items.push(createItem("alpha", 1, 0, 2, NOW - 1000));

    expect(
      sortWeakWordItems(items).map((item) => item.word.displayWord),
    ).toEqual([
      "highest",
      "more-forgets",
      "lower-ef",
      "older",
      "alpha",
      "zeta",
      "newer",
    ]);
  });
});

describe("薄弱反馈与共享数据", () => {
  it("使用共享复习算法，并计入当天全局复习去重", async () => {
    const word = await repositories.words.create({
      displayWord: "shared-weak",
      chineseMeaning: "共享薄弱",
    });
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: word.id,
        mode: "english-to-chinese",
        feedback: "forgotten",
        feedbackAtMs: NOW,
      }),
    );

    const remembered = weakService.createSubmission({
      wordId: word.id,
      feedback: "remembered",
      feedbackAtMs: NOW + MINUTE,
    });
    const first = await weakService.submitFeedback(remembered);

    expect(first.history).toMatchObject({
      wordId: word.id,
      mode: "english-to-chinese",
      source: "weak",
      groupId: null,
      feedback: "remembered",
    });
    expect(first.reviewState).toMatchObject({
      wordId: word.id,
      weakScore: 3,
      consecutiveSuccesses: 1,
      consecutiveForgets: 0,
      nextReviewAtMs: NOW + MINUTE + DAY + 20_000,
    });

    await weakService.submitFeedback(
      weakService.createSubmission({
        wordId: word.id,
        feedback: "fuzzy",
        feedbackAtMs: NOW + 2 * MINUTE,
      }),
    );
    const histories = await repositories.learningHistory.listForWord(word.id);
    const daily = await dailyService.getToday(NOW + 2 * MINUTE);

    expect(histories.map((history) => history.source)).toEqual([
      "global",
      "weak",
      "weak",
    ]);
    expect(daily.task.completedGlobalNewWordIds).toEqual([word.id]);
    expect(daily.task.completedGlobalReviewWordIds).toEqual([word.id]);
    expect((await weakService.list())[0]).toMatchObject({
      weakScore: 4,
      historyCount: 3,
    });
    await expect(
      repositories.reviewStates.listAll(),
    ).resolves.toHaveLength(1);
  });

  it("分组反馈参与薄弱评分，但不增加全局复习完成量", async () => {
    const word = await repositories.words.create({
      displayWord: "group-weak",
      chineseMeaning: "分组薄弱",
    });
    const groupService = new GroupLibraryService(repositories, {
      createId: () => {
        sequence += 1;
        return `weak-group-submission-${sequence}`;
      },
    });
    const group = await groupService.create("薄弱来源组");
    await groupService.addWords(group.id, [word.id]);
    await groupService.submitGroupFeedback(
      groupService.createGroupSubmission({
        wordId: word.id,
        groupId: group.id,
        feedback: "forgotten",
        feedbackAtMs: NOW,
      }),
    );

    expect((await weakService.list())[0]).toMatchObject({
      weakScore: 3,
      historyCount: 1,
    });
    const daily = await dailyService.getToday(NOW);
    expect(daily.task.completedGlobalNewWordIds).toEqual([]);
    expect(daily.task.completedGlobalReviewWordIds).toEqual([]);
  });

  it("相同薄弱提交 ID 重试不会重复写历史或复习统计", async () => {
    const word = await repositories.words.create({
      displayWord: "idempotent-weak",
      chineseMeaning: "幂等薄弱",
    });
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: word.id,
        mode: "english-to-chinese",
        feedback: "fuzzy",
        feedbackAtMs: NOW,
      }),
    );
    const submission = weakService.createSubmission({
      wordId: word.id,
      feedback: "remembered",
      feedbackAtMs: NOW + MINUTE,
    });

    const first = await weakService.submitFeedback(submission);
    const retry = await weakService.submitFeedback(submission);

    expect(first.idempotentReplay).toBe(false);
    expect(retry.idempotentReplay).toBe(true);
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(2);
    const daily = await repositories.dailyTasks.getByDate("2026-01-01");
    expect(daily?.completedGlobalReviewWordIds).toEqual([word.id]);
  });

  it("并发提交同一旧状态时只有一个成功，另一个由事务冲突保护", async () => {
    const word = await repositories.words.create({
      displayWord: "concurrent-weak",
      chineseMeaning: "并发薄弱",
    });
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: word.id,
        mode: "english-to-chinese",
        feedback: "forgotten",
        feedbackAtMs: NOW,
      }),
    );

    const originalGet = repositories.reviewStates.getByWordId.bind(
      repositories.reviewStates,
    );
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    vi.spyOn(repositories.reviewStates, "getByWordId").mockImplementation(
      async (wordId) => {
        const state = await originalGet(wordId);
        reads += 1;
        if (reads === 2) release?.();
        if (reads <= 2) await barrier;
        return state;
      },
    );

    const results = await Promise.allSettled([
      weakService.submitFeedback(
        weakService.createSubmission({
          wordId: word.id,
          feedback: "remembered",
          feedbackAtMs: NOW + MINUTE,
        }),
      ),
      weakService.submitFeedback(
        weakService.createSubmission({
          wordId: word.id,
          feedback: "fuzzy",
          feedbackAtMs: NOW + 2 * MINUTE,
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(2);
    const daily = await repositories.dailyTasks.getByDate("2026-01-01");
    expect(daily?.completedGlobalReviewWordIds).toEqual([word.id]);
  });

  it("跨北京午夜时，薄弱反馈归入新日期的复习统计", async () => {
    const atBeijing2359 = Date.UTC(2026, 0, 1, 15, 59, 0);
    const atBeijingMidnight = Date.UTC(2026, 0, 1, 16, 0, 10);
    const word = await repositories.words.create({
      displayWord: "midnight-weak",
      chineseMeaning: "跨日薄弱",
    });
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: word.id,
        mode: "english-to-chinese",
        feedback: "forgotten",
        feedbackAtMs: atBeijing2359,
      }),
    );
    await weakService.submitFeedback(
      weakService.createSubmission({
        wordId: word.id,
        feedback: "remembered",
        feedbackAtMs: atBeijingMidnight,
      }),
    );

    const firstDay = await repositories.dailyTasks.getByDate("2026-01-01");
    const secondDay = await repositories.dailyTasks.getByDate("2026-01-02");
    expect(firstDay?.completedGlobalNewWordIds).toEqual([word.id]);
    expect(firstDay?.completedGlobalReviewWordIds).toEqual([]);
    expect(secondDay?.completedGlobalReviewWordIds).toEqual([word.id]);
    const histories =
      await repositories.learningHistory.listByBeijingDate("2026-01-02");
    expect(histories).toHaveLength(1);
    expect(histories[0]).toMatchObject({
      wordId: word.id,
      source: "weak",
      beijingDate: "2026-01-02",
    });
  });
});

function createItem(
  displayWord: string,
  weakScore: number,
  consecutiveForgets: number,
  ef: number,
  lastLearnedAtMs: number,
): WeakWordItem {
  return {
    word: {
      id: `id-${displayWord}`,
      displayWord,
      normalizedWord: displayWord.toLowerCase(),
      chineseMeaning: `${displayWord} 释义`,
      createdAtMs: NOW,
      updatedAtMs: NOW,
    },
    reviewState: {
      wordId: `id-${displayWord}`,
      ef,
      consecutiveSuccesses: 0,
      consecutiveForgets,
      weakScore,
      intervalMinutes: null,
      lastFeedbackAtMs: lastLearnedAtMs,
      nextReviewAtMs: lastLearnedAtMs + DAY,
      createdAtMs: NOW,
      updatedAtMs: lastLearnedAtMs,
    },
    weakScore,
    historyCount: 1,
    lastLearnedAtMs,
  };
}
