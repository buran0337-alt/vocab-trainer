import { DataValidationError } from "./errors";

const FULL_WIDTH_LATIN_PATTERN = /[Ａ-Ｚａ-ｚ]/g;

function fullWidthLatinToHalfWidth(character: string): string {
  return String.fromCharCode(character.charCodeAt(0) - 0xfee0);
}

/**
 * R01/R29: trim, normalize full-width Latin letters, then ignore case.
 * No stemming is performed, so different word forms remain distinct.
 */
export function normalizeEnglishWord(input: string): string {
  if (typeof input !== "string") {
    throw new DataValidationError("英文单词必须是文本。");
  }

  return input
    .trim()
    .replace(FULL_WIDTH_LATIN_PATTERN, fullWidthLatinToHalfWidth)
    .toLowerCase();
}

export function normalizeGroupName(input: string): string {
  if (typeof input !== "string") {
    throw new DataValidationError("分组名称必须是文本。");
  }

  return input.trim();
}

