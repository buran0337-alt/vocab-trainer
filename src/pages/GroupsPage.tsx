import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { DataValidationError } from "../data";
import { getRepositories } from "../data/client";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  DeleteGroupDialog,
  GroupNameDialog,
} from "../features/groups/GroupDialogs";
import {
  GroupLibraryService,
  type GroupSummary,
} from "../features/groups/groupLibraryService";

interface GroupsPageProps {
  service?: GroupLibraryService;
}

type DialogState =
  | { type: "create" }
  | { type: "rename"; summary: GroupSummary }
  | { type: "delete"; summary: GroupSummary }
  | null;

function errorMessage(error: unknown): string {
  if (error instanceof DataValidationError || error instanceof Error) {
    return error.message;
  }
  return "分组操作失败，请稍后重试。";
}

export function GroupsPage({
  service: providedService,
}: GroupsPageProps) {
  const [openedService, setOpenedService] =
    useState<GroupLibraryService | null>(null);
  const service = providedService ?? openedService;
  const [summaries, setSummaries] = useState<GroupSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

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

  const refresh = async () => {
    if (!service) return;
    try {
      setSummaries(await service.list());
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
      .then((nextSummaries) => {
        if (active) {
          setSummaries(nextSummaries);
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

  const createGroup = async (name: string) => {
    if (!service) return;
    const group = await service.create(name);
    setDialog(null);
    setNotice(`已创建分组“${group.name}”。`);
    await refresh();
  };

  const renameGroup = async (summary: GroupSummary, name: string) => {
    if (!service) return;
    const group = await service.rename(summary.group.id, name);
    setDialog(null);
    setNotice(`分组已重命名为“${group.name}”。`);
    await refresh();
  };

  const deleteGroup = async (summary: GroupSummary) => {
    if (!service) return;
    await service.delete(summary.group.id);
    setDialog(null);
    setNotice(`已删除分组“${summary.group.name}”。`);
    await refresh();
  };

  return (
    <>
      <PageHeader
        eyebrow="组织"
        title="自定义分组"
        description="用分组整理单词。批量浏览和分组反馈都只使用当前分组成员。"
      />

      <section className="library-toolbar" aria-label="分组操作">
        <div className="word-count-card">
          <span>分组总数</span>
          <strong>{summaries.length}</strong>
        </div>
        <button
          className="primary-button"
          disabled={!service || isLoading}
          onClick={() => {
            setNotice(null);
            setDialog({ type: "create" });
          }}
          type="button"
        >
          创建分组
        </button>
      </section>

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

      {isLoading ? (
        <p className="loading-state" role="status">
          正在读取分组…
        </p>
      ) : summaries.length === 0 ? (
        <EmptyState
          title="还没有分组"
          description="创建分组后，可以从总词库批量添加单词。"
          action={
            <button
              className="primary-button"
              onClick={() => setDialog({ type: "create" })}
              type="button"
            >
              创建第一个分组
            </button>
          }
        />
      ) : (
        <section className="group-grid" aria-label="分组列表">
          {summaries.map((summary) => (
            <article className="group-card" key={summary.group.id}>
              <div>
                <h2>{summary.group.name}</h2>
                <p>
                  {summary.wordCount} 个单词 · 已学习 {summary.startedCount} ·
                  分组历史 {summary.groupHistoryCount}
                </p>
              </div>
              <div className="group-card-actions">
                <Link
                  className="primary-link"
                  to={`/groups/${summary.group.id}`}
                >
                  查看词汇
                </Link>
                <button
                  className="text-button"
                  onClick={() => setDialog({ type: "rename", summary })}
                  type="button"
                >
                  重命名
                </button>
                <button
                  className="text-button text-button-danger"
                  onClick={() => setDialog({ type: "delete", summary })}
                  type="button"
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {dialog?.type === "create" ? (
        <GroupNameDialog
          mode="create"
          onClose={() => setDialog(null)}
          onSubmit={createGroup}
        />
      ) : null}
      {dialog?.type === "rename" ? (
        <GroupNameDialog
          initialName={dialog.summary.group.name}
          mode="rename"
          onClose={() => setDialog(null)}
          onSubmit={(name) => renameGroup(dialog.summary, name)}
        />
      ) : null}
      {dialog?.type === "delete" ? (
        <DeleteGroupDialog
          groupName={dialog.summary.group.name}
          onCancel={() => setDialog(null)}
          onConfirm={() => deleteGroup(dialog.summary)}
          wordCount={dialog.summary.wordCount}
        />
      ) : null}
    </>
  );
}

