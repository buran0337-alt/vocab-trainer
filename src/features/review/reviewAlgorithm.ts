import {
  assertEpochMilliseconds,
  ceilEpochMillisecondsToMinute,
  DataValidationError,
  INITIAL_EF,
  MINIMUM_EF,
  toBeijingDate,
  type Feedback,
  type ReviewState,
} from "../../data";

export type FeedbackQuality = 1 | 3 | 5;
export type ReviewStateValues = Pick<
  ReviewState,
  | "ef"
  | "consecutiveSuccesses"
  | "consecutiveForgets"
  | "weakScore"
  | "intervalMinutes"
  | "lastFeedbackAtMs"
  | "nextReviewAtMs"
>;

export interface ReviewAlgorithmInput {
  state: ReviewStateValues;
  feedback: Feedback;
  feedbackAtMs: number;
}

export interface ReviewAlgorithmResult extends ReviewStateValues {
  quality: FeedbackQuality;
  previousEf: number;
  feedbackAtMs: number;
  beijingDate: string;
}

const MINUTES_PER_DAY = 24 * 60;
const QUALITY_BY_FEEDBACK: Readonly<Record<Feedback, FeedbackQuality>> = {
  forgotten: 1,
  fuzzy: 3,
  remembered: 5,
};

function assertValidFeedback(feedback: Feedback): void {
  if (
    !Object.prototype.hasOwnProperty.call(
      QUALITY_BY_FEEDBACK,
      feedback,
    )
  ) {
    throw new DataValidationError("复习反馈必须是忘记、模糊或记住。");
  }
}

function assertValidEf(ef: number): void {
  if (!Number.isFinite(ef) || ef < MINIMUM_EF) {
    throw new DataValidationError(
      `EF 必须是大于或等于 ${MINIMUM_EF} 的有限数字。`,
    );
  }
  if (roundToTwoDecimals(ef) !== ef) {
    throw new DataValidationError("EF 必须保留最多两位小数。");
  }
}

function assertNonNegativeSafeInteger(
  value: number,
  fieldName: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DataValidationError(`${fieldName}必须是非负安全整数。`);
  }
}

function assertNullableTimestamp(
  value: number | null,
  fieldName: string,
): void {
  if (value !== null) {
    assertEpochMilliseconds(value, fieldName);
  }
}

function assertValidState(state: ReviewStateValues | undefined): asserts state is ReviewStateValues {
  if (!state || typeof state !== "object") {
    throw new DataValidationError("复习状态不能为空。");
  }

  assertValidEf(state.ef);
  assertNonNegativeSafeInteger(
    state.consecutiveSuccesses,
    "连续成功次数",
  );
  assertNonNegativeSafeInteger(
    state.consecutiveForgets,
    "连续忘记次数",
  );
  assertNonNegativeSafeInteger(state.weakScore, "累计薄弱分数");

  if (state.intervalMinutes !== null) {
    if (
      !Number.isSafeInteger(state.intervalMinutes) ||
      state.intervalMinutes <= 0
    ) {
      throw new DataValidationError("上次间隔必须是正整数分钟或 null。");
    }
  }

  assertNullableTimestamp(state.lastFeedbackAtMs, "上次反馈时间");
  assertNullableTimestamp(state.nextReviewAtMs, "下次到期时间");
}

function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getFeedbackQuality(feedback: Feedback): FeedbackQuality {
  assertValidFeedback(feedback);
  return QUALITY_BY_FEEDBACK[feedback];
}

/**
 * R02/R05: apply the SM-2 EF formula, clamp to 1.3, then round to 2 decimals.
 * There is deliberately no upper limit.
 */
export function calculateEf(
  previousEf: number,
  feedback: Feedback,
): number {
  assertValidEf(previousEf);
  const quality = getFeedbackQuality(feedback);
  const distanceFromFive = 5 - quality;
  const rawEf =
    previousEf +
    (0.1 -
      distanceFromFive * (0.08 + distanceFromFive * 0.02));
  const roundedEf = roundToTwoDecimals(
    Math.max(MINIMUM_EF, rawEf),
  );

  if (!Number.isFinite(roundedEf)) {
    throw new DataValidationError("EF 计算结果不是有限数字。");
  }

  return roundedEf;
}

export interface ReviewIntervalInput {
  feedback: Feedback;
  consecutiveSuccessesBefore: number;
  intervalMinutesBefore: number | null;
  efBefore: number;
}

/**
 * R05-R07: calculate the whole interval with the pre-feedback EF.
 * The EF must be updated only after this function returns.
 */
