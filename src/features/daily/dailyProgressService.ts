import {
  assertEpochMilliseconds,
  shiftBeijingDate,
  toBeijingDate,
  type DailyTask,
  type LearningHistory,
  type Repositories,
} from "../../data";
import {
  calculateDailyTaskCounts,
  createDailyTaskSnapshot,
  getOutstandingTasks,
} from "./dailyTaskCalculator";

export interface TodayProgress {
  date: string;
  configured: boolean;
  task: DailyTask;
  availableNewWordCount: number;
  availableNewWordIds: string[];
  totalWordCount: number;
  startedWordCount: number;
  dueReviewCount: number;
  totalCompletedCount: number;
  remainingTaskCount: number;
  goalAchieved: boolean;
}

export interface RecentDayProgress {
  date: string;
  newCompletedCount: number;
  reviewCompletedCount: number;
}

export interface FeedbackTaskUpdate {
  expectedTask: DailyTask;
  nextTask: DailyTask;
  isNewWord: boolean;
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function taskMatches(left: DailyTask, right: DailyTask): boolean {
  return (
    left.baseGoal === right.baseGoal &&
    left.carryoverTasks === right.carryoverTasks &&
    left.nominalTaskCount === right.nominalTaskCount &&
    left.effectiveTaskCount === right.effectiveTaskCount &&
    left.completedCount === right.completedCount &&
    left.completedGlobalNewWordIds.join("\u0000") ===
      right.completedGlobalNewWordIds.join("\u0000") &&
    left.completedGlobalReviewWordIds.join("\u0000") ===
      right.completedGlobalReviewWordIds.join("\u0000")
  );
}

export function getGlobalCompletionIdsFromHistory(
  histories: LearningHistory[],
): {
  newWordIds: string[];
  reviewWordIds: string[];
} {
  const newWordIds: string[] = [];
  const reviewWordIds: string[] = [];

  for (const history of histories) {
    if (history.source === "group") {
      continue;
    }
    if (history.source === "global" && history.stateBefore === null) {
      newWordIds.push(history.wordId);
    } else {
      reviewWordIds.push(history.wordId);
    }
  }

  return {
    newWordIds: unique(newWordIds),
    reviewWordIds: unique(reviewWordIds),
  };
}

export class DailyProgressService {
  private readonly repositories: Repositories;

  constructor(repositories: Repositories) {
    this.repositories = repositories;
  }

  async getToday(atMs: number): Promise<TodayProgress> {
    assertEpochMilliseconds(atMs, "统计时间");
    const date = toBeijingDate(atMs);
    const [
      settings,
      tasks,
      existingTask,
      words,
      states,
      histories,
    ] = await Promise.all([
      this.repositories.settings.get(),
      this.repositories.dailyTasks.list(),
      this.repositories.dailyTasks.getByDate(date),
      this.repositories.words.list(),
      this.repositories.reviewStates.listAll(),
      this.repositories.learningHistory.listByBeijingDate(date),
    ]);
    const statesByWordId = new Map(
      states.map((state) => [state.wordId, state]),
    );
    const validWordIds = new Set(words.map((word) => word.id));
    const availableNewWordIds = words
      .filter((word) => !statesByWordId.has(word.id))
      .map((word) => word.id);
    const historyCompletions =
      getGlobalCompletionIdsFromHistory(histories);
    const completedNewWordIds = unique([
      ...(existingTask?.completedGlobalNewWordIds ?? []),
      ...historyCompletions.newWordIds,
    ]).filter((id) => validWordIds.has(id));
    const completedReviewWordIds = unique([
      ...(existingTask?.completedGlobalReviewWordIds ?? []),
      ...historyCompletions.reviewWordIds,
    ]).filter((id) => validWordIds.has(id));
    const previousTask = tasks
      .filter((task) => task.beijingDate < date)
      .at(-1);
    const carryoverTasks =
      existingTask?.carryoverTasks ??
      (previousTask ? getOutstandingTasks(previousTask) : 0);
    const baseGoal =
      settings?.dailyBaseGoal ??
      existingTask?.baseGoal ??
      0;
    const nextTask = createDailyTaskSnapshot({
      beijingDate: date,
      existingTask,
      updatedAtMs: atMs,
      baseGoal,
      carryoverTasks,
      availableNewWordCount: availableNewWordIds.length,
      completedGlobalNewWordIds: completedNewWordIds,
      completedGlobalReviewWordIds: completedReviewWordIds,
    });
    const persistedTask =
      existingTask && taskMatches(existingTask, nextTask)
        ? existingTask
        : await this.repositories.dailyProgress.saveTask(nextTask);
    const counts = calculateDailyTaskCounts({
      baseGoal: persistedTask.baseGoal,
      carryoverTasks: persistedTask.carryoverTasks,
      availableNewWordCount: availableNewWordIds.length,
      completedGlobalNewWordIds:
        persistedTask.completedGlobalNewWordIds,
      completedGlobalReviewWordIds:
        persistedTask.completedGlobalReviewWordIds,
    });

    return {
      date,
      configured: settings !== null,
      task: persistedTask,
      availableNewWordCount: availableNewWordIds.length,
      availableNewWordIds,
      totalWordCount: words.length,
      startedWordCount: words.filter((word) =>
        statesByWordId.has(word.id),
      ).length,
      dueReviewCount: states.filter(
        (state) =>
          state.nextReviewAtMs !== null &&
          state.nextReviewAtMs <= atMs &&
          validWordIds.has(state.wordId),
      ).length,
      totalCompletedCount: counts.totalCompletedCount,
      remainingTaskCount: counts.remainingTaskCount,
      goalAchieved: counts.goalAchieved,
    };
  }

