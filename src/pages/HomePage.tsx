import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { DataValidationError } from "../data";
import { getRepositories } from "../data/client";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  DailyProgressService,
  type TodayProgress,
} from "../features/daily/dailyProgressService";

interface HomePageProps {
  service?: DailyProgressService;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  if (error instanceof DataValidationError || error instanceof Error) {
    return error.message;
  }
  return "读取今日学习进度失败。";
}

export function HomePage({
  service: providedService,
  now = Date.now,
}: HomePageProps) {
  const [openedService, setOpenedService] =
    useState<DailyProgressService | null>(null);
  const service = providedService ?? openedService;
  const [progress, setProgress] = useState<TodayProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providedService) {
      return;
    }

    let active = true;
    getRepositories()
      .then((repositories) => {
        if (active) {
          setOpenedService(new DailyProgressService(repositories));
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, [providedService]);

  useEffect(() => {
    if (!service) {
      return;
    }

    let active = true;
    service
      .getToday(now())
      .then((nextProgress) => {
        if (active) {
          setProgress(nextProgress);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, [now, service]);

  const completionPercent =
    progress && progress.task.effectiveTaskCount > 0
      ? Math.min(
          100,
          Math.round(
            (progress.task.completedCount /
              progress.task.effectiveTaskCount) *
              100,
          ),
        )
      : 100;

  return (
    <>
      <PageHeader
        eyebrow="今日"
        title="今天的学习"
        description="按北京时间汇总每日新词任务、到期复习和真实完成进度。"
      />

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {!progress && !error ? (
        <p className="loading-state" role="status">
          正在读取今日学习进度…
        </p>
      ) : null}

      {progress ? (
        <>
          {!progress.configured ? (
            <section className="notice-card goal-setup-notice">
              <h2>还没有设置每日基础目标</h2>
              <p>
                未设置时不会凭空安排新词。到期复习仍可正常进行，请先前往设置页确定每日目标。
              </p>
              <Link className="primary-link" to="/settings">
                设置每日目标
              </Link>
            </section>
          ) : null}

          <section className="daily-hero" aria-label="今日新词进度">
            <div>
              <p className="eyebrow">{progress.date}</p>
              <h2>
                {progress.task.completedCount} /{" "}
                {progress.task.effectiveTaskCount} 个新词
              </h2>
              <p>
                {progress.goalAchieved
                  ? progress.task.effectiveTaskCount === 0
                    ? "今天没有新词任务。"
                    : "今日新词目标已完成。"
                  : `还需完成 ${progress.remainingTaskCount} 个新词。`}
              </p>
            </div>
            <div
              aria-label={`今日新词完成度 ${completionPercent}%`}
              className="progress-track"
              role="progressbar"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={completionPercent}
            >
              <span style={{ width: `${completionPercent}%` }} />
            </div>
          </section>

          <section className="dashboard-grid" aria-label="今日学习数据">
            <StatCard label="基础目标" value={progress.task.baseGoal} />
            <StatCard label="以前结转" value={progress.task.carryoverTasks} />
            <StatCard label="名义任务" value={progress.task.nominalTaskCount} />
            <StatCard label="有效任务" value={progress.task.effectiveTaskCount} />
            <StatCard
              label="新词完成"
              value={progress.task.completedCount}
            />
            <StatCard
              label="复习完成"
              value={progress.task.completedGlobalReviewWordIds.length}
            />
            <StatCard label="今日总完成" value={progress.totalCompletedCount} />
            <StatCard label="到期复习" value={progress.dueReviewCount} />
            <StatCard label="剩余新词" value={progress.remainingTaskCount} />
          </section>

          <div className="dashboard-actions">
            <Link className="primary-link" to="/learn">
              开始学习
            </Link>
            <Link className="secondary-link" to="/stats">
              查看统计
            </Link>
          </div>

          {progress.totalWordCount === 0 ? (
            <EmptyState
              title="词库还没有单词"
              description="先手动添加或导入单词，今日任务才会拥有真实可安排的内容。"
              action={
                <Link className="primary-link" to="/words">
                  前往单词库
                </Link>
              }
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

