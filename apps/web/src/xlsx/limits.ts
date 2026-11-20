/** What the Archive Room accepts as a file (shared by the page and the archive worker; no xlsx code). */

/** Largest file the Archive Room reads (bytes). The template's 5 000 rows per sheet fit well below. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Largest total the file may unpack to (the zip's declared sizes, checked before anything is
 * inflated): a full template is a few MB unpacked; more is a zip bomb or not our workbook.
 */
export const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;

/** Most cells read from all sheets together, and most columns in one sheet (the template has under 20). */
export const MAX_CELLS = 2_000_000;
export const MAX_COLUMNS = 200;

/** How long the archive worker may take for one request before it is stopped (ms). */
export const ARCHIVE_TIMEOUT_MS = 60_000;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Why a file could not be read as a workbook (i18n: `ui.archive.read.<code>`). */
export type ReadFailure = 'tooLarge' | 'empty' | 'notXlsx' | 'corrupt' | 'unzippedTooLarge' | 'tooManyCells' | 'timeout';