  async updateBaseGoal(
    dailyBaseGoal: number,
    atMs: number,
  ): Promise<TodayProgress> {
    assertEpochMilliseconds(atMs, "目标修改时间");
    const progress = await this.getToday(atMs);
    const nextTask = createDailyTaskSnapshot({
      beijingDate: progress.task.beijingDate,
      existingTask: progress.task,
      updatedAtMs: atMs,
      baseGoal: dailyBaseGoal,
      carryoverTasks: progress.task.carryoverTasks,
      availableNewWordCount: progress.availableNewWordCount,
      completedGlobalNewWordIds:
        progress.task.completedGlobalNewWordIds,
      completedGlobalReviewWordIds:
        progress.task.completedGlobalReviewWordIds,
    });
    await this.repositories.dailyProgress.saveGoalAndTask(
      dailyBaseGoal,
      nextTask,
    );
    return this.getToday(atMs);
  }

  createFeedbackTaskUpdate(
    progress: TodayProgress,
    wordId: string,
    isNewWord: boolean,
    feedbackAtMs: number,
  ): FeedbackTaskUpdate {
    if (
      isNewWord &&
      !progress.availableNewWordIds.includes(wordId)
    ) {
      throw new Error("该单词已经不在今日可安排新词范围内。");
    }
    if (isNewWord && progress.remainingTaskCount <= 0) {
      throw new Error("今日新词任务已经完成，不能继续安排新词。");
    }

    const completedNewWordIds = [
      ...progress.task.completedGlobalNewWordIds,
    ];
    const completedReviewWordIds = [
      ...progress.task.completedGlobalReviewWordIds,
    ];

    if (isNewWord) {
      completedNewWordIds.push(wordId);
    } else {
      completedReviewWordIds.push(wordId);
    }

    const availableNewWordCount = Math.max(
      0,
      progress.availableNewWordCount - (isNewWord ? 1 : 0),
    );
    const nextTask = createDailyTaskSnapshot({
      beijingDate: progress.task.beijingDate,
      existingTask: progress.task,
      updatedAtMs: feedbackAtMs,
      baseGoal: progress.task.baseGoal,
      carryoverTasks: progress.task.carryoverTasks,
      availableNewWordCount,
      completedGlobalNewWordIds: completedNewWordIds,
      completedGlobalReviewWordIds: completedReviewWordIds,
    });

    return {
      expectedTask: progress.task,
      nextTask,
      isNewWord,
    };
  }

  async getRecentDays(
    atMs: number,
    dayCount = 7,
  ): Promise<RecentDayProgress[]> {
    assertEpochMilliseconds(atMs, "统计时间");
    if (!Number.isInteger(dayCount) || dayCount <= 0) {
      throw new Error("统计天数必须是正整数。");
    }

    const today = await this.getToday(atMs);
    const dates: string[] = [today.date];
    while (dates.length < dayCount) {
      dates.unshift(shiftBeijingDate(dates[0], -1));
    }

    return Promise.all(
      dates.map(async (date) => {
        const histories =
          await this.repositories.learningHistory.listByBeijingDate(
            date,
          );
        const completions =
          getGlobalCompletionIdsFromHistory(histories);
        return {
          date,
          newCompletedCount: completions.newWordIds.length,
          reviewCompletedCount: completions.reviewWordIds.length,
        };
      }),
    );
  }
}

