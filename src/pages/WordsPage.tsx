import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { VocabularyDataError } from "../data";
import { getRepositories } from "../data/client";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { WordImportDialog } from "../features/import/WordImportDialog";
import { WordImportService } from "../features/import/wordImportService";
import {
  ConflictDialog,
  DeleteDialog,
  WordDetailsDialog,
  WordFormDialog,
} from "../features/words/WordDialogs";
import {
  WordLibraryService,
  type WordFormValues,
  type WordListItem,
} from "../features/words/wordLibraryService";

type DialogState =
  | { type: "create" }
  | { type: "edit"; item: WordListItem }
  | { type: "details"; item: WordListItem }
  | { type: "delete"; item: WordListItem }
  | {
      type: "conflict";
      existing: WordListItem["word"];
      candidateMeaning: string;
    }
  | null;

export interface WordsPageProps {
  service?: WordLibraryService;
  importService?: WordImportService;
}

function errorMessage(error: unknown): string {
  if (error instanceof VocabularyDataError) {
    return error.message;
  }

  return "读取单词库失败，请刷新页面后重试。";
}

export function WordsPage({
  service: providedService,
  importService: providedImportService,
}: WordsPageProps) {
  const [openedService, setOpenedService] =
    useState<WordLibraryService | null>(null);
  const [openedImportService, setOpenedImportService] =
    useState<WordImportService | null>(null);
  const service = providedService ?? openedService;
  const importService =
    providedImportService ?? openedImportService;
  const [items, setItems] = useState<WordListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return items;
    return items.filter(
      (item) =>
        item.word.displayWord.toLocaleLowerCase().includes(normalizedQuery) ||
        item.word.chineseMeaning
          .toLocaleLowerCase()
          .includes(normalizedQuery),
    );
  }, [items, query]);

  useEffect(() => {
    if (providedService) {
      return;
    }

    let active = true;
    getRepositories()
      .then((repositories) => {
        if (active) {
          setOpenedService(new WordLibraryService(repositories));
          setOpenedImportService(new WordImportService(repositories));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPageError(errorMessage(error));
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [providedService]);

  const refresh = useCallback(async () => {
    if (!service) {
      return;
    }

    setIsLoading(true);
    setPageError(null);
    try {
      setItems(await service.listWords());
    } catch (error) {
      setPageError(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [service]);

  useEffect(() => {
    if (!service) {
      return;
    }

    let active = true;
    service
      .listWords()
      .then((nextItems) => {
        if (active) {
          setItems(nextItems);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPageError(errorMessage(error));
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [service]);

  const handleCreate = async (values: WordFormValues) => {
    if (!service) {
      return;
    }

    const result = await service.addWord(values);

    if (result.status === "conflict") {
      setDialog({
        type: "conflict",
        existing: result.word,
        candidateMeaning: result.candidateMeaning,
      });
      return;
    }

    setDialog(null);
    setNotice(
      result.status === "created"
        ? `已添加单词 ${result.word.displayWord}。`
        : "该单词和释义均已存在，原记录保持不变。",
    );
    await refresh();
  };

  const handleUpdate = async (
    item: WordListItem,
    values: WordFormValues,
  ) => {
    if (!service) {
      return;
    }

    const word = await service.updateWord(item.word.id, values);
    setDialog(null);
    setNotice(`已保存单词 ${word.displayWord}。`);
    await refresh();
  };

  const handleKeepExistingMeaning = async () => {
    setDialog(null);
    setNotice("已保留原释义，未修改单词或学习状态。");
    await refresh();
  };

  const handleUpdateConflictMeaning = async () => {
    if (!service || dialog?.type !== "conflict") {
      return;
    }

    const word = await service.updateMeaning(
      dialog.existing.id,
      dialog.candidateMeaning,
    );
    setDialog(null);
    setNotice(`已更新 ${word.displayWord} 的中文释义。`);
    await refresh();
  };

  const handleDelete = async (item: WordListItem) => {
    if (!service) {
      return;
    }

    await service.deleteWord(item.word.id);
    setDialog(null);
    setNotice(`已删除单词 ${item.word.displayWord}。`);
    await refresh();
  };

  return (
    <>
      <PageHeader
        eyebrow="词库"
        title="单词库"
        description="维护自己的英文单词和完整中文释义。此处只管理词库，不开始学习或复习。"
      />

      <section className="library-toolbar" aria-label="单词库操作">
        <div className="word-count-card">
          <span>单词总数</span>
          <strong>{items.length}</strong>
        </div>
        <div className="library-actions">
          <button
            className="secondary-button"
            disabled={!importService || isLoading}
            onClick={() => {
              setNotice(null);
              setIsImportOpen(true);
            }}
            type="button"
          >
            导入单词
          </button>
          <button
            className="primary-button"
            disabled={!service || isLoading}
            onClick={() => {
              setNotice(null);
              setDialog({ type: "create" });
            }}
            type="button"
          >
            添加单词
          </button>
        </div>
      </section>

      {items.length > 0 ? (
        <label className="word-search">
          <span>搜索</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入英文或中文释义"
            type="search"
            value={query}
          />
        </label>
      ) : null}

      {notice ? (
        <p className="success-notice" role="status">
          {notice}
        </p>
      ) : null}
      {pageError ? (
        <p className="form-error page-error" role="alert">
          {pageError}
        </p>
      ) : null}

      {isLoading ? (
        <p className="loading-state" role="status">
          正在读取本地词库…
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          title="词库目前为空"
          description="从手动添加第一个单词开始。数据只保存在当前浏览器中。"
          action={
            <button
              className="primary-button"
              onClick={() => setDialog({ type: "create" })}
              type="button"
            >
              添加第一个单词
            </button>
          }
        />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          title="没有匹配的单词"
          description="可以清空搜索条件，查看完整词库。"
        />
      ) : (
        <>
          <p className="inspection-summary" role="status">
            当前显示 {visibleItems.length} / {items.length} 个单词
          </p>
          <section className="word-list" aria-label="单词列表">
          {visibleItems.map((item) => (
            <article className="word-card" key={item.word.id}>
              <div className="word-card-heading">
                <h2>{item.word.displayWord}</h2>
                <span
                  className={
                    item.reviewState
                      ? "learning-badge"
                      : "learning-badge learning-badge-new"
                  }
                >
                  {item.reviewState
                    ? `已学习 ${item.learningCount} 次 · EF ${item.reviewState.ef.toFixed(2)}`
                    : "尚未开始学习"}
                </span>
              </div>
              <p className="word-meaning">{item.word.chineseMeaning}</p>
              <div className="word-card-actions">
                <button
                  className="text-button"
                  onClick={() => setDialog({ type: "details", item })}
                  type="button"
                >
                  查看详情
                </button>
                <button
                  className="text-button"
                  onClick={() => setDialog({ type: "edit", item })}
                  type="button"
                >
                  编辑
                </button>
                <button
                  className="text-button text-button-danger"
                  onClick={() => setDialog({ type: "delete", item })}
                  type="button"
                >
                  删除
                </button>
              </div>
            </article>
          ))}
          </section>
        </>
      )}

      {dialog?.type === "create" ? (
        <WordFormDialog
          initialValues={{ displayWord: "", chineseMeaning: "" }}
          mode="create"
          onClose={() => setDialog(null)}
          onSave={handleCreate}
        />
      ) : null}

      {dialog?.type === "edit" ? (
        <WordFormDialog
          initialValues={{
            displayWord: dialog.item.word.displayWord,
            chineseMeaning: dialog.item.word.chineseMeaning,
          }}
          mode="edit"
          onClose={() => setDialog(null)}
          onSave={(values) => handleUpdate(dialog.item, values)}
        />
      ) : null}

      {dialog?.type === "details" ? (
        <WordDetailsDialog
          item={dialog.item}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.type === "delete" ? (
        <DeleteDialog
          displayWord={dialog.item.word.displayWord}
          onCancel={() => setDialog(null)}
          onConfirm={() => handleDelete(dialog.item)}
        />
      ) : null}

      {dialog?.type === "conflict" ? (
        <ConflictDialog
          candidateMeaning={dialog.candidateMeaning}
          displayWord={dialog.existing.displayWord}
          existingMeaning={dialog.existing.chineseMeaning}
          onKeep={handleKeepExistingMeaning}
          onUpdate={handleUpdateConflictMeaning}
        />
      ) : null}

      {isImportOpen && importService ? (
        <WordImportDialog
          onClose={() => setIsImportOpen(false)}
          onCompleted={(message) => {
            setNotice(message);
            void refresh();
          }}
          service={importService}
        />
      ) : null}
    </>
  );
}

