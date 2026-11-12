import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  DataValidationError,
  type Feedback,
} from "../data";
import { getRepositories } from "../data/client";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import type { FeedbackSubmission } from "../features/learning/learningSessionService";
import {
  WeakWordService,
  type WeakWordItem,
} from "../features/weak/weakWordService";

interface WeakWordsPageProps {
  service?: WeakWordService;
  now?: () => number;
}

const FEEDBACK_LABELS: Record<Feedback, string> = {
  forgotten: "忘记了",
  fuzzy: "模糊",
  remembered: "记住了",
};

function errorMessage(error: unknown): string {
  if (error instanceof DataValidationError || error instanceof Error) {
    return error.message;
  }
  return "薄弱词操作失败，请稍后重试。";
}

export function WeakWordsPage({
  service: providedService,
  now = Date.now,
}: WeakWordsPageProps) {
  const [openedService, setOpenedService] =
    useState<WeakWordService | null>(null);
  const service = providedService ?? openedService;
  const [items, setItems] = useState<WeakWordItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [savedFeedback, setSavedFeedback] = useState<
    Record<string, Feedback>
  >({});
  const [savingWordId, setSavingWordId] = useState<string | null>(null);
  const [failedWordId, setFailedWordId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const failedSubmission = useRef<FeedbackSubmission | null>(null);

  useEffect(() => {
    if (providedService) return;
    let active = true;
    getRepositories()
      .then((repositories) => {
        if (active) {
          setOpenedService(new WeakWordService(repositories));
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [providedService]);

  const loadItems = async () => {
    if (!service) return;
    try {
      setItems(await service.list());
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!service) return;
    let active = true;
    service
      .list()
      .then((nextItems) => {
        if (active) {
          setItems(nextItems);
          setIsLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [service]);

  const toggleWord = (wordId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  };

  const submitFeedback = async (
    wordId: string,
    feedback: Feedback,
    retry?: FeedbackSubmission,
  ) => {
    if (
      !service ||
      submissionLock.current ||
      savedFeedback[wordId]
    ) {
      return;
    }

    const submission =
      retry ??
      service.createSubmission({
        wordId,
        feedback,
        feedbackAtMs: now(),
      });
    submissionLock.current = true;
    setSavingWordId(wordId);
    setFailedWordId(null);
    setSaveError(null);
    setNotice(null);

    try {
      await service.submitFeedback(submission);
      failedSubmission.current = null;
      setSavedFeedback((current) => ({
        ...current,
        [wordId]: feedback,
      }));
      setNotice("薄弱词反馈已保存，并计入今日全局复习统计。");
      await loadItems();
    } catch (saveFailure) {
      failedSubmission.current = submission;
      setFailedWordId(wordId);
      setSaveError(errorMessage(saveFailure));
    } finally {
      setSavingWordId(null);
      submissionLock.current = false;
    }
  };

  const retryFeedback = async () => {
    if (!failedWordId || !failedSubmission.current) return;
    await submitFeedback(
      failedWordId,
      failedSubmission.current.feedback,
      failedSubmission.current,
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="薄弱强化"
        title="薄弱词强化"
        description="按全部学习历史找出容易遗忘的单词。查看答案后提交反馈，学习进度与其他模式共享。"
      />

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {saveError ? (
        <div className="form-error" role="alert">
          <p>保存失败：{saveError}</p>
          <button
            className="secondary-button"
            disabled={savingWordId !== null}
            onClick={() => void retryFeedback()}
            type="button"
          >
            重试保存
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="success-notice" role="status">
          {notice}
        </p>
      ) : null}

      {isLoading ? (
        <p className="loading-state" role="status">
          正在计算薄弱词…
        </p>
      ) : null}

      {!isLoading && !error && items.length === 0 ? (
        <EmptyState
          title="暂时没有薄弱词"
          description="在记忆学习、分组学习或薄弱强化中提交反馈后，达到入列条件的单词会出现在这里。"
        />
      ) : null}

      {!isLoading && items.length > 0 ? (
        <>
          <p className="inspection-summary" role="status">
            当前共有 {items.length} 个薄弱词
          </p>
          <section
            aria-label="薄弱词列表"
            className="group-vocabulary-list weak-word-list"
          >
            {items.map((item, index) => {
              const expanded = expandedIds.has(item.word.id);
              const saved = savedFeedback[item.word.id];
              const isSaving = savingWordId === item.word.id;
              const isFailed = failedWordId === item.word.id;

              return (
                <article
                  className="group-vocabulary-card weak-word-card"
                  key={item.word.id}
                >
                  <button
                    aria-expanded={expanded}
                    className="vocabulary-toggle weak-word-toggle"
                    onClick={() => toggleWord(item.word.id)}
                    type="button"
                  >
                    <span className="weak-word-rank" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="vocabulary-word">
                      {item.word.displayWord}
                    </span>
                    <span className="weak-score-badge">
                      薄弱分 {item.weakScore}
                    </span>
                    <span className="expand-indicator" aria-hidden="true">
                      {expanded ? "收起答案 ▲" : "查看答案 ▼"}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="vocabulary-details">
                      <p className="vocabulary-meaning">
                        {item.word.chineseMeaning}
                      </p>
                      <p className="weak-word-meta">
                        连续忘记 {item.reviewState.consecutiveForgets} 次 ·
                        EF {item.reviewState.ef.toFixed(2)} · 学习记录{" "}
                        {item.historyCount} 条
                      </p>
                      {saved ? (
                        <p className="success-notice" role="status">
                          已记录本次反馈：{FEEDBACK_LABELS[saved]}
                        </p>
                      ) : isFailed ? (
                        <p className="field-error">
                          本次反馈尚未保存，请使用上方“重试保存”。
                        </p>
                      ) : (
                        <div className="feedback-buttons">
                          {(
                            Object.entries(FEEDBACK_LABELS) as Array<
                              [Feedback, string]
                            >
                          ).map(([feedback, label]) => (
                            <button
                              className={`feedback-button feedback-${feedback}`}
                              disabled={savingWordId !== null}
                              key={feedback}
                              onClick={() =>
                                void submitFeedback(
                                  item.word.id,
                                  feedback,
                                )
                              }
                              type="button"
                            >
                              {isSaving ? "保存中…" : label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        </>
      ) : null}
    </>
  );
}
