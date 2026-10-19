/**
 * Accent-insensitive text for search.
 *
 * Decomposes to NFD, drops the combining marks and maps the Vietnamese
 * stroked d (which does not decompose) to a plain d, then lowercases, so
 * "Biểu Đồ" and "bieu do" compare equal. Plain ASCII passes through
 * lowercased and otherwise unchanged.
 */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/gu, '').replace(/[đĐ]/gu, 'd').toLowerCase();
}