export function calculateReviewIntervalMinutes(
  input: ReviewIntervalInput,
): number {
  assertValidFeedback(input.feedback);
  assertValidEf(input.efBefore);
  assertNonNegativeSafeInteger(
    input.consecutiveSuccessesBefore,
    "连续成功次数",
  );

  if (input.feedback === "forgotten") {
    return 10;
  }
  if (input.feedback === "fuzzy") {
    return MINUTES_PER_DAY;
  }

  const successNumber = input.consecutiveSuccessesBefore + 1;
  if (!Number.isSafeInteger(successNumber)) {
    throw new DataValidationError("连续成功次数超过安全整数范围。");
  }
  if (successNumber === 1) {
    return MINUTES_PER_DAY;
  }
  if (successNumber === 2) {
    return 6 * MINUTES_PER_DAY;
  }

  if (
    input.intervalMinutesBefore === null ||
    !Number.isSafeInteger(input.intervalMinutesBefore) ||
    input.intervalMinutesBefore <= 0 ||
    input.intervalMinutesBefore % MINUTES_PER_DAY !== 0
  ) {
    throw new DataValidationError(
      "第三次及以后记住时，上次间隔必须是正整数整天。",
    );
  }

  const previousDays =
    input.intervalMinutesBefore / MINUTES_PER_DAY;
  const nextDays = Math.round(previousDays * input.efBefore);
  const nextIntervalMinutes = nextDays * MINUTES_PER_DAY;

  if (
    !Number.isSafeInteger(nextDays) ||
    nextDays < 1 ||
    !Number.isSafeInteger(nextIntervalMinutes)
  ) {
    throw new DataValidationError("计算出的复习间隔超出安全范围。");
  }

  return nextIntervalMinutes;
}

export function calculateNextReviewAtMs(
  feedbackAtMs: number,
  intervalMinutes: number,
): number {
  assertEpochMilliseconds(feedbackAtMs, "反馈时间");
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes <= 0) {
    throw new DataValidationError("复习间隔必须是正整数分钟。");
  }

  const theoreticalMs =
    feedbackAtMs + intervalMinutes * 60_000;
  assertEpochMilliseconds(theoreticalMs, "理论到期时间");
  return ceilEpochMillisecondsToMinute(theoreticalMs);
}

/**
 * Pure single-feedback transition. The input state is not mutated.
 */
export function applyReviewFeedback(
  input: ReviewAlgorithmInput,
): ReviewAlgorithmResult {
  assertValidState(input.state);
  assertValidFeedback(input.feedback);
  assertEpochMilliseconds(input.feedbackAtMs, "反馈时间");

  const previousEf = input.state.ef;
  // R05 requires the interval to use the pre-feedback EF.
  const intervalMinutes = calculateReviewIntervalMinutes({
    feedback: input.feedback,
    consecutiveSuccessesBefore: input.state.consecutiveSuccesses,
    intervalMinutesBefore: input.state.intervalMinutes,
    efBefore: previousEf,
  });
  const ef = calculateEf(previousEf, input.feedback);

  let consecutiveSuccesses: number;
  let consecutiveForgets: number;
  let weakScore: number;

  if (input.feedback === "forgotten") {
    consecutiveSuccesses = 0;
    consecutiveForgets = input.state.consecutiveForgets + 1;
    weakScore = input.state.weakScore + 3;
  } else if (input.feedback === "fuzzy") {
    consecutiveSuccesses = 0;
    consecutiveForgets = 0;
    weakScore = input.state.weakScore + 1;
  } else {
    consecutiveSuccesses = input.state.consecutiveSuccesses + 1;
    consecutiveForgets = 0;
    weakScore = input.state.weakScore;
  }

  assertNonNegativeSafeInteger(
    consecutiveSuccesses,
    "连续成功次数",
  );
  assertNonNegativeSafeInteger(
    consecutiveForgets,
    "连续忘记次数",
  );
  assertNonNegativeSafeInteger(weakScore, "累计薄弱分数");

  return {
    ef,
    consecutiveSuccesses,
    consecutiveForgets,
    weakScore,
    intervalMinutes,
    lastFeedbackAtMs: input.feedbackAtMs,
    nextReviewAtMs: calculateNextReviewAtMs(
      input.feedbackAtMs,
      intervalMinutes,
    ),
    quality: getFeedbackQuality(input.feedback),
    previousEf,
    feedbackAtMs: input.feedbackAtMs,
    beijingDate: toBeijingDate(input.feedbackAtMs),
  };
}

export function createInitialReviewStateValues(): ReviewStateValues {
  return {
    ef: INITIAL_EF,
    consecutiveSuccesses: 0,
    consecutiveForgets: 0,
    weakScore: 0,
    intervalMinutes: null,
    lastFeedbackAtMs: null,
    nextReviewAtMs: null,
  };
}

