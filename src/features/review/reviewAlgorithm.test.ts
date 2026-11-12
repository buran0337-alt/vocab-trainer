/// <reference types="node" />

import { describe, expect, it } from "vitest";

import {
  DataValidationError,
  toBeijingDate,
  type Feedback,
} from "../../data";
import {
  applyReviewFeedback,
  calculateEf,
  calculateNextReviewAtMs,
  calculateReviewIntervalMinutes,
  createInitialReviewStateValues,
  getFeedbackQuality,
  type ReviewStateValues,
} from "./reviewAlgorithm";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function state(
  changes: Partial<ReviewStateValues> = {},
): ReviewStateValues {
  return {
    ...createInitialReviewStateValues(),
    ...changes,
  };
}

describe("EF 与反馈评分", () => {
  it("新复习状态从 EF 2.5 和零计数开始", () => {
    expect(createInitialReviewStateValues()).toEqual({
      ef: 2.5,
      consecutiveSuccesses: 0,
      consecutiveForgets: 0,
      weakScore: 0,
      intervalMinutes: null,
      lastFeedbackAtMs: null,
      nextReviewAtMs: null,
    });
  });

  it("将三种反馈映射为评分 1、3、5", () => {
    expect(getFeedbackQuality("forgotten")).toBe(1);
    expect(getFeedbackQuality("fuzzy")).toBe(3);
    expect(getFeedbackQuality("remembered")).toBe(5);
  });

  it("EF 按公式正常增加和减少，并保留两位小数", () => {
    expect(calculateEf(2.5, "remembered")).toBe(2.6);
    expect(calculateEf(2.5, "fuzzy")).toBe(2.36);
    expect(calculateEf(2.5, "forgotten")).toBe(1.96);
  });

  it("EF 不低于 1.3", () => {
    expect(calculateEf(1.3, "forgotten")).toBe(1.3);
    expect(calculateEf(1.31, "fuzzy")).toBe(1.3);
  });

  it("EF 没有人为上限", () => {
    expect(calculateEf(1000.5, "remembered")).toBe(1000.6);
    expect(calculateEf(10_000, "remembered")).toBe(10_000.1);
  });
});

describe("连续成功与忘记次数", () => {
  const feedbackAtMs = Date.UTC(2026, 5, 1, 4, 0, 0);

  it("记住后连续成功加一并清零连续忘记", () => {
    const result = applyReviewFeedback({
      state: state({
        consecutiveSuccesses: 1,
        consecutiveForgets: 2,
        intervalMinutes: 1_440,
      }),
      feedback: "remembered",
      feedbackAtMs,
    });

    expect(result.consecutiveSuccesses).toBe(2);
    expect(result.consecutiveForgets).toBe(0);
  });

  it("模糊后连续成功和连续忘记都归零，并增加薄弱分 1", () => {
    const result = applyReviewFeedback({
      state: state({
        consecutiveSuccesses: 4,
        consecutiveForgets: 2,
        weakScore: 5,
      }),
      feedback: "fuzzy",
      feedbackAtMs,
    });

    expect(result.consecutiveSuccesses).toBe(0);
    expect(result.consecutiveForgets).toBe(0);
    expect(result.weakScore).toBe(6);
  });

  it("忘记后连续成功归零、连续忘记加一，并增加薄弱分 3", () => {
    const result = applyReviewFeedback({
      state: state({
        consecutiveSuccesses: 4,
        consecutiveForgets: 2,
        weakScore: 5,
      }),
      feedback: "forgotten",
      feedbackAtMs,
    });

    expect(result.consecutiveSuccesses).toBe(0);
    expect(result.consecutiveForgets).toBe(3);
    expect(result.weakScore).toBe(8);
  });

  it("忘记后快速重练选择记住时进入第一次成功阶段", () => {
    const forgotten = applyReviewFeedback({
      state: state({ consecutiveSuccesses: 3 }),
      feedback: "forgotten",
      feedbackAtMs,
    });
    const remembered = applyReviewFeedback({
      state: forgotten,
      feedback: "remembered",
      feedbackAtMs: forgotten.nextReviewAtMs as number,
    });

    expect(remembered.consecutiveSuccesses).toBe(1);
    expect(remembered.intervalMinutes).toBe(24 * 60);
    expect(remembered.nextReviewAtMs).toBe(
      (remembered.feedbackAtMs as number) + DAY,
    );
  });

  it("忘记后再次忘记仍在 10 分钟后重练", () => {
    const first = applyReviewFeedback({
      state: state(),
      feedback: "forgotten",
      feedbackAtMs,
    });
    const second = applyReviewFeedback({
      state: first,
      feedback: "forgotten",
      feedbackAtMs: first.nextReviewAtMs as number,
    });

    expect(second.consecutiveForgets).toBe(2);
    expect(second.intervalMinutes).toBe(10);
    expect(second.nextReviewAtMs).toBe(
      (second.feedbackAtMs as number) + 10 * MINUTE,
    );
  });

  it("忘记后快速重练选择模糊时按模糊规则处理", () => {
    const forgotten = applyReviewFeedback({
      state: state(),
      feedback: "forgotten",
      feedbackAtMs,
    });
    const fuzzy = applyReviewFeedback({
      state: forgotten,
      feedback: "fuzzy",
      feedbackAtMs: forgotten.nextReviewAtMs as number,
    });

    expect(fuzzy.consecutiveSuccesses).toBe(0);
    expect(fuzzy.consecutiveForgets).toBe(0);
    expect(fuzzy.intervalMinutes).toBe(24 * 60);
  });
});

