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
  DataOperationError,
  openDatabase,
  runTransaction,
  type AppDatabase,
  type Repositories,
} from "../../data";
import { LearningSessionService } from "./learningSessionService";

let database: AppDatabase;
let repositories: Repositories;
let service: LearningSessionService;
let databaseName: string;
let currentTime: number;
let submissionSequence: number;
let databaseSequence = 0;

beforeEach(async () => {
  databaseSequence += 1;
  databaseName = `cet6-learning-service-test-${databaseSequence}`;
  currentTime = Date.UTC(2026, 0, 1, 4, 0, 0);
  submissionSequence = 0;
  database = await openDatabase({ name: databaseName });
  repositories = createRepositories(database, {
    now: () => currentTime,
    createId: () => `word-id-${databaseSequence}-${Math.random()}`,
  });
  await repositories.settings.create(999);
  service = new LearningSessionService(repositories, {
    createId: () => {
      submissionSequence += 1;
      return `submission-${submissionSequence}`;
    },
  });
});

afterEach(async () => {
  closeDatabase(database);
  await deleteDB(databaseName);
});

describe("学习队列", () => {
  it("到期复习优先于新词，且未来复习不进入当前轮", async () => {
    const dueWord = await repositories.words.create({
      displayWord: "due",
      chineseMeaning: "到期的",
    });
    const futureWord = await repositories.words.create({
      displayWord: "future",
      chineseMeaning: "未来的",
    });
    const newWord = await repositories.words.create({
      displayWord: "new",
      chineseMeaning: "新的",
    });
    await repositories.reviewStates.create(dueWord.id);
    await repositories.reviewStates.update(dueWord.id, {
      nextReviewAtMs: currentTime - 1,
    });
    await repositories.reviewStates.create(futureWord.id);
    await repositories.reviewStates.update(futureWord.id, {
      nextReviewAtMs: currentTime + 60_000,
    });

    const cards = await service.loadRound(currentTime);

    expect(cards.map((card) => card.word.id)).toEqual([
      dueWord.id,
      newWord.id,
    ]);
    expect(cards.map((card) => card.kind)).toEqual(["review", "new"]);
  });

  it("同一轮不重复出现同一个单词", async () => {
    const word = await repositories.words.create({
      displayWord: "unique",
      chineseMeaning: "唯一的",
    });
    await repositories.reviewStates.create(word.id);
    await repositories.reviewStates.update(word.id, {
      nextReviewAtMs: currentTime - 1,
    });

    const cards = await service.loadRound(currentTime);

    expect(cards).toHaveLength(1);
    expect(new Set(cards.map((card) => card.word.id)).size).toBe(1);
  });

  it("忘记后 10 分钟内不回到后续轮次，到期后重新出现", async () => {
    const word = await repositories.words.create({
      displayWord: "retry",
      chineseMeaning: "重试",
    });
    const submission = service.createSubmission({
      wordId: word.id,
      mode: "english-to-chinese",
      feedback: "forgotten",
      feedbackAtMs: currentTime,
    });
    const saved = await service.submitFeedback(submission);

    await expect(
      service.loadRound(saved.reviewState.nextReviewAtMs as number - 1),
    ).resolves.toEqual([]);
    const nextRound = await service.loadRound(
      saved.reviewState.nextReviewAtMs as number,
    );
    expect(nextRound.map((card) => card.word.id)).toEqual([word.id]);
  });

  it("新词队列受今日有效任务限制，到期复习不受目标限制", async () => {
    const dueWord = await repositories.words.create({
      displayWord: "due-with-zero-goal",
      chineseMeaning: "零目标也复习",
    });
    await repositories.reviewStates.create(dueWord.id);
    await repositories.reviewStates.update(dueWord.id, {
      nextReviewAtMs: currentTime - 1,
    });
    await repositories.settings.updateDailyBaseGoal(2);
    for (let index = 0; index < 5; index += 1) {
      await repositories.words.create({
        displayWord: `limited-${index}`,
        chineseMeaning: `限量-${index}`,
      });
    }

    const cards = await service.loadRound(currentTime);

    expect(cards.filter((card) => card.kind === "review")).toHaveLength(1);
    expect(cards.filter((card) => card.kind === "new")).toHaveLength(2);
    expect(new Set(cards.map((card) => card.word.id)).size).toBe(3);
  });
});

