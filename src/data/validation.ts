import { DataValidationError } from "./errors";

export function requireNonEmptyText(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DataValidationError(`${fieldName}不能为空。`);
  }

  return value;
}

export function textLength(value: string): number {
  return Array.from(value).length;
}

export function assertMaximumTextLength(
  value: string,
  maximum: number,
  fieldName: string,
): void {
  if (textLength(value) > maximum) {
    throw new DataValidationError(
      `${fieldName}不能超过 ${maximum} 个字符。`,
    );
  }
}

export function requireNonNegativeInteger(
  value: unknown,
  fieldName: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new DataValidationError(`${fieldName}必须是非负整数。`);
  }

  return value;
}

export function assertUniqueIds(ids: readonly string[], fieldName: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new DataValidationError(`${fieldName}中存在重复单词 ID。`);
  }

  for (const id of ids) {
    requireNonEmptyText(id, `${fieldName}中的单词 ID`);
  }
}

