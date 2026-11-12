import {
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";

import {
  DataValidationError,
  MAX_DAILY_GOAL,
  MIN_DAILY_GOAL,
} from "../data";
import { getRepositories } from "../data/client";
import { PageHeader } from "../components/PageHeader";
import {
  DailyProgressService,
  type TodayProgress,
} from "../features/daily/dailyProgressService";
import {
  BackupService,
  type BackupSelection,
} from "../features/backup/backupService";

interface SettingsPageProps {
  service?: DailyProgressService;
  backupService?: BackupService;
  now?: () => number;
  refresh?: () => void;
}

function errorMessage(
  error: unknown,
  fallback = "操作失败，请稍后重试。",
): string {
  if (error instanceof DataValidationError || error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function SettingsPage({
  service: providedService,
  backupService: providedBackupService,
  now = Date.now,
  refresh = () => window.location.reload(),
}: SettingsPageProps) {
  const [openedService, setOpenedService] =
    useState<DailyProgressService | null>(null);
  const service = providedService ?? openedService;
  const [openedBackupService, setOpenedBackupService] =
    useState<BackupService | null>(null);
  const backupService = providedBackupService ?? openedBackupService;
  const [progress, setProgress] = useState<TodayProgress | null>(null);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pendingRestore, setPendingRestore] =
    useState<BackupSelection | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const goalId = useId();

  useEffect(() => {
    if (providedService && providedBackupService) {
      return;
    }
    let active = true;
    getRepositories()
      .then((repositories) => {
        if (active) {
          if (!providedService) {
            setOpenedService(new DailyProgressService(repositories));
          }
          if (!providedBackupService) {
            setOpenedBackupService(new BackupService(repositories));
          }
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
  }, [providedBackupService, providedService]);

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
          setGoal(
            nextProgress.configured
              ? String(nextProgress.task.baseGoal)
              : "",
          );
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

  const saveGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!service) {
      return;
    }

    const numericGoal = Number(goal);
    if (
      goal.trim() === "" ||
      !Number.isInteger(numericGoal) ||
      numericGoal < MIN_DAILY_GOAL ||
      numericGoal > MAX_DAILY_GOAL
    ) {
      setError(
        `每日基础目标必须是 ${MIN_DAILY_GOAL}–${MAX_DAILY_GOAL} 的整数。`,
      );
      setNotice(null);
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const nextProgress = await service.updateBaseGoal(
        numericGoal,
        now(),
      );
      setProgress(nextProgress);
      setGoal(String(nextProgress.task.baseGoal));
      setNotice("每日基础目标已保存，并已立即应用到今日任务。");
    } catch (saveError) {
      setError(errorMessage(saveError, "保存每日目标失败。"));
    } finally {
      setIsSaving(false);
    }
  };

  const exportBackup = async () => {
    if (!backupService) return;
    setIsExporting(true);
    setBackupError(null);
    setBackupNotice(null);
    try {
      const exported = await backupService.createExport(now());
      const blob = new Blob([exported.json], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exported.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupNotice("完整备份已生成并开始下载。");
    } catch (exportError) {
      setBackupError(errorMessage(exportError, "导出完整备份失败。"));
    } finally {
      setIsExporting(false);
    }
  };

  const inspectRestoreFile = async (
    file: File | undefined,
  ) => {
    setPendingRestore(null);
    setRestoreConfirmed(false);
    setBackupError(null);
    setBackupNotice(null);
    if (!backupService || !file) {
      return;
    }

    setIsInspecting(true);
    try {
      setPendingRestore(await backupService.inspectFile(file));
    } catch (inspectError) {
      setBackupError(errorMessage(inspectError, "无法读取备份文件。"));
    } finally {
      setIsInspecting(false);
    }
  };

  const restoreBackup = async () => {
    if (!backupService || !pendingRestore || !restoreConfirmed) {
      return;
    }

    setIsRestoring(true);
    setBackupError(null);
    setBackupNotice(null);
    try {
      await backupService.restoreFile(pendingRestore.file);
      setBackupNotice("恢复完成，正在刷新页面数据…");
      setPendingRestore(null);
      setRestoreConfirmed(false);
      refresh();
    } catch (restoreError) {
      setBackupError(
        errorMessage(
          restoreError,
          "恢复失败，原有数据未发生变化。",
        ),
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="设置"
        title="设置与数据"
        description="设置每日目标，并导出或恢复完整本地数据。数据只保存在当前浏览器。"
      />

      <section className="settings-card" aria-labelledby="goal-title">
        <h2 id="goal-title">每日新词目标</h2>
        <p>
          允许 0–999 的整数。修改后会立即重新计算今日有效任务，已完成数量不会减少。
        </p>
        <form className="goal-form" onSubmit={saveGoal} noValidate>
          <label htmlFor={goalId}>每天计划学习的新词数</label>
          <div className="goal-input-row">
            <input
              id={goalId}
              inputMode="numeric"
              max={MAX_DAILY_GOAL}
              min={MIN_DAILY_GOAL}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="例如 20"
              type="number"
              value={goal}
            />
            <button
              className="primary-button"
              disabled={isSaving || !progress}
              type="submit"
            >
              {isSaving ? "正在保存…" : "保存目标"}
            </button>
          </div>
        </form>

        {progress ? (
          <div className="settings-progress">
            <span>
              今日基础目标：
              <strong>{progress.configured ? progress.task.baseGoal : "未设置"}</strong>
            </span>
            <span>
              今日已完成新词：
              <strong>{progress.task.completedCount}</strong>
            </span>
            <span>
              今日有效新词任务：
              <strong>{progress.task.effectiveTaskCount}</strong>
            </span>
          </div>
        ) : (
          <p className="loading-state" role="status">
            正在读取设置…
          </p>
        )}

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
      </section>

      <section className="settings-card" aria-labelledby="backup-title">
        <h2 id="backup-title">完整备份与恢复</h2>
        <p>
          备份包含单词、分组、关联、复习状态、学习历史、每日任务和设置。首期恢复只支持用备份文件完整覆盖当前数据。
        </p>
        <div className="backup-actions">
          <button
            className="primary-button"
            disabled={!backupService || isExporting || isRestoring}
            onClick={() => void exportBackup()}
            type="button"
          >
            {isExporting ? "正在生成备份…" : "导出完整备份"}
          </button>
          <label className="file-picker-button">
            <span>选择备份文件</span>
            <input
              accept=".json,application/json"
              disabled={isInspecting || isRestoring}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void inspectRestoreFile(file);
              }}
              type="file"
            />
          </label>
        </div>

        {isInspecting ? (
          <p className="loading-state" role="status">
            正在校验备份文件…
          </p>
        ) : null}

        {pendingRestore ? (
          <section className="backup-preview" aria-labelledby="restore-preview-title">
            <h3 id="restore-preview-title">待恢复文件摘要</h3>
            <p>
              导出时间：
              <strong>
                {new Date(
                  pendingRestore.summary.exportedAtMs,
                ).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </strong>
            </p>
            <div className="settings-progress">
              <span>
                单词 <strong>{pendingRestore.summary.wordCount}</strong>
              </span>
              <span>
                分组 <strong>{pendingRestore.summary.groupCount}</strong>
              </span>
              <span>
                分组关联{" "}
                <strong>{pendingRestore.summary.associationCount}</strong>
              </span>
              <span>
                学习历史{" "}
                <strong>
                  {pendingRestore.summary.learningHistoryCount}
                </strong>
              </span>
              <span>
                复习状态{" "}
                <strong>
                  {pendingRestore.summary.reviewStateCount}
                </strong>
              </span>
              <span>
                每日任务{" "}
                <strong>{pendingRestore.summary.dailyTaskCount}</strong>
              </span>
              <span>
                设置记录{" "}
                <strong>{pendingRestore.summary.settingsCount}</strong>
              </span>
              <span>
                数据库版本{" "}
                <strong>{pendingRestore.summary.databaseVersion}</strong>
              </span>
            </div>
            <p className="backup-warning">
              当前数据将被备份内容完整替换。建议先点击上方“导出完整备份”保存当前数据。
            </p>
            <label className="backup-confirm">
              <input
                checked={restoreConfirmed}
                disabled={isRestoring}
                onChange={(event) =>
                  setRestoreConfirmed(event.target.checked)
                }
                type="checkbox"
              />
              我已了解此操作会完整覆盖当前数据，并确认恢复
            </label>
            <button
              className="primary-button"
              disabled={!restoreConfirmed || isRestoring}
              onClick={() => void restoreBackup()}
              type="button"
            >
              {isRestoring ? "正在恢复并核对…" : "确认完整覆盖恢复"}
            </button>
          </section>
        ) : null}

        {backupNotice ? (
          <p className="success-notice" role="status">
            {backupNotice}
          </p>
        ) : null}
        {backupError ? (
          <p className="form-error" role="alert">
            {backupError}
          </p>
        ) : null}
      </section>

      <section className="notice-card local-data-card" aria-labelledby="local-data-title">
        <h2 id="local-data-title">本地数据提醒</h2>
        <p>
          数据保存在当前浏览器本地。清理浏览器网站数据可能导致单词和学习记录丢失，请定期导出备份。
        </p>
        <p>可随时导出备份；恢复前请再次导出当前数据并完成覆盖确认。</p>
      </section>
    </>
  );
}

