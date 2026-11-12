import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { DataValidationError } from "../data";
import { getRepositories } from "../data/client";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  LearningAnalyticsService,
  selectAnalyticsRange,
  type AnalyticsDashboard,
  type AnalyticsRange,
  type DailyLearningPoint,
  type FeedbackBreakdown,
  type GroupLearningAnalytics,
  type WeakDistributionBucket,
} from "../features/analytics/learningAnalyticsService";

interface StatsPageProps {
  service?: LearningAnalyticsService;
  now?: () => number;
}

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  all: "全部历史",
};

function errorMessage(error: unknown): string {
  if (error instanceof DataValidationError || error instanceof Error) {
    return error.message;
  }
  return "读取学习统计失败。";
}

export function StatsPage({
  service: providedService,
  now = Date.now,
}: StatsPageProps) {
  const [openedService, setOpenedService] =
    useState<LearningAnalyticsService | null>(null);
  const service = providedService ?? openedService;
  const [dashboard, setDashboard] =
    useState<AnalyticsDashboard | null>(null);
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providedService) return;
    let active = true;
    getRepositories()
      .then((repositories) => {
        if (active) {
          setOpenedService(new LearningAnalyticsService(repositories));
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [providedService]);

  useEffect(() => {
    if (!service) return;
    let active = true;
    service
      .getDashboard(now())
      .then((nextDashboard) => {
        if (active) {
          setDashboard(nextDashboard);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [now, service]);

  const rangeView = useMemo(
    () => (dashboard ? selectAnalyticsRange(dashboard, range) : null),
    [dashboard, range],
  );

  return (
    <>
      <PageHeader
        eyebrow="数据洞察"
        title="学习统计"
        description="用真实 IndexedDB 学习历史查看全局任务趋势、记忆反馈、薄弱词和分组情况。"
      />

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {!dashboard && !error ? (
        <p className="loading-state" role="status">
          正在聚合学习统计…
        </p>
      ) : null}

      {dashboard && rangeView ? (
        <>
          <section
            className="dashboard-grid analytics-overview"
            aria-label="学习概览"
          >
            <Metric label="总单词数" value={dashboard.today.totalWordCount} />
            <Metric
              label="累计学习单词"
              value={dashboard.today.startedWordCount}
            />
            <Metric
              label="今日新词完成"
              value={dashboard.today.task.completedCount}
            />
            <Metric
              label="今日复习完成"
              value={
                dashboard.today.task.completedGlobalReviewWordIds.length
              }
            />
            <Metric label="当前到期复习" value={dashboard.today.dueReviewCount} />
            <Metric
              label="当前薄弱词"
              value={dashboard.currentWeakWordCount}
            />
          </section>

          <section
            className="analytics-card"
            aria-labelledby="trend-title"
          >
            <div className="analytics-heading">
              <div>
                <p className="eyebrow">全局任务</p>
                <h2 id="trend-title">学习趋势</h2>
              </div>
              <RangeSelector onChange={setRange} value={range} />
            </div>
            <p className="supporting-text">
              {rangeView.startDate} 至 {rangeView.endDate}。新词和复习按北京时间、
              单词和任务类别去重；分组学习不计入此图。
            </p>
            <div className="analytics-totals">
              <span>
                区间新词 <strong>{rangeView.newCompletedCount}</strong>
              </span>
              <span>
                区间复习 <strong>{rangeView.reviewCompletedCount}</strong>
              </span>
              <span>
                每日平均{" "}
                <strong>
                  {(
                    (rangeView.newCompletedCount +
                      rangeView.reviewCompletedCount) /
                    rangeView.points.length
                  ).toFixed(1)}
                </strong>
              </span>
            </div>
            <DailyTrendChart points={rangeView.points} />
          </section>

          {dashboard.today.totalWordCount === 0 &&
          rangeView.feedback.total === 0 ? (
            <EmptyState
              title="还没有学习数据"
              description="添加单词并完成一次学习反馈后，这里会生成真实趋势和记忆分析。"
            />
          ) : null}

          <section
            className="analytics-card"
            aria-labelledby="memory-title"
          >
            <p className="eyebrow">完整学习历史</p>
            <h2 id="memory-title">记忆效果</h2>
            <p className="supporting-text">
              统计所选时间范围内全部来源的反馈，包括全局、分组和薄弱强化；这里反映回忆结果，
              不替代全局每日任务去重。
            </p>
            <FeedbackChart feedback={rangeView.feedback} />
          </section>

          <section
            className="analytics-card"
            aria-labelledby="weak-analysis-title"
          >
            <p className="eyebrow">全部历史累计</p>
            <h2 id="weak-analysis-title">薄弱词分析</h2>
            <p className="supporting-text">
              薄弱分按忘记 +3、模糊 +1、记住 0 累计，不因之后答对而降低。当前共有{" "}
              <strong>{dashboard.currentWeakWordCount}</strong> 个薄弱词。
            </p>
            <div className="weak-analysis-grid">
              <WeakDistributionChart
                buckets={dashboard.weakDistribution}
              />
              <WeakTrendChart points={rangeView.points} />
            </div>
          </section>

          <section
            className="analytics-card"
            aria-labelledby="groups-analysis-title"
          >
            <p className="eyebrow">独立统计</p>
            <h2 id="groups-analysis-title">分组学习</h2>
            <p className="supporting-text">
              分组统计只计算当前分组成员和 source=group 的历史记录，历史总数为全部时间，不混入全局每日任务。
            </p>
            <GroupAnalyticsTable groups={dashboard.groups} />
          </section>
        </>
      ) : null}
    </>
  );
}

function RangeSelector({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
}) {
  return (
    <div className="range-selector" aria-label="统计时间范围">
      {(Object.keys(RANGE_LABELS) as AnalyticsRange[]).map((range) => (
        <button
          aria-pressed={value === range}
          className={
            value === range
              ? "range-button range-button-active"
              : "range-button"
          }
          key={range}
          onClick={() => onChange(range)}
          type="button"
        >
          {RANGE_LABELS[range]}
        </button>
      ))}
    </div>
  );
}

function DailyTrendChart({ points }: { points: DailyLearningPoint[] }) {
  const maximum = Math.max(
    1,
    ...points.map((point) =>
      Math.max(point.newCompletedCount, point.reviewCompletedCount),
    ),
  );
  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  const total = points.reduce(
    (sum, point) =>
      sum + point.newCompletedCount + point.reviewCompletedCount,
    0,
  );

  return (
    <div
      aria-label={`每日学习趋势，所选范围共完成 ${total} 项全局任务`}
      className="analytics-chart"
      role="img"
    >
      <Legend
        items={[
          ["new", "新词", "chart-new"],
          ["review", "复习", "chart-review"],
        ]}
      />
      <div className="chart-scroll">
        <div
          className="trend-chart"
          style={{
            gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(14px, 1fr))`,
          }}
        >
          {points.map((point, index) => (
            <div
              aria-label={`${point.date}：新词 ${point.newCompletedCount}，复习 ${point.reviewCompletedCount}`}
              className="trend-day"
              key={point.date}
              tabIndex={0}
            >
              <div className="trend-bars">
                <span
                  className="trend-bar chart-new"
                  style={{
                    height: `${(point.newCompletedCount / maximum) * 100}%`,
                    minHeight:
                      point.newCompletedCount > 0 ? "4px" : "0",
                  }}
                  title={`${point.date} 新词 ${point.newCompletedCount}`}
                />
                <span
                  className="trend-bar chart-review"
                  style={{
                    height: `${(point.reviewCompletedCount / maximum) * 100}%`,
                    minHeight:
                      point.reviewCompletedCount > 0 ? "4px" : "0",
                  }}
                  title={`${point.date} 复习 ${point.reviewCompletedCount}`}
                />
              </div>
              <span className="chart-date">
                {index % labelStep === 0 || index === points.length - 1
                  ? point.date.slice(5)
                  : " "}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedbackChart({ feedback }: { feedback: FeedbackBreakdown }) {
  const denominator = Math.max(feedback.total, 1);
  const forgottenAngle =
    (feedback.forgotten / denominator) * 100;
  const fuzzyAngle =
    forgottenAngle + (feedback.fuzzy / denominator) * 100;
  const background =
    feedback.total === 0
      ? "#e8e2d5"
      : `conic-gradient(#c8594d 0 ${forgottenAngle}%, #d49a3d ${forgottenAngle}% ${fuzzyAngle}%, #31856b ${fuzzyAngle}% 100%)`;
  const rows: Array<[string, number, number, string]> = [
    [
      "忘记了",
      feedback.forgotten,
      feedback.forgottenPercent,
      "feedback-legend-forgotten",
    ],
    [
      "模糊",
      feedback.fuzzy,
      feedback.fuzzyPercent,
      "feedback-legend-fuzzy",
    ],
    [
      "记住了",
      feedback.remembered,
      feedback.rememberedPercent,
      "feedback-legend-remembered",
    ],
  ];

  return (
    <div className="feedback-chart">
      <div
        aria-label={`共 ${feedback.total} 条反馈`}
        className="feedback-donut"
        role="img"
        style={{ background }}
      >
        <span>
          <strong>{feedback.total}</strong>
          次反馈
        </span>
      </div>
      <div className="feedback-legend">
        {rows.map(([label, count, percent, className]) => (
          <div className="feedback-legend-row" key={label}>
            <span className={`legend-dot ${className}`} />
            <span>{label}</span>
            <strong>{count}</strong>
            <span>{percent.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeakDistributionChart({
  buckets,
}: {
  buckets: WeakDistributionBucket[];
}) {
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <div className="weak-distribution" aria-labelledby="weak-distribution-title">
      <h3 id="weak-distribution-title">薄弱分分布</h3>
      {buckets.map((bucket) => (
        <div className="weak-distribution-row" key={bucket.key}>
          <span>{bucket.label}</span>
          <div className="weak-distribution-track">
            <span
              style={{
                width: `${(bucket.count / maximum) * 100}%`,
              }}
            />
          </div>
          <strong>{bucket.count}</strong>
        </div>
      ))}
    </div>
  );
}

function WeakTrendChart({ points }: { points: DailyLearningPoint[] }) {
  const maximum = Math.max(
    1,
    ...points.map((point) => point.weakWordCount),
  );
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  return (
    <div className="weak-trend" aria-labelledby="weak-trend-title">
      <h3 id="weak-trend-title">薄弱词数量变化</h3>
      <div className="chart-scroll">
        <div
          aria-label="每日薄弱词数量趋势"
          className="weak-trend-chart"
          role="img"
          style={{
            gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(14px, 1fr))`,
          }}
        >
          {points.map((point, index) => (
            <div
              aria-label={`${point.date}：薄弱词 ${point.weakWordCount}`}
              className="weak-trend-day"
              key={point.date}
              tabIndex={0}
            >
              <span
                className="weak-trend-bar"
                style={{
                  height: `${(point.weakWordCount / maximum) * 100}%`,
                  minHeight: point.weakWordCount > 0 ? "4px" : "0",
                }}
                title={`${point.date} 薄弱词 ${point.weakWordCount}`}
              />
              <span className="chart-date">
                {index % labelStep === 0 || index === points.length - 1
                  ? point.date.slice(5)
                  : " "}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupAnalyticsTable({
  groups,
}: {
  groups: GroupLearningAnalytics[];
}) {
  if (groups.length === 0) {
    return <p className="chart-empty">还没有自定义分组。</p>;
  }

  return (
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <thead>
          <tr>
            <th>分组</th>
            <th>单词数</th>
            <th>已学习</th>
            <th>未学习</th>
            <th>分组历史</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.groupId}>
              <th scope="row">{group.name}</th>
              <td>{group.wordCount}</td>
              <td>{group.startedCount}</td>
              <td>{group.unstartedCount}</td>
              <td>{group.historyCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend({
  items,
}: {
  items: Array<[string, string, string]>;
}) {
  return (
    <div className="chart-legend">
      {items.map(([key, label, className]) => (
        <span key={key}>
          <i className={className} />
          {label}
        </span>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
