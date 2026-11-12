import { describe, expect, it } from "vitest";

import {
  calculateDailyTaskCounts,
  createDailyTaskSnapshot,
} from "./dailyTaskCalculator";

describe("每日任务数量计算", () => {
  it("支持基础目标 0、1 和 999", () => {
    for (const baseGoal of [0, 1, 999]) {
      const counts = calculateDailyTaskCounts({
        baseGoal,
        carryoverTasks: 0,
        availableNewWordCount: 1_000,
        completedGlobalNewWordIds: [],
        completedGlobalReviewWordIds: [],
      });
      expect(counts.nominalTaskCount).toBe(baseGoal);
      expect(counts.effectiveTaskCount).toBe(baseGoal);
    }
  });

  it("名义任务等于基础目标加累计结转", () => {
    const counts = calculateDailyTaskCounts({
      baseGoal: 20,
      carryoverTasks: 8,
      availableNewWordCount: 100,
      completedGlobalNewWordIds: [],
      completedGlobalReviewWordIds: [],
    });

    expect(counts.nominalTaskCount).toBe(28);
    expect(counts.effectiveTaskCount).toBe(28);
    expect(counts.remainingTaskCount).toBe(28);
  });

  it("新词不足时按实际可安排数量限制有效任务", () => {
    const counts = calculateDailyTaskCounts({
      baseGoal: 20,
      carryoverTasks: 8,
      availableNewWordCount: 2,
      completedGlobalNewWordIds: ["word-1", "word-2", "word-3"],
      completedGlobalReviewWordIds: [],
    });

    expect(counts.nominalTaskCount).toBe(28);
    expect(counts.effectiveTaskCount).toBe(5);
    expect(counts.completedCount).toBe(3);
    expect(counts.remainingTaskCount).toBe(2);
  });

  it("导入新词后动态增加有效任务但不超过名义目标", () => {
    const before = calculateDailyTaskCounts({
      baseGoal: 20,
      carryoverTasks: 8,
      availableNewWordCount: 2,
      completedGlobalNewWordIds: ["word-1", "word-2", "word-3"],
      completedGlobalReviewWordIds: [],
    });
    const after = calculateDailyTaskCounts({
      baseGoal: 20,
      carryoverTasks: 8,
      availableNewWordCount: 22,
      completedGlobalNewWordIds: ["word-1", "word-2", "word-3"],
      completedGlobalReviewWordIds: [],
    });

    expect(before.effectiveTaskCount).toBe(5);
    expect(after.effectiveTaskCount).toBe(25);
  });

  it("修改目标低于已完成数量时保留完成且剩余不为负", () => {
    const counts = calculateDailyTaskCounts({
      baseGoal: 0,
      carryoverTasks: 5,
      availableNewWordCount: 100,
      completedGlobalNewWordIds: ["a", "b", "c", "d", "e", "f"],
      completedGlobalReviewWordIds: [],
    });

    expect(counts.effectiveTaskCount).toBe(5);
    expect(counts.completedCount).toBe(6);
    expect(counts.remainingTaskCount).toBe(0);
    expect(counts.goalAchieved).toBe(true);
  });

  it("同一单词不同任务类别分别计数，同类别集合会去重", () => {
    const counts = calculateDailyTaskCounts({
      baseGoal: 10,
      carryoverTasks: 0,
      availableNewWordCount: 20,
      completedGlobalNewWordIds: ["same", "same"],
      completedGlobalReviewWordIds: ["same", "same"],
    });

    expect(counts.completedCount).toBe(1);
    expect(counts.completedReviewCount).toBe(1);
    expect(counts.totalCompletedCount).toBe(2);
  });

  it("拒绝非法目标和负数输入", () => {
    expect(() =>
      calculateDailyTaskCounts({
        baseGoal: 1_000,
        carryoverTasks: 0,
        availableNewWordCount: 0,
        completedGlobalNewWordIds: [],
        completedGlobalReviewWordIds: [],
      }),
    ).toThrow("0–999");
    expect(() =>
      calculateDailyTaskCounts({
        baseGoal: 10,
        carryoverTasks: -1,
        availableNewWordCount: 0,
        completedGlobalNewWordIds: [],
        completedGlobalReviewWordIds: [],
      }),
    ).toThrow("累计结转");
  });

  it("生成快照时保留创建时间并去重完成 ID", () => {
    const task = createDailyTaskSnapshot({
      beijingDate: "2026-01-01",
      existingTask: {
        beijingDate: "2026-01-01",
        baseGoal: 10,
        carryoverTasks: 0,
        nominalTaskCount: 10,
        effectiveTaskCount: 10,
        completedCount: 0,
        completedGlobalNewWordIds: [],
        completedGlobalReviewWordIds: [],
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      updatedAtMs: 2,
      baseGoal: 10,
      carryoverTasks: 0,
      availableNewWordCount: 9,
      completedGlobalNewWordIds: ["word", "word"],
      completedGlobalReviewWordIds: [],
    });

    expect(task.completedGlobalNewWordIds).toEqual(["word"]);
    expect(task.completedCount).toBe(1);
    expect(task.createdAtMs).toBe(1);
    expect(task.updatedAtMs).toBe(2);
  });
});