describe("反馈事务与幂等", () => {
  it("首次反馈原子创建复习状态和学习历史", async () => {
    const word = await repositories.words.create({
      displayWord: "atomic",
      chineseMeaning: "原子的",
    });
    const submission = service.createSubmission({
      wordId: word.id,
      mode: "english-to-chinese",
      feedback: "remembered",
      feedbackAtMs: currentTime,
    });

    const result = await service.submitFeedback(submission);

    expect(result.idempotentReplay).toBe(false);
    expect(result.reviewState).toMatchObject({
      wordId: word.id,
      ef: 2.6,
      consecutiveSuccesses: 1,
      intervalMinutes: 1_440,
      lastFeedbackAtMs: currentTime,
    });
    expect(result.history).toMatchObject({
      id: submission.submissionId,
      wordId: word.id,
      mode: "english-to-chinese",
      source: "global",
      feedback: "remembered",
      feedbackOccurredAtMs: currentTime,
      stateBefore: null,
    });
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(1);
    await expect(
      repositories.dailyTasks.getByDate("2026-01-01"),
    ).resolves.toMatchObject({
      completedGlobalNewWordIds: [word.id],
      completedCount: 1,
    });
  });

  it("复用相同提交 ID 不重复写历史或重复推进状态", async () => {
    const word = await repositories.words.create({
      displayWord: "idempotent",
      chineseMeaning: "幂等的",
    });
    const submission = service.createSubmission({
      wordId: word.id,
      mode: "chinese-to-english",
      feedback: "fuzzy",
      feedbackAtMs: currentTime,
    });

    const first = await service.submitFeedback(submission);
    const retry = await service.submitFeedback(submission);

    expect(first.idempotentReplay).toBe(false);
    expect(retry.idempotentReplay).toBe(true);
    expect(retry.history).toEqual(first.history);
    expect(retry.reviewState).toEqual(first.reviewState);
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(1);
    await expect(
      repositories.dailyTasks.getByDate("2026-01-01"),
    ).resolves.toMatchObject({
      completedGlobalNewWordIds: [word.id],
      completedCount: 1,
    });
  });

  it("保存失败不写入任何记录，使用原提交 ID 可安全重试", async () => {
    const word = await repositories.words.create({
      displayWord: "retry-save",
      chineseMeaning: "重试保存",
    });
    const submission = service.createSubmission({
      wordId: word.id,
      mode: "english-to-chinese",
      feedback: "fuzzy",
      feedbackAtMs: currentTime,
    });
    const originalCommit =
      repositories.learningSessions.commitFeedback.bind(
        repositories.learningSessions,
      );
    const commitSpy = vi
      .spyOn(repositories.learningSessions, "commitFeedback")
      .mockRejectedValueOnce(new DataOperationError("模拟保存失败"));

    await expect(service.submitFeedback(submission)).rejects.toThrow(
      "模拟保存失败",
    );
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(0);
    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toBeNull();
    await expect(
      repositories.dailyTasks.getByDate("2026-01-01"),
    ).resolves.toMatchObject({
      completedGlobalNewWordIds: [],
      completedCount: 0,
    });

    commitSpy.mockImplementation(originalCommit);
    const retry = await service.submitFeedback(submission);
    expect(retry.idempotentReplay).toBe(false);
    await expect(
      repositories.learningHistory.countForWord(word.id),
    ).resolves.toBe(1);
  });

  it("学习历史与复习状态使用同一个事务，失败时全部回滚", async () => {
    const word = await repositories.words.create({
      displayWord: "rollback-study",
      chineseMeaning: "回滚学习",
    });

    await expect(
      runTransaction(
        database,
        ["reviewStates", "learningHistory", "dailyTasks"],
        "readwrite",
        async (transaction) => {
          await transaction.objectStore("dailyTasks").put({
            beijingDate: "2026-01-01",
            baseGoal: 1,
            carryoverTasks: 0,
            nominalTaskCount: 1,
            effectiveTaskCount: 1,
            completedCount: 1,
            completedGlobalNewWordIds: [word.id],
            completedGlobalReviewWordIds: [],
            createdAtMs: currentTime,
            updatedAtMs: currentTime,
          });
          await transaction.objectStore("reviewStates").put({
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
          await transaction.objectStore("learningHistory").add({
            id: "rollback-history",
            wordId: word.id,
            mode: "english-to-chinese",
            source: "global",
            groupId: null,
            feedback: "remembered",
            feedbackOccurredAtMs: currentTime,
            beijingDate: "2026-01-01",
            stateBefore: null,
            stateAfter: null,
          });
          throw new Error("模拟事务失败");
        },
      ),
    ).rejects.toThrow("数据事务失败");

    await expect(
      repositories.reviewStates.getByWordId(word.id),
    ).resolves.toBeNull();
    await expect(
      repositories.learningHistory.getById("rollback-history"),
    ).resolves.toBeNull();
    await expect(
      repositories.dailyTasks.getByDate("2026-01-01"),
    ).resolves.toBeNull();
  });

  it("已有状态更新时保留创建时间和原始单词资料", async () => {
    const word = await repositories.words.create({
      displayWord: "existing",
      chineseMeaning: "已有的",
    });
    const existingState = await repositories.reviewStates.create(word.id);
    currentTime += 60_000;

    const result = await service.submitFeedback(
      service.createSubmission({
        wordId: word.id,
        mode: "chinese-to-english",
        feedback: "remembered",
        feedbackAtMs: currentTime,
      }),
    );

    expect(result.reviewState.createdAtMs).toBe(existingState.createdAtMs);
    expect(result.reviewState.updatedAtMs).toBe(currentTime);
    await expect(repositories.words.getById(word.id)).resolves.toEqual(word);
  });
});

