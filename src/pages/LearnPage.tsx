import {
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import {
  DataValidationError,
  type Feedback,
  type LearningMode,
} from "../data";
import { getRepositories } from "../data/client";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  LearningSessionService,
  type FeedbackSubmission,
  type LearningCard,
} from "../features/learning/learningSessionService";

type LearnPhase =
  | "choose-mode"
  | "loading"
  | "learning"
  | "round-complete"
  | "empty"
  | "load-error";

type SaveStatus = "idle" | "saving" | "failed";

interface LearnPageProps {
  service?: LearningSessionService;
  now?: () => number;
}

const MODE_LABELS: Record<LearningMode, string> = {
  "english-to-chinese": "英译中",
  "chinese-to-english": "中译英",
};

const FEEDBACK_LABELS: Record<Feedback, string> = {
  forgotten: "忘记了",
  fuzzy: "模糊",
  remembered: "记住了",
};

function errorMessage(error: unknown): string {
  if (error instanceof DataValidationError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "学习操作失败，请稍后重试。";
}

export function LearnPage({
  service: providedService,
  now = Date.now,
}: LearnPageProps) {
  const [openedService, setOpenedService] =
    useState<LearningSessionService | null>(null);
  const service = providedService ?? openedService;
  const [openedServiceError, setOpenedServiceError] =
    useState<string | null>(null);
  const [phase, setPhase] = useState<LearnPhase>("choose-mode");
  const [mode, setMode] = useState<LearningMode | null>(null);
  const [round, setRound] = useState<LearningCard[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const failedSubmissionRef = useRef<FeedbackSubmission | null>(null);
  const currentCard = round[cardIndex] ?? null;

  useEffect(() => {
    if (providedService) {
      return;
    }

    let active = true;
    getRepositories()
      .then((repositories) => {
        if (active) {
          setOpenedService(new LearningSessionService(repositories));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setOpenedServiceError(errorMessage(error));
        }
      });

    return () => {
      active = false;
    };
  }, [providedService]);

  const beginRound = async (nextMode: LearningMode) => {
    if (!service) {
      return;
    }

    setOpenedServiceError(null);
    setMode(nextMode);
    setPhase("loading");
    setSaveStatus("idle");
    setSaveError(null);
    failedSubmissionRef.current = null;

    try {
      const cards = await service.loadRound(now());
      setRound(cards);
      setCardIndex(0);
      setIsRevealed(false);
      setPhase(cards.length > 0 ? "learning" : "empty");
    } catch (error) {
      setOpenedServiceError(errorMessage(error));
      setPhase("load-error");
    }
  };

  const finishCurrentRound = () => {
    setRound([]);
    setCardIndex(0);
    setIsRevealed(false);
    failedSubmissionRef.current = null;
    setSaveStatus("idle");
    setPhase("round-complete");
  };

  const saveFeedback = async (
    feedback: Feedback,
    submissionOverride?: FeedbackSubmission,
  ) => {
    if (
      !service ||
      !currentCard ||
      !mode ||
      !isRevealed ||
      submissionLock.current
    ) {
      return;
    }

    const submission =
      submissionOverride ??
      service.createSubmission({
        wordId: currentCard.word.id,
        mode,
        feedback,
        feedbackAtMs: now(),
      });

    submissionLock.current = true;
    setSaveStatus("saving");
    setSaveError(null);

    try {
      await service.submitFeedback(submission);
      failedSubmissionRef.current = null;
      setSaveStatus("idle");

      if (cardIndex + 1 >= round.length) {
        finishCurrentRound();
      } else {
        setCardIndex((current) => current + 1);
        setIsRevealed(false);
      }
    } catch (error) {
      failedSubmissionRef.current = submission;
      setSaveError(errorMessage(error));
      setSaveStatus("failed");
    } finally {
      submissionLock.current = false;
    }
  };

  const retrySave = async () => {
    const submission = failedSubmissionRef.current;
    if (!submission) {
      return;
    }
    await saveFeedback(submission.feedback, submission);
  };

  const restartModeSelection = () => {
    setPhase("choose-mode");
    setMode(null);
    setRound([]);
    setCardIndex(0);
    setIsRevealed(false);
    setSaveStatus("idle");
    setSaveError(null);
    failedSubmissionRef.current = null;
  };

  return (
    <>
      <PageHeader
        eyebrow="学习"
        title="单词学习"
        description="先回忆，再查看完整答案，然后用三档反馈记录真实记忆状态。"
      />

      {openedServiceError && phase === "choose-mode" ? (
        <p className="form-error" role="alert">
          {openedServiceError}
        </p>
      ) : null}

      {phase === "choose-mode" ? (
        <section className="mode-picker" aria-labelledby="mode-picker-title">
          <h2 id="mode-picker-title">选择学习模式</h2>
          <p>两种模式共享同一份复习进度。</p>
          <div className="mode-choice-grid">
            <button
              className="mode-choice"
              disabled={!service}
              onClick={() => void beginRound("english-to-chinese")}
              type="button"
            >
              <strong>英译中</strong>
              <span>看英文，回忆完整中文释义</span>
            </button>
            <button
              className="mode-choice"
              disabled={!service}
              onClick={() => void beginRound("chinese-to-english")}
              type="button"
            >
              <strong>中译英</strong>
              <span>看完整中文释义，回忆英文单词</span>
            </button>
          </div>
          {!service && !openedServiceError ? (
            <p className="loading-state" role="status">
              正在连接本地词库…
            </p>
          ) : null}
        </section>
      ) : null}

      {phase === "loading" ? (
        <p className="loading-state learning-loading" role="status">
          正在准备本轮学习…
        </p>
      ) : null}

      {phase === "load-error" ? (
        <section className="notice-card">
          <h2>无法加载学习内容</h2>
          <p>{openedServiceError}</p>
          <button
            className="primary-button"
            onClick={() => mode && void beginRound(mode)}
            type="button"
          >
            重新加载
          </button>
        </section>
      ) : null}

      {phase === "empty" ? (
        <EmptyState
          title="暂时没有可学习的单词"
          description="词库为空，或所有已有单词都尚未到复习时间。"
          action={
            <div className="inline-actions">
              <Link className="primary-link" to="/words">
                前往单词库
              </Link>
              <button
                className="secondary-button"
                onClick={restartModeSelection}
                type="button"
              >
                返回模式选择
              </button>
            </div>
          }
        />
      ) : null}

      {phase === "round-complete" ? (
        <EmptyState
          title="本轮学习完成"
          description="忘记的单词会在约 10 分钟后到期。到期后可再次检查并开始下一轮。"
          action={
            <div className="inline-actions">
              <button
                className="primary-button"
                onClick={() => mode && void beginRound(mode)}
                type="button"
              >
                检查下一轮
              </button>
              <button
                className="secondary-button"
                onClick={restartModeSelection}
                type="button"
              >
                切换模式
              </button>
            </div>
          }
        />
      ) : null}

      {phase === "learning" && currentCard && mode ? (
        <section className="learning-panel" aria-label="学习卡片">
          <div className="learning-toolbar">
            <span>{MODE_LABELS[mode]}</span>
            <span>
              本轮第 {cardIndex + 1} / {round.length} 个
            </span>
            <span>
              {currentCard.kind === "review" ? "到期复习" : "新词"}
            </span>
          </div>

          <article className="learning-card">
            <p className="prompt-label">
              {mode === "english-to-chinese"
                ? "请看英文，回忆中文释义"
                : "请看完整中文释义，回忆英文单词"}
            </p>
            <h2 className={mode === "chinese-to-english" ? "prompt-meaning" : ""}>
              {mode === "english-to-chinese"
                ? currentCard.word.displayWord
                : currentCard.word.chineseMeaning}
            </h2>

            {!isRevealed ? (
              <button
                className="primary-button reveal-button"
                onClick={() => setIsRevealed(true)}
                type="button"
              >
                显示答案
              </button>
            ) : (
              <div className="answer-panel">
                <p className="prompt-label">答案</p>
                <p className="revealed-answer">
                  {mode === "english-to-chinese"
                    ? currentCard.word.chineseMeaning
                    : currentCard.word.displayWord}
                </p>
              </div>
            )}
          </article>

          {isRevealed ? (
            <div className="feedback-area">
              <p>这次回忆得怎么样？</p>
              {saveStatus === "failed" ? (
                <>
                  <p className="form-error" role="alert">
                    保存失败：{saveError}
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => void retrySave()}
                    type="button"
                  >
                    重试保存
                  </button>
                </>
              ) : (
                <div className="feedback-buttons">
                  {(
                    Object.entries(FEEDBACK_LABELS) as Array<
                      [Feedback, string]
                    >
                  ).map(([feedback, label]) => (
                    <button
                      className={`feedback-button feedback-${feedback}`}
                      disabled={saveStatus === "saving"}
                      key={feedback}
                      onClick={() => void saveFeedback(feedback)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {saveStatus === "saving" ? (
                <p className="loading-state" role="status">
                  正在保存本次反馈…
                </p>
              ) : null}
            </div>
          ) : (
            <p className="supporting-text">
              查看答案后才能选择记忆反馈。
            </p>
          )}

          <div className="learning-footer-actions">
            <button
              className="text-button"
              disabled={saveStatus === "saving"}
              onClick={restartModeSelection}
              type="button"
            >
              退出本轮并切换模式
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

