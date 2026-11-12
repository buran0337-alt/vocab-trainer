import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";

import { VocabularyDataError } from "../../data";
import {
  countUnresolvedDecisions,
  decideImportGroups,
  type ImportAnalysis,
  type ImportGroupDecision,
  type ImportResolutionState,
} from "./importAnalysis";
import {
  ImportFileError,
  suggestColumnMapping,
  validateColumnMapping,
  type ParsedWorkbook,
  type SheetColumnMapping,
} from "./spreadsheetParser";
import {
  WordImportService,
  type ImportExecutionResult,
} from "./wordImportService";

type ImportStep =
  | "file"
  | "sheets"
  | "mapping"
  | "preview"
  | "confirm"
  | "result";

type MappingsBySheet = Record<
  string,
  { wordColumn: number | null; meaningColumn: number | null }
>;

interface WordImportDialogProps {
  service: WordImportService;
  onClose: () => void;
  onCompleted: (message: string) => void;
}

interface ImportResult extends ImportExecutionResult {
  skippedCount: number;
  invalidCount: number;
}

interface SelectedFileInfo {
  name: string;
  size: number;
}

const STATUS_LABELS = {
  new: "新增",
  "existing-same": "已有相同释义",
  "existing-conflict": "已有释义冲突",
  "file-duplicate-same": "文件内重复",
  "file-conflict": "文件内释义冲突",
  invalid: "无效",
  empty: "空行",
} as const;