describe("复习间隔", () => {
  it("忘记为 10 分钟、模糊为 24 小时", () => {
    expect(
      calculateReviewIntervalMinutes({
        feedback: "forgotten",
        consecutiveSuccessesBefore: 5,
        intervalMinutesBefore: 6 * 1_440,
        efBefore: 2.5,
      }),
    ).toBe(10);
    expect(
      calculateReviewIntervalMinutes({
        feedback: "fuzzy",
        consecutiveSuccessesBefore: 5,
        intervalMinutesBefore: 6 * 1_440,
        efBefore: 2.5,
      }),
    ).toBe(24 * 60);
  });

  it("第一次和第二次连续记住分别为 1 天和 6 天", () => {
    expect(
      calculateReviewIntervalMinutes({
        feedback: "remembered",
        consecutiveSuccessesBefore: 0,
        intervalMinutesBefore: null,
        efBefore: 2.5,
      }),
    ).toBe(1_440);
    expect(
      calculateReviewIntervalMinutes({
        feedback: "remembered",
        consecutiveSuccessesBefore: 1,
        intervalMinutesBefore: 1_440,
        efBefore: 2.5,
      }),
    ).toBe(8_640);
  });

  it("第三次起使用反馈前的旧 EF 乘上次整天间隔", () => {
    const interval = calculateReviewIntervalMinutes({
      feedback: "remembered",
      consecutiveSuccessesBefore: 2,
      intervalMinutesBefore: 6 * 1_440,
      efBefore: 2.55,
    });

    expect(interval).toBe(15 * 1_440);
  });

  it("第三次计算确实先使用旧 EF，再更新 EF", () => {
    const feedbackAtMs = Date.UTC(2026, 1, 1, 4, 0, 0);
    const result = applyReviewFeedback({
      state: state({
        ef: 2.55,
        consecutiveSuccesses: 2,
        intervalMinutes: 6 * 1_440,
      }),
      feedback: "remembered",
      feedbackAtMs,
    });

    expect(result.ef).toBe(2.65);
    expect(result.intervalMinutes).toBe(15 * 1_440);
    expect(result.nextReviewAtMs).toBe(
      feedbackAtMs + 15 * DAY,
    );
  });

  it("支持较大的连续成功次数和较长间隔", () => {
    expect(
      calculateReviewIntervalMinutes({
        feedback: "remembered",
        consecutiveSuccessesBefore: 10_000,
        intervalMinutesBefore: 1_000 * 1_440,
        efBefore: 1.3,
      }),
    ).toBe(1_300 * 1_440);
  });

  it("第三次记住但上次间隔缺失或不是整天时拒绝计算", () => {
    expect(() =>
      calculateReviewIntervalMinutes({
        feedback: "remembered",
        consecutiveSuccessesBefore: 2,
        intervalMinutesBefore: null,
        efBefore: 2.5,
      }),
    ).toThrow(DataValidationError);
    expect(() =>
      calculateReviewIntervalMinutes({
        feedback: "remembered",
        consecutiveSuccessesBefore: 2,
        intervalMinutesBefore: 1_441,
        efBefore: 2.5,
      }),
    ).toThrow("上次间隔必须是正整数整天");
  });
});

