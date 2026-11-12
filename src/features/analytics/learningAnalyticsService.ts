import {
  assertEpochMilliseconds,
  shiftBeijingDate,
  toBeijingDate,
  type Feedback,
  type LearningHistory,
  type Repositories,
} from "../../data";
import {
  DailyProgressService,
  getGlobalCompletionIdsFromHistory,
  type TodayProgress,
} from "../daily/dailyProgressService";
import {
  buildWeakWordItems,
  weakScoreIncrement,
  type WeakWordItem,
} from "../weak/weakWordService";

export type AnalyticsRange = "7d" | "30d" | "all";

export interface DailyLearningPoint {
  date: string;
  newCompletedCount: number;
  reviewCompletedCount: number;
  forgottenCount: number;
  fuzzyCount: number;
  rememberedCount: number;
  weakWordCount: number;
}

export interface FeedbackBreakdown {
  forgotten: number;
  fuzzy: number;
  remembered: number;
  total: number;
  forgottenPercent: number;
  fuzzyPercent: number;
  rememberedPercent: number;
}

export interface WeakDistributionBucket {
  key: "1-2" | "3-5" | "6-10" | "11+";
  label: string;
  minimum: number;
  maximum: number | null;
  count: number;
}

export interface GroupLearningAnalytics {
  groupId: string;
  name: string;
  wordCount: number;
  startedCount: number;
  unstartedCount: number;
  historyCount: number;
}

export interface AnalyticsDashboard {
  today: TodayProgress;
  points: DailyLearningPoint[];
  currentWeakWordCount: number;
  weakDistribution: WeakDistributionBucket[];
  groups: GroupLearningAnalytics[];
}

export interface AnalyticsRangeView {
  range: AnalyticsRange;
  startDate: string;
  endDate: string;
  points: DailyLearningPoint[];
  feedback: FeedbackBreakdown;
  newCompletedCount: number;
  reviewCompletedCount: number;
}

function feedbackCount(
  feedback: Feedback,
): keyof Pick<
  DailyLearningPoint,
  "forgottenCount" | "fuzzyCount" | "rememberedCount"
> {
  if (feedback === "forgotten") return "forgottenCount";
  if (feedback === "fuzzy") return "fuzzyCount";
  return "rememberedCount";
}

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = shiftBeijingDate(cursor, 1);
  }
  return dates;
}

function breakdownFromPoints(
  points: readonly DailyLearningPoint[],
): FeedbackBreakdown {
  const counts = points.reduce(
    (total, point) => ({
      forgotten: total.forgotten + point.forgottenCount,
      fuzzy: total.fuzzy + point.fuzzyCount,
      remembered: total.remembered + point.rememberedCount,
    }),
    { forgotten: 0, fuzzy: 0, remembered: 0 },
  );
  const total = counts.forgotten + counts.fuzzy + counts.remembered;
  const percent = (count: number): number =>
    total === 0 ? 0 : Math.round((count / total) * 1000) / 10;

  return {
    ...counts,
    total,
    forgottenPercent: percent(counts.forgotten),
    fuzzyPercent: percent(counts.fuzzy),
    rememberedPercent: percent(counts.remembered),
  };
}

