/** What the Archive Room accepts as a file (shared by the page and the archive worker; no xlsx code). */

/** Largest file the Archive Room reads (bytes). The template's 5 000 rows per sheet fit well below. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Why a file could not be read as a workbook (i18n: `ui.archive.read.<code>`). */
export type ReadFailure = 'tooLarge' | 'empty' | 'notXlsx' | 'corrupt';
