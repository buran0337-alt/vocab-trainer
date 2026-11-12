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
import { LearningSessionService } from "../learning/learningSessionService";
import { DailyProgressService } from "./dailyProgressService";

let database: AppDatabase;
let repositories: Repositories;
let dailyService: DailyProgressService;
let learningService: LearningSessionService;
let databaseName: string;
let sequence: number;
let wordDisplaySequence: number;
let databaseSequence = 0;

const DAY_ONE = Date.UTC(2026, 0, 1, 4, 0, 40);
const DAY_TWO = Date.UTC(2026, 0, 2, 4, 0, 40);

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-daily-service-test-${databaseSequence}`;
  sequence = 0;
  wordDisplaySequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => DAY_ONE,
    createId: () => {
      sequence += 1;
      return `daily-id-${sequence}`;
    },
  });
  dailyService = new DailyProgressService(repositories);
  learningService = new LearningSessionService(repositories, {
    createId: () => {
      sequence += 1;
      return `daily-feedback-${sequence}`;
    },
  });
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

async function createNewWords(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    wordDisplaySequence += 1;
    const word = await repositories.words.create({
      displayWord: `word-${wordDisplaySequence}`,
      chineseMeaning: `释义-${wordDisplaySequence}`,
    });
    ids.push(word.id);
  }
  return ids;
}

describe("每日目标与服务", () => {
  it("未设置目标时不凭空安排新词，设置后立即生成任务", async () => {
    await createNewWords(5);
    const before = await dailyService.getToday(DAY_ONE);
    expect(before.configured).toBe(false);
    expect(before.task.baseGoal).toBe(0);
    expect(before.remainingTaskCount).toBe(0);

    const after = await dailyService.updateBaseGoal(3, DAY_ONE);
    expect(after.configured).toBe(true);
    expect(after.task.baseGoal).toBe(3);
    expect(after.task.effectiveTaskCount).toBe(3);
    expect(after.remainingTaskCount).toBe(3);
  });

  it("修改目标立即生效并保留已完成数量", async () => {
    const ids = await createNewWords(5);
    await dailyService.updateBaseGoal(5, DAY_ONE);
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: ids[0],
        mode: "english-to-chinese",
        feedback: "remembered",
        feedbackAtMs: DAY_ONE,
      }),
    );
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: ids[1],
        mode: "english-to-chinese",
        feedback: "remembered",
        feedbackAtMs: DAY_ONE,
      }),
    );

    const updated = await dailyService.updateBaseGoal(2, DAY_ONE);

    expect(updated.task.completedCount).toBe(2);
    expect(updated.task.effectiveTaskCount).toBe(2);
    expect(updated.remainingTaskCount).toBe(0);
    expect(updated.goalAchieved).toBe(true);
  });

  it("新词不足后导入新词可动态增加当日有效任务", async () => {
    const ids = await createNewWords(5);
    await repositories.dailyTasks.create({
      beijingDate: "2025-12-31",
      baseGoal: 20,
      carryoverTasks: 0,
      nominalTaskCount: 28,
      effectiveTaskCount: 28,
      completedCount: 20,
      completedGlobalNewWordIds: Array.from(
        { length: 20 },
        (_, index) => `previous-${index}`,
      ),
      completedGlobalReviewWordIds: [],
    });
    await dailyService.updateBaseGoal(20, DAY_ONE);
    for (const wordId of ids.slice(0, 3)) {
      await learningService.submitFeedback(
        learningService.createSubmission({
          wordId,
          mode: "english-to-chinese",
          feedback: "remembered",
          feedbackAtMs: DAY_ONE,
        }),
      );
    }
    const before = await dailyService.getToday(DAY_ONE);
    expect(before.task.effectiveTaskCount).toBe(5);

    await createNewWords(20);
    const after = await dailyService.getToday(DAY_ONE);
    expect(after.task.effectiveTaskCount).toBe(25);
    expect(after.task.completedCount).toBe(3);
  });

  it("跨日只结转上一有效任务中未完成的部分", async () => {
    const ids = await createNewWords(10);
    await dailyService.updateBaseGoal(5, DAY_ONE);
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId: ids[0],
        mode: "english-to-chinese",
        feedback: "remembered",
        feedbackAtMs: DAY_ONE,
      }),
    );

    const nextDay = await dailyService.getToday(DAY_TWO);

    expect(nextDay.task.baseGoal).toBe(5);
    expect(nextDay.task.carryoverTasks).toBe(4);
    expect(nextDay.task.nominalTaskCount).toBe(9);
    expect(nextDay.task.effectiveTaskCount).toBe(9);
  });
});

describe("统计去重和来源", () => {
  it("同一单词先完成新词、之后复习时按两个类别分别计数", async () => {
    const [wordId] = await createNewWords(1);
    await dailyService.updateBaseGoal(1, DAY_ONE);
    const first = await learningService.submitFeedback(
      learningService.createSubmission({
        wordId,
        mode: "english-to-chinese",
        feedback: "forgotten",
        feedbackAtMs: DAY_ONE,
      }),
    );
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId,
        mode: "english-to-chinese",
        feedback: "remembered",
        feedbackAtMs: first.reviewState.nextReviewAtMs as number,
      }),
    );

    const progress = await dailyService.getToday(
      first.reviewState.nextReviewAtMs as number,
    );
    expect(progress.task.completedGlobalNewWordIds).toEqual([wordId]);
    expect(progress.task.completedGlobalReviewWordIds).toEqual([wordId]);
    expect(progress.totalCompletedCount).toBe(2);
  });

  it("同一类别重复学习不重复增加完成数量", async () => {
    const [wordId] = await createNewWords(1);
    await dailyService.updateBaseGoal(1, DAY_ONE);
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId,
        mode: "english-to-chinese",
        feedback: "remembered",
        feedbackAtMs: DAY_ONE,
      }),
    );
    const state = await repositories.reviewStates.getByWordId(wordId);
    await repositories.reviewStates.update(wordId, {
      nextReviewAtMs: DAY_ONE - 1,
    });
    await learningService.submitFeedback(
      learningService.createSubmission({
        wordId,
        mode: "chinese-to-english",
        feedback: "remembered",
        feedbackAtMs: DAY_ONE + 1_000,
      }),
    );

    const progress = await dailyService.getToday(DAY_ONE + 1_000);
    expect(progress.task.completedGlobalNewWordIds).toEqual([wordId]);
    expect(progress.task.completedGlobalReviewWordIds).toEqual([wordId]);
    expect(progress.task.completedCount).toBe(1);
    expect(progress.totalCompletedCount).toBe(2);
    expect(state).not.toBeNull();
  });

  it("分组学习历史不计入全局每日任务", async () => {
    const [wordId] = await createNewWords(1);
    const group = await repositories.groups.create("分组");
    await repositories.learningHistory.add({
      wordId,
      mode: "english-to-chinese",
      source: "group",
      groupId: group.id,
      feedback: "remembered",
      feedbackOccurredAtMs: DAY_ONE,
      stateBefore: null,
      stateAfter: null,
    });

    const progress = await dailyService.getToday(DAY_ONE);

    expect(progress.task.completedGlobalNewWordIds).toEqual([]);
    expect(progress.task.completedGlobalReviewWordIds).toEqual([]);
    expect(progress.totalCompletedCount).toBe(0);
  });

  it("同一类别出现多条历史时仍只计算一次", async () => {
    const [wordId] = await createNewWords(1);
    for (const atMs of [DAY_ONE, DAY_ONE + 1_000]) {
      await repositories.learningHistory.add({
        wordId,
        mode: "english-to-chinese",
        source: "global",
        groupId: null,
        feedback: "remembered",
        feedbackOccurredAtMs: atMs,
        stateBefore: null,
        stateAfter: null,
      });
    }

    const progress = await dailyService.getToday(DAY_ONE + 1_000);

    expect(progress.task.completedGlobalNewWordIds).toEqual([wordId]);
    expect(progress.task.completedCount).toBe(1);
  });

  it("最近 7 天按历史记录去重且不包含分组学习", async () => {
    const [wordId] = await createNewWords(1);
    for (const atMs of [DAY_ONE, DAY_ONE + 1_000]) {
      await repositories.learningHistory.add({
        wordId,
        mode: "english-to-chinese",
        source: "global",
        groupId: null,
        feedback: "remembered",
        feedbackOccurredAtMs: atMs,
        stateBefore: null,
        stateAfter: null,
      });
    }
    const group = await repositories.groups.create("不计入");
    await repositories.learningHistory.add({
      wordId,
      mode: "english-to-chinese",
      source: "group",
      groupId: group.id,
      feedback: "remembered",
      feedbackOccurredAtMs: DAY_ONE,
      stateBefore: null,
      stateAfter: null,
    });

    const recent = await dailyService.getRecentDays(DAY_ONE, 7);
    const today = recent.at(-1);

    expect(recent).toHaveLength(7);
    expect(today).toEqual({
      date: "2026-01-01",
      newCompletedCount: 1,
      reviewCompletedCount: 0,
    });
  });
});

describe("北京时间与持久化", () => {
  it("按北京时间正确跨午夜、跨月和跨年", async () => {
    const endOfJanuary = await dailyService.getToday(
      Date.UTC(2026, 0, 31, 15, 59, 59),
    );
    const startOfFebruary = await dailyService.getToday(
      Date.UTC(2026, 0, 31, 16, 0, 0),
    );
    const endOfYear = await dailyService.getToday(
      Date.UTC(2026, 11, 31, 15, 59, 59),
    );
    const startOfNextYear = await dailyService.getToday(
      Date.UTC(2026, 11, 31, 16, 0, 0),
    );

    expect(endOfJanuary.date).toBe("2026-01-31");
    expect(startOfFebruary.date).toBe("2026-02-01");
    expect(endOfYear.date).toBe("2026-12-31");
    expect(startOfNextYear.date).toBe("2027-01-01");
  });

  it("关闭并重新打开数据库后目标和当日任务保持一致", async () => {
    await createNewWords(5);
    await dailyService.updateBaseGoal(3, DAY_ONE);

    closeDatabase(database);
    database = await openDatabase({ name: databaseName });
    repositories = createRepositories(database, {
      now: () => DAY_ONE,
      createId: () => `reopened-${++sequence}`,
    });
    dailyService = new DailyProgressService(repositories);
    const progress = await dailyService.getToday(DAY_ONE);

    expect(progress.configured).toBe(true);
    expect(progress.task.baseGoal).toBe(3);
    expect(progress.task.effectiveTaskCount).toBe(3);
    expect(await repositories.dailyTasks.getByDate("2026-01-01")).toEqual(
      progress.task,
    );
  });
});

