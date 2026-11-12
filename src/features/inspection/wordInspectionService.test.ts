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
import {
  filterAndSortInspectionWords,
  WordInspectionService,
} from "./wordInspectionService";

let database: AppDatabase;
let repositories: Repositories;
let service: WordInspectionService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const NOW = Date.UTC(2026, 0, 1, 4, 0, 40);

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-inspection-service-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => NOW,
    createId: () => {
      sequence += 1;
      return `inspection-id-${sequence}`;
    },
  });
  service = new WordInspectionService({
    listWords: () => repositories.words.list(),
    listGroups: () => repositories.groups.list(),
    listGroupWords: (groupId) =>
      repositories.wordGroups.getWordsForGroup(groupId),
  });
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

describe("检验数据范围", () => {
  it("读取全部词库或指定分组，只返回单词资料", async () => {
    const alpha = await repositories.words.create({
      displayWord: "alpha",
      chineseMeaning: "阿尔法",
    });
    const beta = await repositories.words.create({
      displayWord: "beta",
      chineseMeaning: "贝塔",
    });
    const group = await repositories.groups.create("第一组");
    await repositories.wordGroups.add(alpha.id, group.id);

    const all = await service.load(null);
    const grouped = await service.load(group.id);

    expect(all.groups.map((item) => item.name)).toEqual(["第一组"]);
    expect(all.words.map((word) => word.id)).toEqual([alpha.id, beta.id]);
    expect(grouped.words.map((word) => word.id)).toEqual([alpha.id]);
  });

  it("搜索英文或中文并按英文或新增时间排序", async () => {
    const words = [
      await repositories.words.create({
        displayWord: "zeta",
        chineseMeaning: "最后",
      }),
      await repositories.words.create({
        displayWord: "alpha",
        chineseMeaning: "第一个",
      }),
      await repositories.words.create({
        displayWord: "beta",
        chineseMeaning: "特殊含义",
      }),
    ];

    expect(
      filterAndSortInspectionWords(
        words,
        "",
        "alphabetical-asc",
      ).map((word) => word.displayWord),
    ).toEqual(["alpha", "beta", "zeta"]);
    expect(
      filterAndSortInspectionWords(
        words,
        "",
        "alphabetical-desc",
      ).map((word) => word.displayWord),
    ).toEqual(["zeta", "beta", "alpha"]);
    expect(
      filterAndSortInspectionWords(
        words,
        "特殊",
        "alphabetical-asc",
      ).map((word) => word.displayWord),
    ).toEqual(["beta"]);
  });

  it("检验读取不改变复习状态、历史或每日任务", async () => {
    const word = await repositories.words.create({
      displayWord: "readonly",
      chineseMeaning: "只读",
    });
    const group = await repositories.groups.create("只读组");
    await repositories.wordGroups.add(word.id, group.id);
    await repositories.reviewStates.create(word.id);
    await repositories.learningHistory.add({
      wordId: word.id,
      mode: "english-to-chinese",
      source: "group",
      groupId: group.id,
      feedback: "fuzzy",
      feedbackOccurredAtMs: NOW,
      stateBefore: null,
      stateAfter: null,
    });
    await repositories.dailyTasks.create({
      beijingDate: "2026-01-01",
      baseGoal: 5,
      carryoverTasks: 0,
      nominalTaskCount: 5,
      effectiveTaskCount: 1,
      completedCount: 0,
      completedGlobalNewWordIds: [],
      completedGlobalReviewWordIds: [],
    });
    const before = JSON.stringify({
      states: await repositories.reviewStates.listAll(),
      histories: await repositories.learningHistory.listForWord(word.id),
      tasks: await repositories.dailyTasks.list(),
    });

    await service.load(null);
    await service.load(group.id);
    filterAndSortInspectionWords(
      [word],
      "readonly",
      "alphabetical-asc",
    );

    const after = JSON.stringify({
      states: await repositories.reviewStates.listAll(),
      histories: await repositories.learningHistory.listForWord(word.id),
      tasks: await repositories.dailyTasks.list(),
    });
    expect(after).toBe(before);
  });
});

