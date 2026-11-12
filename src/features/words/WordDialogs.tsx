import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  MAX_MEANING_LENGTH,
  MAX_WORD_DISPLAY_LENGTH,
  textLength,
  VocabularyDataError,
} from "../../data";
import {
  hasWordFormErrors,
  validateWordForm,
  type WordFieldErrors,
  type WordFormValues,
  type WordListItem,
} from "./wordLibraryService";

interface ModalFrameProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
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
      if (event.key === "Escape") {
        onClose();
      }
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
  if (error instanceof VocabularyDataError) {
    return error.message;
  }

  return "操作失败，请稍后重试。";
}

interface WordFormDialogProps {
  mode: "create" | "edit";
  initialValues: WordFormValues;
  onClose: () => void;
  onSave: (values: WordFormValues) => Promise<void>;
}

export function WordFormDialog({
  mode,
  initialValues,
  onClose,
  onSave,
}: WordFormDialogProps) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<WordFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const wordFieldId = useId();
  const meaningFieldId = useId();
  const wordCountId = `${wordFieldId}-count`;
  const meaningCountId = `${meaningFieldId}-count`;
  const wordErrorId = `${wordFieldId}-error`;
  const meaningErrorId = `${meaningFieldId}-error`;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateWordForm(values);
    setErrors(nextErrors);
    setSubmitError(null);

    if (hasWordFormErrors(nextErrors)) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave(values);
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalFrame
      onClose={onClose}
      title={mode === "create" ? "添加单词" : "编辑单词"}
    >
      <form className="word-form" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor={wordFieldId}>英文单词</label>
          <input
            aria-describedby={
              errors.displayWord
                ? `${wordCountId} ${wordErrorId}`
                : wordCountId
            }
            autoFocus
            id={wordFieldId}
            maxLength={MAX_WORD_DISPLAY_LENGTH}
            name="displayWord"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                displayWord: event.target.value,
              }))
            }
            value={values.displayWord}
          />
          <span className="field-meta" id={wordCountId}>
            {textLength(values.displayWord)} / {MAX_WORD_DISPLAY_LENGTH}
          </span>
          {errors.displayWord ? (
            <span className="field-error" id={wordErrorId}>
              {errors.displayWord}
            </span>
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor={meaningFieldId}>中文释义</label>
          <textarea
            aria-describedby={
              errors.chineseMeaning
                ? `${meaningCountId} ${meaningErrorId}`
                : meaningCountId
            }
            id={meaningFieldId}
            maxLength={MAX_MEANING_LENGTH}
            name="chineseMeaning"
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                chineseMeaning: event.target.value,
              }))
            }
            rows={7}
            value={values.chineseMeaning}
          />
          <span className="field-meta" id={meaningCountId}>
            {textLength(values.chineseMeaning)} / {MAX_MEANING_LENGTH}
          </span>
          {errors.chineseMeaning ? (
            <span className="field-error" id={meaningErrorId}>
              {errors.chineseMeaning}
            </span>
          ) : null}
        </div>

        {submitError ? (
          <p className="form-error" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            取消
          </button>
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "正在保存…" : "保存单词"}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

interface ConflictDialogProps {
  displayWord: string;
  existingMeaning: string;
  candidateMeaning: string;
  onKeep: () => void;
  onUpdate: () => Promise<void>;
}

export function ConflictDialog({
  displayWord,
  existingMeaning,
  candidateMeaning,
  onKeep,
  onUpdate,
}: ConflictDialogProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleUpdate = async () => {
    setIsUpdating(true);
    setSubmitError(null);
    try {
      await onUpdate();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="conflict-title"
        aria-modal="true"
        className="modal-card"
        role="dialog"
      >
        <div className="modal-heading">
          <h2 id="conflict-title">发现释义冲突</h2>
          <button
            aria-label="关闭对话框"
            className="icon-button"
            onClick={onKeep}
            type="button"
          >
            ×
          </button>
        </div>
        <p>
          单词 <strong>{displayWord}</strong> 已存在。请选择保留原释义，或用本次输入更新释义。
        </p>
        <div className="comparison-grid">
          <div>
            <span>原释义</span>
            <p>{existingMeaning}</p>
          </div>
          <div>
            <span>本次输入</span>
            <p>{candidateMeaning}</p>
          </div>
        </div>
        <p className="supporting-text">
          未选择时默认保留原释义；更新释义不会改变学习状态和历史。
        </p>
        {submitError ? (
          <p className="form-error" role="alert">
            {submitError}
          </p>
        ) : null}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onKeep} type="button">
            保留原释义
          </button>
          <button
            className="primary-button"
            disabled={isUpdating}
            onClick={handleUpdate}
            type="button"
          >
            {isUpdating ? "正在更新…" : "更新为本次释义"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface DeleteDialogProps {
  displayWord: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteDialog({
  displayWord,
  onCancel,
  onConfirm,
}: DeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setSubmitError(null);
    try {
      await onConfirm();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalFrame onClose={onCancel} title="确认删除单词" tone="danger">
      <p>
        即将删除 <strong>{displayWord}</strong>。
      </p>
      <ul className="danger-list">
        <li>该单词的全部分组关联将被清理。</li>
        <li>该单词的复习状态将被清理。</li>
        <li>该单词的全部学习历史将被清理。</li>
      </ul>
      <p className="supporting-text">此操作会立即修改本地数据，请确认后再继续。</p>
      {submitError ? (
        <p className="form-error" role="alert">
          {submitError}
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
          {isDeleting ? "正在删除…" : "确认删除"}
        </button>
      </div>
    </ModalFrame>
  );
}

interface WordDetailsDialogProps {
  item: WordListItem;
  onClose: () => void;
}

export function WordDetailsDialog({
  item,
  onClose,
}: WordDetailsDialogProps) {
  const state = item.reviewState;

  return (
    <ModalFrame onClose={onClose} title="单词详情">
      <div className="detail-word">{item.word.displayWord}</div>
      <p className="detail-meaning">{item.word.chineseMeaning}</p>
      {state ? (
        <dl className="detail-grid">
          <div>
            <dt>学习次数</dt>
            <dd>{item.learningCount}</dd>
          </div>
          <div>
            <dt>EF</dt>
            <dd>{state.ef.toFixed(2)}</dd>
          </div>
          <div>
            <dt>连续成功</dt>
            <dd>{state.consecutiveSuccesses}</dd>
          </div>
          <div>
            <dt>连续忘记</dt>
            <dd>{state.consecutiveForgets}</dd>
          </div>
          <div>
            <dt>最近学习</dt>
            <dd>{formatDateTime(state.lastFeedbackAtMs)}</dd>
          </div>
          <div>
            <dt>下次复习</dt>
            <dd>{formatDateTime(state.nextReviewAtMs)}</dd>
          </div>
        </dl>
      ) : (
        <p className="learning-empty">尚未开始学习</p>
      )}
    </ModalFrame>
  );
}

function formatDateTime(value: number | null): string {
  if (value === null) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}


