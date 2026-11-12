export type DataErrorCode =
  | "VALIDATION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "DATABASE_OPEN"
  | "OPERATION";

export class VocabularyDataError extends Error {
  readonly code: DataErrorCode;

  constructor(code: DataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VocabularyDataError";
    this.code = code;
  }
}

export class DataValidationError extends VocabularyDataError {
  constructor(message: string) {
    super("VALIDATION", message);
    this.name = "DataValidationError";
  }
}

export class DataConflictError extends VocabularyDataError {
  constructor(message: string, options?: ErrorOptions) {
    super("CONFLICT", message, options);
    this.name = "DataConflictError";
  }
}

export class DataNotFoundError extends VocabularyDataError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "DataNotFoundError";
  }
}

export class DatabaseOpenError extends VocabularyDataError {
  constructor(message: string, options?: ErrorOptions) {
    super("DATABASE_OPEN", message, options);
    this.name = "DatabaseOpenError";
  }
}

export class DataOperationError extends VocabularyDataError {
  constructor(message: string, options?: ErrorOptions) {
    super("OPERATION", message, options);
    this.name = "DataOperationError";
  }
}

export function toDataError(
  error: unknown,
  fallbackMessage: string,
): VocabularyDataError {
  if (error instanceof VocabularyDataError) {
    return error;
  }

  if (
    error instanceof DOMException &&
    error.name === "ConstraintError"
  ) {
    return new DataConflictError("写入的数据违反唯一性或关联约束。", {
      cause: error,
    });
  }

  return new DataOperationError(fallbackMessage, { cause: error });
}

