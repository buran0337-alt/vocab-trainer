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
import { DailyProgressService } from "../daily/dailyProgressService";
import { GroupLibraryService } from "./groupLibraryService";

let database: AppDatabase;
let repositories: Repositories;
let service: GroupLibraryService;
let dailyService: DailyProgressService;
let databaseName: string;
let sequence: number;
let databaseSequence = 0;
const NOW = Date.UTC(2026, 0, 1, 4, 0, 40);

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-group-service-test-${databaseSequence}`;
  sequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => NOW,
    createId: () => {
      sequence += 1;
      return `group-test-id-${sequence}`;
    },
  });
  service = new GroupLibraryService(repositories, {
    createId: () => {
      sequence += 1;
      return `group-feedback-id-${sequence}`;
    },
  });
  dailyService = new DailyProgressService(repositories);
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

async function createWord(displayWord: string, meaning: string) {
  return repositories.words.create({
    displayWord,
    chineseMeaning: meaning,
  });
}

describe("分组管理", () => {
  it("分组名称去除首尾空格后大小写敏感去重", async () => {
    const upper = await service.create(" Review ");
    const lower = await service.create("review");

    expect(upper.name).toBe("Review");
    expect(lower.name).toBe("review");
    await expect(service.create("Review ")).rejects.toThrow("已经存在");
  });

  it("同一单词可加入多个分组，移除成员不删除单词或状态", async () => {
    const word = await createWord("shared", "共享");
    const first = await service.create("第一组");
    const second = await service.create("第二组");
    await service.addWords(first.id, [word.id]);
    await service.addWords(second.id, [word.id]);
    await repositories.reviewStates.create(word.id);

    await service.removeWord(first.id, word.id);

    await expect(
      repositories.wordGroups.getByPair(word.id, first.id),
    ).resolves.toBeNull();
    await expect(
      repositories.wordGroups.getByPair(word.id, second.id),
    ).resolves.not.toBeNull();
    await expect(repositories.words.getById(word.id)).resolves.not.toBeNull();
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.not.toBeNull();
  });

  it("批量添加成员复用唯一关系并支持全部加入", async () => {
    const words = await Promise.all([
      createWord("alpha-group", "甲"),
      createWord("beta-group", "乙"),
    ]);
    const group = await service.create("批量");

    const added = await service.addWords(
      group.id,
      words.map((word) => word.id),
    );
    const repeated = await service.addWords(group.id, [words[0].id]);

    expect(added).toHaveLength(2);
    expect(repeated).toEqual([]);
    await expect(
      repositories.wordGroups.listForGroup(group.id),
    ).resolves.toHaveLength(2);
  });

  it("删除分组保留单词、复习状态和已有历史", async () => {
    const word = await createWord("keep", "保留");
    const group = await service.create("待删除");
    await service.addWords(group.id, [word.id]);
    const state = await repositories.reviewStates.create(word.id);
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

    await service.delete(group.id);

    await expect(repositories.groups.getById(group.id)).resolves.toBeNull();
    await expect(repositories.words.getById(word.id)).resolves.not.toBeNull();
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toEqual(state);
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(1);
  });

  it("分组统计包含成员、已学习、未学习和分组来源历史", async () => {
    const learned = await createWord("learned", "已学习");
    const fresh = await createWord("fresh", "未学习");
    const group = await service.create("统计组");
    await service.addWords(group.id, [learned.id, fresh.id]);
    await repositories.reviewStates.create(learned.id);
    await repositories.learningHistory.add({
      wordId: learned.id,
      mode: "english-to-chinese",
      source: "group",
      groupId: group.id,
      feedback: "remembered",
      feedbackOccurredAtMs: NOW,
      stateBefore: null,
      stateAfter: null,
    });

    const detail = await service.getDetail(group.id, NOW);

    expect(detail.summary).toMatchObject({
      wordCount: 2,
      startedCount: 1,
      unstartedCount: 1,
      groupHistoryCount: 1,
    });
    expect(detail.words.map((item) => item.learningStatus)).toEqual([
      "new",
      "scheduled",
    ]);
  });
});

describe("分组反馈", () => {
  it("更新共享状态并写入 group 来源历史，不增加全局每日任务", async () => {
    const word = await createWord("group-feedback", "分组反馈");
    const group = await service.create("学习组");
    const otherGroup = await service.create("共享进度组");
    await service.addWords(group.id, [word.id]);
    await service.addWords(otherGroup.id, [word.id]);
    const before = await dailyService.getToday(NOW);
    const submission = service.createGroupSubmission({
      wordId: word.id,
      groupId: group.id,
      feedback: "remembered",
      feedbackAtMs: NOW,
    });

    const result = await service.submitGroupFeedback(submission);
    const everyDay = new Date(NOW).toLocaleDateString("en-CA", {
      timeZone: "Asia/Shanghai",
    });
    const after = await dailyService.getToday(NOW);

    expect(result.reviewState).toMatchObject({
      ef: 2.6,
      consecutiveSuccesses: 1,
      intervalMinutes: 1_440,
    });
    expect(result.history.source).toBe("group");
    expect(result.history.groupId).toBe(group.id);
    expect(after.totalCompletedCount).toBe(0);
    await expect(
      repositories.learningHistory.listByBeijingDate(everyDay),
    ).resolves.toHaveLength(1);
    expect(before.task.completedGlobalNewWordIds).toEqual([]);
    const otherDetail = await service.getDetail(otherGroup.id, NOW);
    expect(otherDetail.summary).toMatchObject({
      startedCount: 1,
      groupHistoryCount: 0,
    });
    expect(otherDetail.words[0].reviewState).toEqual(result.reviewState);
  });

  it("拒绝为非分组成员提交分组反馈且不写任何数据", async () => {
    const word = await createWord("not-member", "不是成员");
    const group = await service.create("无成员组");
    const submission = service.createGroupSubmission({
      wordId: word.id,
      groupId: group.id,
      feedback: "remembered",
      feedbackAtMs: NOW,
    });

    await expect(service.submitGroupFeedback(submission)).rejects.toThrow(
      "不在该分组中",
    );
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toBeNull();
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(0);
  });
});

