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
  shiftBeijingDate,
  type AppDatabase,
  type Feedback,
  type LearningSource,
  type Repositories,
  type ReviewStateSnapshot,
  type Word,
} from "../../data";
import {
  LearningAnalyticsService,
  selectAnalyticsRange,
} from "./learningAnalyticsService";

let database: AppDatabase;
let repositories: Repositories;
let analyticsService: LearningAnalyticsService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const TODAY_DATE = "2026-02-01";
const TODAY = atBeijingNoon(TODAY_DATE);

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-analytics-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => TODAY,
    createId: () => {
      sequence += 1;
      return `analytics-id-${sequence}`;
    },
  });
  analyticsService = new LearningAnalyticsService(repositories);
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

function atBeijingNoon(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 4, 0, 40);
}

async function createWord(displayWord: string): Promise<Word> {
  return repositories.words.create({
    displayWord,
    chineseMeaning: `${displayWord} 的释义`,
  });
}

const EMPTY_SNAPSHOT: ReviewStateSnapshot = {
  ef: null,
  consecutiveSuccesses: null,
  consecutiveForgets: null,
  weakScore: null,
  intervalMinutes: null,
  lastFeedbackAtMs: null,
  nextReviewAtMs: null,
};

async function addHistory(input: {
  word: Word;
  atMs?: number;
  mode?: "english-to-chinese" | "chinese-to-english";
  source?: LearningSource;
  groupId?: string | null;
  feedback: Feedback;
  firstGlobal?: boolean;
}): Promise<void> {
  await repositories.learningHistory.add({
    wordId: input.word.id,
    mode: input.mode ?? "english-to-chinese",
    source: input.source ?? "global",
    groupId: input.groupId ?? null,
    feedback: input.feedback,
    feedbackOccurredAtMs: input.atMs ?? TODAY,
    stateBefore: input.firstGlobal ? null : EMPTY_SNAPSHOT,
    stateAfter: null,
  });
}

describe("学习趋势与全局去重", () => {
  it("同词同日按新词和复习分别去重，分组不计入全局", async () => {
    const first = await createWord("first");
    const grouped = await createWord("grouped");
    const weak = await createWord("weak");
    const group = await repositories.groups.create("学习组");
    for (const word of [first, grouped, weak]) {
      await repositories.reviewStates.create(word.id);
    }
    await repositories.wordGroups.add(grouped.id, group.id);

    await addHistory({
      word: first,
      feedback: "forgotten",
      firstGlobal: true,
    });
    await addHistory({ word: first, feedback: "fuzzy" });
    await addHistory({ word: first, feedback: "remembered" });
    await addHistory({
      word: grouped,
      source: "group",
      groupId: group.id,
      feedback: "remembered",
    });
    await addHistory({
      word: grouped,
      source: "group",
      groupId: group.id,
      feedback: "fuzzy",
    });
    await addHistory({
      word: weak,
      source: "weak",
      feedback: "forgotten",
    });

    const dashboard = await analyticsService.getDashboard(TODAY);
    const view = selectAnalyticsRange(dashboard, "7d");
    const today = dashboard.points.at(-1);

    expect(today).toMatchObject({
      date: TODAY_DATE,
      newCompletedCount: 1,
      reviewCompletedCount: 2,
      forgottenCount: 2,
      fuzzyCount: 2,
      rememberedCount: 2,
      weakWordCount: 3,
    });
    expect(dashboard.today.task.completedGlobalNewWordIds).toEqual([
      first.id,
    ]);
    expect(dashboard.today.task.completedGlobalReviewWordIds.sort()).toEqual(
      [first.id, weak.id].sort(),
    );
    expect(view.feedback).toMatchObject({
      forgotten: 2,
      fuzzy: 2,
      remembered: 2,
      total: 6,
      forgottenPercent: 33.3,
      fuzzyPercent: 33.3,
      rememberedPercent: 33.3,
    });
  });

  it("支持近 7 天、近 30 天和全部历史范围", async () => {
    const word = await createWord("history-range");
    await repositories.reviewStates.create(word.id);
    for (const [index, offset] of [-40, -20, -1, 0].entries()) {
      await addHistory({
        word,
        atMs: atBeijingNoon(
          shiftBeijingDate(TODAY_DATE, offset),
        ),
        feedback: index === 3 ? "remembered" : "fuzzy",
        firstGlobal: index === 0,
      });
    }

    const dashboard = await analyticsService.getDashboard(TODAY);
    const seven = selectAnalyticsRange(dashboard, "7d");
    const thirty = selectAnalyticsRange(dashboard, "30d");
    const all = selectAnalyticsRange(dashboard, "all");

    expect(dashboard.points).toHaveLength(41);
    expect(seven.points).toHaveLength(7);
    expect(thirty.points).toHaveLength(30);
    expect(all.points).toHaveLength(41);
    expect(all.newCompletedCount).toBe(1);
    expect(all.reviewCompletedCount).toBe(3);
    expect(all.feedback.total).toBe(4);
  });

  it("北京时间午夜前后的反馈归入不同自然日", async () => {
    const word = await createWord("midnight");
    await repositories.reviewStates.create(word.id);
    await addHistory({
      word,
      atMs: Date.UTC(2026, 0, 1, 15, 59, 59),
      feedback: "fuzzy",
      firstGlobal: true,
    });
    await addHistory({
      word,
      atMs: Date.UTC(2026, 0, 1, 16, 0, 0),
      feedback: "remembered",
    });

    const dashboard = await analyticsService.getDashboard(
      Date.UTC(2026, 0, 2, 4, 0, 0),
    );

    expect(dashboard.points.slice(-2)).toMatchObject([
      {
        date: "2026-01-01",
        newCompletedCount: 1,
        reviewCompletedCount: 0,
        fuzzyCount: 1,
      },
      {
        date: "2026-01-02",
        newCompletedCount: 0,
        reviewCompletedCount: 1,
        rememberedCount: 1,
      },
    ]);
  });
});