describe("到期时间与北京时间", () => {
  it("恰好整分钟时保持原分钟", () => {
    const feedbackAtMs = Date.UTC(2026, 0, 1, 4, 0, 0);
    expect(calculateNextReviewAtMs(feedbackAtMs, 10)).toBe(
      feedbackAtMs + 10 * MINUTE,
    );
  });

  it("秒或毫秒不为零时向上取整到下一分钟", () => {
    const withSeconds = Date.UTC(2026, 0, 1, 4, 0, 40);
    const withMilliseconds = withSeconds + 999;
    expect(calculateNextReviewAtMs(withSeconds, 10)).toBe(
      Date.UTC(2026, 0, 1, 4, 11, 0),
    );
    expect(calculateNextReviewAtMs(withMilliseconds, 10)).toBe(
      Date.UTC(2026, 0, 1, 4, 11, 0),
    );
  });

  it("到期时间永远不早于理论时间", () => {
    const feedbackAtMs = Date.UTC(2026, 2, 1, 6, 7, 31, 527);
    for (const interval of [10, 1_440, 8_640]) {
      const due = calculateNextReviewAtMs(feedbackAtMs, interval);
      expect(due).toBeGreaterThanOrEqual(
        feedbackAtMs + interval * MINUTE,
      );
      expect(due % MINUTE).toBe(0);
    }
  });

  it("正确处理北京时间午夜、跨月、跨年和跨设备时区", () => {
    const atBeijingMidnight = Date.UTC(2025, 11, 31, 15, 55, 20);
    expect(toBeijingDate(atBeijingMidnight)).toBe("2025-12-31");

    const dueAfterMidnight = applyReviewFeedback({
      state: state(),
      feedback: "forgotten",
      feedbackAtMs: atBeijingMidnight,
    });
    expect(toBeijingDate(dueAfterMidnight.nextReviewAtMs as number)).toBe(
      "2026-01-01",
    );
    expect(dueAfterMidnight.beijingDate).toBe("2025-12-31");

    const endOfJanuary = Date.UTC(2026, 0, 31, 15, 58, 40);
    const nextMonth = applyReviewFeedback({
      state: state(),
      feedback: "forgotten",
      feedbackAtMs: endOfJanuary,
    });
    expect(toBeijingDate(nextMonth.nextReviewAtMs as number)).toBe(
      "2026-02-01",
    );

    const previousTimeZone = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const west = toBeijingDate(Date.UTC(2026, 6, 1, 16, 0, 0));
      process.env.TZ = "Pacific/Kiritimati";
      const east = toBeijingDate(Date.UTC(2026, 6, 1, 16, 0, 0));
      expect(west).toBe("2026-07-02");
      expect(east).toBe("2026-07-02");
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });
});

describe("输入校验与纯函数约束", () => {
  const feedbackAtMs = Date.UTC(2026, 0, 1, 4, 0, 0);

  it("相同输入产生相同输出且不修改输入状态", () => {
    const inputState = Object.freeze(
      state({
        ef: 2.55,
        consecutiveSuccesses: 2,
        intervalMinutes: 8_640,
      }),
    );
    const input = {
      state: inputState,
      feedback: "remembered" as const,
      feedbackAtMs,
    };

    const first = applyReviewFeedback(input);
    const second = applyReviewFeedback(input);

    expect(second).toEqual(first);
    expect(input.state).toEqual(inputState);
  });

  it("拒绝非法 EF", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.29,
      -2,
      2.555,
    ]) {
      expect(() => calculateEf(value, "remembered")).toThrow(
        DataValidationError,
      );
    }
  });

  it("拒绝非法连续次数、薄弱分和间隔", () => {
    expect(() =>
      applyReviewFeedback({
        state: state({ consecutiveSuccesses: -1 }),
        feedback: "remembered",
        feedbackAtMs,
      }),
    ).toThrow("连续成功次数");
    expect(() =>
      applyReviewFeedback({
        state: state({ consecutiveForgets: 1.5 }),
        feedback: "forgotten",
        feedbackAtMs,
      }),
    ).toThrow("连续忘记次数");
    expect(() =>
      applyReviewFeedback({
        state: state({ weakScore: -3 }),
        feedback: "fuzzy",
        feedbackAtMs,
      }),
    ).toThrow("累计薄弱分数");
    expect(() =>
      applyReviewFeedback({
        state: state({ intervalMinutes: 0 }),
        feedback: "remembered",
        feedbackAtMs,
      }),
    ).toThrow("上次间隔");
  });

  it("拒绝非法反馈、非法时间戳和缺失状态", () => {
    expect(() => getFeedbackQuality("unknown" as Feedback)).toThrow(
      "复习反馈",
    );
    expect(() =>
      applyReviewFeedback({
        state: state(),
        feedback: "remembered",
        feedbackAtMs: Number.NaN,
      }),
    ).toThrow("反馈时间");
    expect(() =>
      applyReviewFeedback({
        state: undefined as unknown as ReviewStateValues,
        feedback: "remembered",
        feedbackAtMs,
      }),
    ).toThrow("复习状态不能为空");
  });

  it("拒绝计数溢出", () => {
    expect(() =>
      applyReviewFeedback({
        state: state({
          consecutiveSuccesses: Number.MAX_SAFE_INTEGER,
        }),
        feedback: "remembered",
        feedbackAtMs,
      }),
    ).toThrow("安全整数");
  });
});