export function buildWeakDistribution(
  items: readonly WeakWordItem[],
): WeakDistributionBucket[] {
  const buckets: WeakDistributionBucket[] = [
    { key: "1-2", label: "1–2 分", minimum: 1, maximum: 2, count: 0 },
    { key: "3-5", label: "3–5 分", minimum: 3, maximum: 5, count: 0 },
    { key: "6-10", label: "6–10 分", minimum: 6, maximum: 10, count: 0 },
    { key: "11+", label: "11 分以上", minimum: 11, maximum: null, count: 0 },
  ];
  for (const item of items) {
    const bucket = buckets.find(
      (candidate) =>
        item.weakScore >= candidate.minimum &&
        (candidate.maximum === null ||
          item.weakScore <= candidate.maximum),
    );
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export function selectAnalyticsRange(
  dashboard: AnalyticsDashboard,
  range: AnalyticsRange,
): AnalyticsRangeView {
  const endDate = dashboard.today.date;
  let points: DailyLearningPoint[];

  if (range === "all") {
    points = dashboard.points;
  } else {
    const dayCount = range === "7d" ? 7 : 30;
    const startDate = shiftBeijingDate(endDate, -(dayCount - 1));
    const byDate = new Map(
      dashboard.points.map((point) => [point.date, point]),
    );
    points = datesBetween(startDate, endDate).map(
      (date) =>
        byDate.get(date) ?? {
          date,
          newCompletedCount: 0,
          reviewCompletedCount: 0,
          forgottenCount: 0,
          fuzzyCount: 0,
          rememberedCount: 0,
          weakWordCount: 0,
        },
    );
  }

  return {
    range,
    startDate: points[0]?.date ?? endDate,
    endDate,
    points,
    feedback: breakdownFromPoints(points),
    newCompletedCount: points.reduce(
      (total, point) => total + point.newCompletedCount,
      0,
    ),
    reviewCompletedCount: points.reduce(
      (total, point) => total + point.reviewCompletedCount,
      0,
    ),
  };
}

export class LearningAnalyticsService {
  private readonly repositories: Repositories;
  private readonly dailyProgress: DailyProgressService;

  constructor(repositories: Repositories) {
    this.repositories = repositories;
    this.dailyProgress = new DailyProgressService(repositories);
  }

  async getDashboard(atMs: number): Promise<AnalyticsDashboard> {
    assertEpochMilliseconds(atMs, "统计时间");
    const todayDate = toBeijingDate(atMs);
    const [today, words, states, groups, associations, histories] =
      await Promise.all([
        this.dailyProgress.getToday(atMs),
        this.repositories.words.list(),
        this.repositories.reviewStates.listAll(),
        this.repositories.groups.list(),
        this.repositories.wordGroups.listAll(),
        this.repositories.learningHistory.listAll(),
      ]);

    const historiesByDate = new Map<string, LearningHistory[]>();
    for (const history of histories) {
      const dayHistories = historiesByDate.get(history.beijingDate) ?? [];
      dayHistories.push(history);
      historiesByDate.set(history.beijingDate, dayHistories);
    }
    const earliestDate = histories
      .map((history) => history.beijingDate)
      .sort()[0];
    const startDate = earliestDate ?? todayDate;
    const dates = datesBetween(startDate, todayDate);
    if (dates.length === 0) dates.push(todayDate);

    const weakScores = new Map<string, number>();
    const points = dates.map((date): DailyLearningPoint => {
      const dayHistories = historiesByDate.get(date) ?? [];
      const completions =
        getGlobalCompletionIdsFromHistory(dayHistories);
      const feedbackCounts = {
        forgottenCount: 0,
        fuzzyCount: 0,
        rememberedCount: 0,
      };

      for (const history of dayHistories) {
        feedbackCounts[feedbackCount(history.feedback)] += 1;
        weakScores.set(
          history.wordId,
          (weakScores.get(history.wordId) ?? 0) +
            weakScoreIncrement(history.feedback),
        );
      }

      return {
        date,
        newCompletedCount: completions.newWordIds.length,
        reviewCompletedCount: completions.reviewWordIds.length,
        ...feedbackCounts,
        weakWordCount: Array.from(weakScores.values()).filter(
          (score) => score > 0,
        ).length,
      };
    });

    const weakItems = buildWeakWordItems(words, states, histories);
    const stateWordIds = new Set(states.map((state) => state.wordId));
    const associationCountByGroup = new Map<string, number>();
    const memberWordIdsByGroup = new Map<string, Set<string>>();
    for (const association of associations) {
      associationCountByGroup.set(
        association.groupId,
        (associationCountByGroup.get(association.groupId) ?? 0) + 1,
      );
      const memberIds =
        memberWordIdsByGroup.get(association.groupId) ?? new Set<string>();
      memberIds.add(association.wordId);
      memberWordIdsByGroup.set(association.groupId, memberIds);
    }
    const groupHistoryCount = new Map<string, number>();
    for (const history of histories) {
      if (history.source !== "group" || !history.groupId) continue;
      groupHistoryCount.set(
        history.groupId,
        (groupHistoryCount.get(history.groupId) ?? 0) + 1,
      );
    }
    const groupStats = groups.map((group): GroupLearningAnalytics => {
      const memberIds =
        memberWordIdsByGroup.get(group.id) ?? new Set<string>();
      const startedCount = Array.from(memberIds).filter((wordId) =>
        stateWordIds.has(wordId),
      ).length;
      return {
        groupId: group.id,
        name: group.name,
        wordCount: associationCountByGroup.get(group.id) ?? 0,
        startedCount,
        unstartedCount: memberIds.size - startedCount,
        historyCount: groupHistoryCount.get(group.id) ?? 0,
      };
    });

    return {
      today,
      points,
      currentWeakWordCount: weakItems.length,
      weakDistribution: buildWeakDistribution(weakItems),
      groups: groupStats,
    };
  }
}