function errorMessage(error: unknown): string {
  if (
    error instanceof ImportFileError ||
    error instanceof VocabularyDataError ||
    error instanceof Error
  ) {
    return error.message;
  }
  return "导入失败，请检查文件或稍后重试。";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initialMappings(workbook: ParsedWorkbook): MappingsBySheet {
  return Object.fromEntries(
    workbook.sheets.map((sheet) => [
      sheet.name,
      suggestColumnMapping(sheet),
    ]),
  );
}

function initialResolution(): ImportResolutionState {
  return {
    existingConflictMode: "manual",
    selectedFileMeanings: {},
    manualExistingDecisions: {},
  };
}

export function WordImportDialog({
  service,
  onClose,
  onCompleted,
}: WordImportDialogProps) {
  const [step, setStep] = useState<ImportStep>("file");
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [selectedFile, setSelectedFile] =
    useState<SelectedFileInfo | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [mappings, setMappings] = useState<MappingsBySheet>({});
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [resolution, setResolution] =
    useState<ImportResolutionState>(initialResolution);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, onClose]);

  const mappingList: SheetColumnMapping[] = selectedSheets.map((sheetName) => ({
    sheetName,
    wordColumn: mappings[sheetName]?.wordColumn ?? null,
    meaningColumn: mappings[sheetName]?.meaningColumn ?? null,
  }));

  const mappingErrors = workbook
    ? mappingList.flatMap((mapping) => {
        const sheet = workbook.sheets.find(
          (candidate) => candidate.name === mapping.sheetName,
        );
        if (!sheet) {
          return [`找不到工作表“${mapping.sheetName}”。`];
        }
        const message = validateColumnMapping(sheet, mapping);
        return message ? [message] : [];
      })
    : [];

  const decisions = useMemo(
    () => (analysis ? decideImportGroups(analysis, resolution) : []),
    [analysis, resolution],
  );
  const unresolvedCount = countUnresolvedDecisions(decisions);
  const skipDecisionCount = decisions.filter(
    (decision) => decision.type === "skip",
  ).length;
  const duplicateRowCount =
    analysis?.rows.filter((row) => row.status === "file-duplicate-same")
      .length ?? 0;
  const skippedCount = skipDecisionCount + duplicateRowCount;
  const invalidCount =
    (analysis?.invalidRowCount ?? 0) + (analysis?.emptyRowCount ?? 0);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setSelectedFile({ name: file.name, size: file.size });
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const parsed = await service.parseFile(
        file.name,
        await file.arrayBuffer(),
      );
      const nextMappings = initialMappings(parsed);
      setWorkbook(parsed);
      setMappings(nextMappings);
      setResolution(initialResolution());
      setAnalysis(null);

      if (parsed.kind === "csv") {
        setSelectedSheets([parsed.sheets[0].name]);
        setStep("mapping");
      } else {
        setSelectedSheets([]);
        setStep("sheets");
      }
    } catch (fileError) {
      setWorkbook(null);
      setSelectedSheets([]);
      setError(errorMessage(fileError));
    } finally {
      setIsBusy(false);
      event.target.value = "";
    }
  };

  const continueFromSheets = () => {
    if (selectedSheets.length === 0) {
      setError("请至少选择一个工作表。");
      return;
    }
    setError(null);
    setStep("mapping");
  };

  const buildPreview = async () => {
    if (!workbook || mappingErrors.length > 0) {
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const nextAnalysis = await service.analyze(workbook, mappingList);
      setAnalysis(nextAnalysis);
      setResolution(initialResolution());
      setStep("preview");
    } catch (previewError) {
      setError(errorMessage(previewError));
    } finally {
      setIsBusy(false);
    }
  };

  const updateMapping = (
    sheetName: string,
    field: "wordColumn" | "meaningColumn",
    value: string,
  ) => {
    setMappings((current) => ({
      ...current,
      [sheetName]: {
        ...current[sheetName],
        [field]: value === "" ? null : Number(value),
      },
    }));
  };

  const updateManualDecision = (
    normalizedWord: string,
    decision: "keep" | "update",
  ) => {
    setResolution((current) => ({
      ...current,
      manualExistingDecisions: {
        ...current.manualExistingDecisions,
        [normalizedWord]: decision,
      },
    }));
  };

  const executeImport = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const executed = await service.execute(decisions);
      setResult({
        ...executed,
        skippedCount,
        invalidCount,
      });
      setStep("result");
      onCompleted(
        `导入完成：新增 ${executed.createdCount}，更新 ${executed.updatedCount}。`,
      );
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setIsBusy(false);
    }
  };

  const title =
    step === "result" ? "导入结果" : "导入 Excel / CSV 单词";

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="import-title"
        aria-modal="true"
        className="modal-card import-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <h2 id="import-title">{title}</h2>
          <button
            aria-label="关闭导入"
            className="icon-button"
            disabled={isBusy}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <ol className="import-steps" aria-label="导入步骤">
          {[
            ["file", "选择文件"],
            ...(workbook?.kind === "excel"
              ? ([["sheets", "选择工作表"]] as const)
              : []),
            ["mapping", "确认列"],
            ["preview", "预览与冲突"],
            ["confirm", "确认导入"],
            ["result", "完成"],
          ].map(([key, label]) => (
            <li
              className={step === key ? "import-step-active" : ""}
              key={key}
            >
              {label}
            </li>
          ))}
        </ol>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        {step === "file" ? (
          <div className="import-file-step">
            <p>
              支持 `.xlsx`、`.xls` 和 `.csv`。CSV 需使用 UTF-8，或带 BOM 的 UTF-16 编码。
            </p>
            <label className="file-picker">
              <span>{isBusy ? "正在解析文件…" : "选择导入文件"}</span>
              <input
                accept=".xlsx,.xls,.csv"
                aria-label="选择导入文件"
                disabled={isBusy}
                onChange={handleFile}
                type="file"
              />
            </label>
            {workbook ? (
              <p className="supporting-text">
                {workbook.fileName} · {workbook.sheets.length} 个工作表
                {selectedFile
                  ? ` · ${formatFileSize(selectedFile.size)}`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "sheets" && workbook ? (
          <div>
            <p>请选择要导入的工作表，可多选。未选择的工作表不会写入。</p>
            <div className="selection-list">
              {workbook.sheets.map((sheet) => (
                <label className="selection-row" key={sheet.name}>
                  <input
                    checked={selectedSheets.includes(sheet.name)}
                    onChange={(event) =>
                      setSelectedSheets((current) =>
                        event.target.checked
                          ? [...current, sheet.name]
                          : current.filter((name) => name !== sheet.name),
                      )
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{sheet.name}</strong>
                    <small>
                      {sheet.columns.length} 列 · {sheet.rows.length} 个数据行
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setStep("file")}
                type="button"
              >
                上一步
              </button>
              <button
                className="primary-button"
                disabled={selectedSheets.length === 0}
                onClick={continueFromSheets}
                type="button"
              >
                下一步：确认列
              </button>
            </div>
          </div>
        ) : null}

        {step === "mapping" && workbook ? (
          <div>
            <p>请逐个工作表确认列映射。自动识别结果可以手动修改。</p>
            <div className="mapping-list">
              {selectedSheets.map((sheetName) => {
                const sheet = workbook.sheets.find(
                  (candidate) => candidate.name === sheetName,
                );
                if (!sheet) {
                  return null;
                }
                return (
                  <fieldset className="mapping-card" key={sheetName}>
                    <legend>{sheetName}</legend>
                    <label>
                      英文单词列
                      <select
                        aria-label={`${sheetName} 英文单词列`}
                        onChange={(event) =>
                          updateMapping(
                            sheetName,
                            "wordColumn",
                            event.target.value,
                          )
                        }
                        value={mappings[sheetName]?.wordColumn ?? ""}
                      >
                        <option value="">请选择</option>
                        {sheet.columns.map((column) => (
                          <option key={column.index} value={column.index}>
                            {column.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      中文释义列
                      <select
                        aria-label={`${sheetName} 中文释义列`}
                        onChange={(event) =>
                          updateMapping(
                            sheetName,
                            "meaningColumn",
                            event.target.value,
                          )
                        }
                        value={mappings[sheetName]?.meaningColumn ?? ""}
                      >
                        <option value="">请选择</option>
                        {sheet.columns.map((column) => (
                          <option key={column.index} value={column.index}>
                            {column.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                );
              })}
            </div>
            {mappingErrors.map((message) => (
              <p className="field-error" key={message}>
                {message}
              </p>
            ))}
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setStep(workbook.kind === "excel" ? "sheets" : "file")
                }
                type="button"
              >
                上一步
              </button>
              <button
                className="primary-button"
                disabled={isBusy || mappingErrors.length > 0}
                onClick={buildPreview}
                type="button"
              >
                {isBusy ? "正在校验…" : "生成预览"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "preview" && analysis ? (
          <div>
            <div className="import-summary" aria-label="导入分类汇总">
              <span>新增 <strong>{analysis.newGroupCount}</strong></span>
              <span>已有相同 <strong>{analysis.existingSameGroupCount}</strong></span>
              <span>已有冲突 <strong>{analysis.existingConflictGroupCount}</strong></span>
              <span>文件内冲突 <strong>{analysis.fileConflictGroupCount}</strong></span>
              <span>无效 <strong>{analysis.invalidRowCount}</strong></span>
              <span>空行 <strong>{analysis.emptyRowCount}</strong></span>
            </div>

            {analysis.existingConflictGroupCount > 0 ? (
              <section className="conflict-section">
                <h3>已有单词释义冲突</h3>
                <div className="segmented-actions">
                  {[
                    ["manual", "逐项选择"],
                    ["keep", "全部保留原释义"],
                    ["update", "全部更新释义"],
                  ].map(([value, label]) => (
                    <button
                      className={
                        resolution.existingConflictMode === value
                          ? "segmented-active"
                          : ""
                      }
                      key={value}
                      onClick={() =>
                        setResolution((current) => ({
                          ...current,
                          existingConflictMode:
                            value as ImportResolutionState["existingConflictMode"],
                        }))
                      }
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {resolution.existingConflictMode === "manual" ? (
                  <div className="conflict-list">
                    {analysis.groups
                      .filter((group) => group.hasExistingConflict)
                      .map((group) => (
                        <fieldset
                          className="conflict-card"
                          key={group.normalizedWord}
                        >
                          <legend>{group.existingWord?.displayWord}</legend>
                          <p className="supporting-text">
                            原释义：{group.existingWord?.chineseMeaning}
                          </p>
                          <label>
                            <input
                              checked={
                                (resolution.manualExistingDecisions[
                                  group.normalizedWord
                                ] ?? "keep") === "keep"
                              }
                              name={`existing-${group.normalizedWord}`}
                              onChange={() =>
                                updateManualDecision(
                                  group.normalizedWord,
                                  "keep",
                                )
                              }
                              type="radio"
                            />
                            保留原释义
                          </label>
                          <label>
                            <input
                              checked={
                                resolution.manualExistingDecisions[
                                  group.normalizedWord
                                ] === "update"
                              }
                              name={`existing-${group.normalizedWord}`}
                              onChange={() =>
                                updateManualDecision(
                                  group.normalizedWord,
                                  "update",
                                )
                              }
                              type="radio"
                            />
                            更新为选定释义
                          </label>
                        </fieldset>
                      ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {analysis.fileConflictGroupCount > 0 ? (
              <section className="conflict-section">
                <h3>文件内部释义冲突</h3>
                <p className="supporting-text">
                  以下单词必须逐项选择最终释义，不会自动采用第一行或最后一行。
                </p>
                <div className="conflict-list">
                  {analysis.groups
                    .filter((group) => group.hasFileConflict)
                    .map((group) => (
                      <fieldset
                        className="conflict-card"
                        key={group.normalizedWord}
                      >
                        <legend>
                          {group.rows[0].displayWord}
                          {group.existingWord
                            ? "（同时存在于现有词库）"
                            : ""}
                        </legend>
                        {group.existingWord ? (
                          <p className="supporting-text">
                            现有释义：{group.existingWord.chineseMeaning}
                          </p>
                        ) : null}
                        {group.meanings.map((meaning) => (
                          <label key={meaning}>
                            <input
                              checked={
                                resolution.selectedFileMeanings[
                                  group.normalizedWord
                                ] === meaning
                              }
                              name={`file-${group.normalizedWord}`}
                              onChange={() =>
                                setResolution((current) => ({
                                  ...current,
                                  selectedFileMeanings: {
                                    ...current.selectedFileMeanings,
                                    [group.normalizedWord]: meaning,
                                  },
                                }))
                              }
                              type="radio"
                            />
                            {meaning}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                </div>
              </section>
            ) : null}

            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>英文</th>
                    <th>中文释义</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.sheetName} · 第 {row.rowNumber} 行
                      </td>
                      <td>{row.displayWord || "—"}</td>
                      <td>{row.chineseMeaning || "—"}</td>
                      <td>
                        <span className={`import-status status-${row.status}`}>
                          {STATUS_LABELS[row.status]}
                        </span>
                        <small>{row.messages.join(" ")}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {unresolvedCount > 0 ? (
              <p className="form-error" role="status">
                还有 {unresolvedCount} 个文件内冲突单词未选择最终释义。
              </p>
            ) : null}

            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setStep("mapping")}
                type="button"
              >
                返回修改列
              </button>
              <button
                className="primary-button"
                disabled={unresolvedCount > 0}
                onClick={() => setStep("confirm")}
                type="button"
              >
                下一步：确认导入
              </button>
            </div>
          </div>
        ) : null}

        {step === "confirm" ? (
          <div>
            <p>请确认以下最终结果。只有你确认后才会写入本地数据库。</p>
            <dl className="import-confirm-summary">
              <div>
                <dt>准备新增</dt>
                <dd>
                  {
                    decisions.filter((decision) => decision.type === "create")
                      .length
                  }
                </dd>
              </div>
              <div>
                <dt>准备更新释义</dt>
                <dd>
                  {
                    decisions.filter(
                      (decision) => decision.type === "update-meaning",
                    ).length
                  }
                </dd>
              </div>
              <div>
                <dt>预计跳过</dt>
                <dd>{skippedCount}</dd>
              </div>
              <div>
                <dt>无效或空行</dt>
                <dd>{invalidCount}</dd>
              </div>
            </dl>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setStep("preview")}
                type="button"
              >
                返回检查
              </button>
              <button
                className="primary-button"
                disabled={isBusy}
                onClick={executeImport}
                type="button"
              >
                {isBusy ? "正在导入…" : "确认并导入"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "result" && result ? (
          <div>
            <p className="success-notice" role="status">
              文件已处理完成，所有写入在同一事务中提交。
            </p>
            <dl className="import-confirm-summary">
              <div>
                <dt>新增</dt>
                <dd>{result.createdCount}</dd>
              </div>
              <div>
                <dt>更新释义</dt>
                <dd>{result.updatedCount}</dd>
              </div>
              <div>
                <dt>跳过</dt>
                <dd>{result.skippedCount}</dd>
              </div>
              <div>
                <dt>无效或空行</dt>
                <dd>{result.invalidCount}</dd>
              </div>
              <div>
                <dt>失败</dt>
                <dd>0</dd>
              </div>
            </dl>
            <div className="modal-actions">
              <button className="primary-button" onClick={onClose} type="button">
                完成
              </button>
            </div>
          </div>
        ) : null}

        {step !== "result" ? (
          <div className="import-footer">
            <span>取消不会修改任何数据。</span>
            <button
              className="text-button"
              disabled={isBusy}
              onClick={onClose}
              type="button"
            >
              取消导入
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export type { ImportAnalysis, ImportGroupDecision };