describe("薄弱词与分组分析", () => {
  it("按全部历史累计薄弱分并生成每日变化趋势和分布", async () => {
    const first = await createWord("weak-first");
    const second = await createWord("weak-second");
    const third = await createWord("weak-third");
    for (const word of [first, second, third]) {
      await repositories.reviewStates.create(word.id);
    }

    await addHistory({
      word: first,
      atMs: atBeijingNoon(shiftBeijingDate(TODAY_DATE, -2)),
      feedback: "forgotten",
      firstGlobal: true,
    });
    await addHistory({
      word: first,
      atMs: atBeijingNoon(shiftBeijingDate(TODAY_DATE, -1)),
      feedback: "remembered",
    });
    await addHistory({
      word: second,
      atMs: atBeijingNoon(shiftBeijingDate(TODAY_DATE, -1)),
      feedback: "fuzzy",
      firstGlobal: true,
    });
    await addHistory({
      word: second,
      feedback: "forgotten",
    });
    await addHistory({
      word: third,
      feedback: "forgotten",
      firstGlobal: true,
    });

    const dashboard = await analyticsService.getDashboard(TODAY);

    expect(
      dashboard.points.slice(-3).map((point) => point.weakWordCount),
    ).toEqual([1, 2, 3]);
    expect(dashboard.currentWeakWordCount).toBe(3);
    expect(
      dashboard.weakDistribution.find((bucket) => bucket.key === "3-5"),
    ).toMatchObject({ count: 3 });
  });

  it("分组统计独立计算成员、已学习和分组来源历史", async () => {
    const started = await createWord("group-started");
    const unstarted = await createWord("group-unstarted");
    const group = await repositories.groups.create("分析分组");
    await repositories.wordGroups.add(started.id, group.id);
    await repositories.wordGroups.add(unstarted.id, group.id);
    await repositories.reviewStates.create(started.id);
    await addHistory({
      word: started,
      source: "group",
      groupId: group.id,
      feedback: "fuzzy",
    });
    await addHistory({
      word: started,
      source: "group",
      groupId: group.id,
      feedback: "remembered",
    });
    await addHistory({
      word: started,
      source: "global",
      feedback: "forgotten",
      firstGlobal: true,
    });

    const dashboard = await analyticsService.getDashboard(TODAY);

    expect(dashboard.groups).toEqual([
      {
        groupId: group.id,
        name: "分析分组",
        wordCount: 2,
        startedCount: 1,
        unstartedCount: 1,
        historyCount: 2,
      },
    ]);
    expect(dashboard.today.task.completedGlobalNewWordIds).toEqual([
      started.id,
    ]);
  });

  it("空数据返回今天一个零点和空分组分布", async () => {
    const dashboard = await analyticsService.getDashboard(TODAY);
    const seven = selectAnalyticsRange(dashboard, "7d");
    const all = selectAnalyticsRange(dashboard, "all");

    expect(dashboard.points).toHaveLength(1);
    expect(dashboard.points[0]).toMatchObject({
      newCompletedCount: 0,
      reviewCompletedCount: 0,
      forgottenCount: 0,
      fuzzyCount: 0,
      rememberedCount: 0,
      weakWordCount: 0,
    });
    expect(seven.points).toHaveLength(7);
    expect(all.points).toHaveLength(1);
    expect(dashboard.currentWeakWordCount).toBe(0);
    expect(dashboard.groups).toEqual([]);
  });
});
