import {
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";

import type { Word } from "../../data";

interface ModalFrameProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  tone?: "default" | "danger";
}

function ModalFrame({
  title,
  onClose,
  children,
  tone = "default",
}: ModalFrameProps) {
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-card${tone === "danger" ? " modal-card-danger" : ""}`}
        role="dialog"
      >
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            aria-label="关闭对话框"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

interface GroupNameDialogProps {
  mode: "create" | "rename";
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

export function GroupNameDialog({
  mode,
  initialName = "",
  onClose,
  onSubmit,
}: GroupNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputId = useId();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalFrame
      onClose={onClose}
      title={mode === "create" ? "创建分组" : "重命名分组"}
    >
      <form className="word-form" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor={inputId}>分组名称</label>
          <input
            autoFocus
            id={inputId}
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <span className="field-meta">{Array.from(name).length} / 50</span>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            取消
          </button>
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "正在保存…" : "保存分组"}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

interface DeleteGroupDialogProps {
  groupName: string;
  wordCount: number;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteGroupDialog({
  groupName,
  wordCount,
  onCancel,
  onConfirm,
}: DeleteGroupDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalFrame onClose={onCancel} title="确认删除分组" tone="danger">
      <p>
        即将删除分组 <strong>{groupName}</strong>。
      </p>
      <p>
        这个分组包含 <strong>{wordCount}</strong> 个单词。删除后只移除分组和成员关系，不会删除单词、复习状态或学习历史。
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onCancel} type="button">
          取消
        </button>
        <button
          className="danger-button"
          disabled={isDeleting}
          onClick={handleDelete}
          type="button"
        >
          {isDeleting ? "正在删除…" : "确认删除分组"}
        </button>
      </div>
    </ModalFrame>
  );
}

interface AddWordsDialogProps {
  words: Word[];
  onClose: () => void;
  onAdd: (wordIds: string[]) => Promise<void>;
}

export function AddWordsDialog({
  words,
  onClose,
  onAdd,
}: AddWordsDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onAdd(selectedIds);
    } catch (addError) {
      setError(errorMessage(addError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalFrame onClose={onClose} title="添加单词到分组">
      {words.length === 0 ? (
        <p>总词库中的单词已经全部在这个分组里。</p>
      ) : (
        <>
          <p>可以一次选择多个单词。</p>
          <div className="selection-list add-word-list">
            {words.map((word) => (
              <label className="selection-row" key={word.id}>
                <input
                  checked={selectedIds.includes(word.id)}
                  onChange={(event) =>
                    setSelectedIds((current) =>
                      event.target.checked
                        ? [...current, word.id]
                        : current.filter((id) => id !== word.id),
                    )
                  }
                  type="checkbox"
                />
                <span>
                  <strong>{word.displayWord}</strong>
                  <small>{word.chineseMeaning}</small>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose} type="button">
          取消
        </button>
        <button
          className="primary-button"
          disabled={isSaving || selectedIds.length === 0}
          onClick={submit}
          type="button"
        >
          {isSaving ? "正在添加…" : `添加 ${selectedIds.length} 个单词`}
        </button>
      </div>
    </ModalFrame>
  );
}

