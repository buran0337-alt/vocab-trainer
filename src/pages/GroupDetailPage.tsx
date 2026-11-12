import {
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  DataValidationError,
  type Feedback,
} from "../data";
import { getRepositories } from "../data/client";
import { PageHeader } from "../components/PageHeader";
import { AddWordsDialog } from "../features/groups/GroupDialogs";
import {
  GroupLibraryService,
  type GroupDetail,
} from "../features/groups/groupLibraryService";
import type { FeedbackSubmission } from "../features/learning/learningSessionService";

interface GroupDetailPageProps {
  service?: GroupLibraryService;
  groupId?: string;
  now?: () => number;
}

const FEEDBACK_LABELS: Record<Feedback, string> = {
  forgotten: "忘记了",
  fuzzy: "模糊",
  remembered: "记住了",
};

const STATUS_LABELS = {
  due: "到期复习",
  new: "新词",
  scheduled: "已安排",
} as const;

function errorMessage(error: unknown): string {
  if (error instanceof DataValidationError || error instanceof Error) {
    return error.message;
  }
  return "分组操作失败，请稍后重试。";
}

export function GroupDetailPage({
  service: providedService,
  groupId: providedGroupId,
  now = Date.now,
}: GroupDetailPageProps) {
  const { groupId: routeGroupId } = useParams();
  const groupId = providedGroupId ?? routeGroupId;
  const navigate = useNavigate();
  const [openedService, setOpenedService] =
    useState<GroupLibraryService | null>(null);
  const service = providedService ?? openedService;
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingWordId, setSavingWordId] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState<
    Record<string, Feedback>
  >({});
  const [failedWordId, setFailedWordId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const failedSubmission = useRef<FeedbackSubmission | null>(null);

  useEffect(() => {
    if (providedService) return;
    let active = true;
    getRepositories()
      .then((repositories) => {
        if (active) {
          setOpenedService(new GroupLibraryService(repositories));
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

  const loadDetail = async () => {
    if (!service || !groupId) {
      setError("缺少分组 ID。");
      setIsLoading(false);
      return;
    }
    try {
      setDetail(await service.getDetail(groupId, now()));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!service || !groupId) {
      return;
    }
    let active = true;
    service
      .getDetail(groupId, now())
      .then((nextDetail) => {
        if (active) {
          setDetail(nextDetail);
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
  }, [groupId, now, service]);

  const toggleWord = (wordId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  };

  const removeWord = async (wordId: string) => {
    if (!service || !groupId || savingWordId) return;
    try {
      await service.removeWord(groupId, wordId);
      setExpandedIds((current) => {
        const next = new Set(current);
        next.delete(wordId);
        return next;
      });
      setNotice("已从分组移除该单词，原单词和学习进度保持不变。");
      await loadDetail();
    } catch (removeError) {
      setError(errorMessage(removeError));
    }
  };

  const submitFeedback = async (
    wordId: string,
    feedback: Feedback,
    retry?: FeedbackSubmission,
  ) => {
    if (
      !service ||
      !groupId ||
      submissionLock.current ||
      savedFeedback[wordId]
    ) {
      return;
    }

    const submission =
      retry ??
      service.createGroupSubmission({
        wordId,
        groupId,
        feedback,
        feedbackAtMs: now(),
      });
    submissionLock.current = true;
    setSavingWordId(wordId);
    setFailedWordId(null);
    setSaveError(null);

    try {
      await service.submitGroupFeedback(submission);
      failedSubmission.current = null;
      setSavedFeedback((current) => ({
        ...current,
        [wordId]: feedback,
      }));
      setNotice("分组反馈已保存，不会计入全局每日任务。");
      await loadDetail();
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

  if (!groupId) {
    return (
      <>
        <PageHeader
          eyebrow="分组"
          title="分组详情"
          description="无法打开分组。"
        />
        <p className="form-error" role="alert">
          缺少分组 ID。
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="分组词汇"
        title={detail?.summary.group.name ?? "分组详情"}
        description="批量浏览当前分组成员。展开释义只会查看内容，不会触发复习记录。"
      />

      <div className="group-detail-toolbar">
        <Link className="secondary-link" to="/groups">
          返回分组列表
        </Link>
        {detail ? (
          <button
            className="primary-button"
            onClick={() => {
              setNotice(null);
              setIsAddOpen(true);
            }}
            type="button"
          >
            添加单词
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className="success-notice" role="status">
          {notice}
        </p>
      ) : null}
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

      {isLoading ? (
        <p className="loading-state" role="status">
          正在读取分组词汇…
        </p>
      ) : null}

      {detail ? (
        <>
          <section className="dashboard-grid" aria-label="分组统计">
            <GroupMetric label="分组单词总数" value={detail.summary.wordCount} />
            <GroupMetric label="已学习单词" value={detail.summary.startedCount} />
            <GroupMetric
              label="尚未学习"
              value={detail.summary.unstartedCount}
            />
            <GroupMetric
              label="分组学习历史"
              value={detail.summary.groupHistoryCount}
            />
          </section>

          {detail.words.length === 0 ? (
            <section className="notice-card">
              <h2>这个分组还没有单词</h2>
              <p>从总词库添加单词后，会在这里批量显示。</p>
            </section>
          ) : (
            <section className="group-vocabulary-list" aria-label="分组词汇列表">
              {detail.words.map((item) => {
                const expanded = expandedIds.has(item.word.id);
                const saved = savedFeedback[item.word.id];
                const isFailed = failedWordId === item.word.id;
                const isSaving = savingWordId === item.word.id;

                return (
                  <article className="group-vocabulary-card" key={item.word.id}>
                    <button
                      aria-expanded={expanded}
                      className="vocabulary-toggle"
                      onClick={() => toggleWord(item.word.id)}
                      type="button"
                    >
                      <span className="vocabulary-word">{item.word.displayWord}</span>
                      <span
                        className={`learning-badge group-status-${item.learningStatus}`}
                      >
                        {STATUS_LABELS[item.learningStatus]}
                      </span>
                      <span className="expand-indicator" aria-hidden="true">
                        {expanded ? "收起 ▲" : "展开释义 ▼"}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="vocabulary-details">
                        <p className="vocabulary-meaning">
                          {item.word.chineseMeaning}
                        </p>
                        <p className="supporting-text">
                          分组内学习历史：{item.groupHistoryCount} 条
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
                                  void submitFeedback(item.word.id, feedback)
                                }
                                type="button"
                              >
                                {isSaving ? "保存中…" : label}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="vocabulary-actions">
                          <button
                            className="text-button text-button-danger"
                            disabled={savingWordId !== null}
                            onClick={() => void removeWord(item.word.id)}
                            type="button"
                          >
                            从分组移除
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </section>
          )}
        </>
      ) : null}

      {detail && isAddOpen ? (
        <AddWordsDialog
          onAdd={async (wordIds) => {
            await service?.addWords(groupId, wordIds);
            setIsAddOpen(false);
            setNotice(`已向分组添加 ${wordIds.length} 个单词。`);
            await loadDetail();
          }}
          onClose={() => setIsAddOpen(false)}
          words={detail.availableWords}
        />
      ) : null}

      <div className="group-detail-footer">
        <button
          className="text-button text-button-danger"
          onClick={() => navigate("/groups")}
          type="button"
        >
          返回分组管理
        </button>
      </div>
    </>
  );
}

function GroupMetric({ label, value }: { label: string; value: number }) {
  return (
    <article className="status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

