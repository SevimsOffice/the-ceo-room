import { type DragEvent, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useArchive } from '../store/archive';

/**
 * The blotter on the reading table: drop the filled-in template on it, or choose it with the file
 * button (a real `<input type=file>`, reachable with Tab). The file is read in this browser only.
 */
export function UploadBlotter() {
  const t = useT();
  const inspect = useArchive((s) => s.inspect);
  const inspection = useArchive((s) => s.inspection);
  const note = useArchive((s) => s.note);
  const dismissNote = useArchive((s) => s.dismissNote);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const reading = inspection.status === 'reading';

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !reading) void inspect(file);
  };

  return (
    <section
      aria-labelledby="upload-title"
      className="absolute left-[476px] top-[196px] z-10 h-[246px] w-[460px] rounded-[6px] p-[10px]"
      style={{ background: 'linear-gradient(135deg,#5a1c1c,#3f1212)', boxShadow: '0 18px 30px rgba(0,0,0,.65)' }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid="blotter"
      data-over={over}
    >
      {/* green felt blotter inside oxblood leather corners */}
      <div
        className="relative flex h-full flex-col rounded-[3px] px-4 pb-3 pt-2.5"
        style={{
          background: over ? 'radial-gradient(ellipse at 50% 40%,#3f6a52,#2c4a39)' : 'radial-gradient(ellipse at 50% 35%,#365a46,#25402f)',
          boxShadow: over ? 'inset 0 0 0 3px #f3da8c' : 'inset 0 0 18px rgba(0,0,0,.55)',
        }}
      >
        <h2 id="upload-title" className="m-0 font-display text-[22px] font-extrabold text-cream-2">
          {t.t('ui.archive.upload.heading')}
        </h2>
        {note ? (
          // the latest outcome (imported, removed, refused…) lies on the blotter until put away
          <div
            role="status"
            className="on-paper mt-1 flex items-center justify-between gap-3 px-3 py-1"
            style={{ background: '#e4d3a4', color: note.tone === 'bad' ? '#8a1818' : '#1f3a28', transform: 'rotate(-.6deg)', boxShadow: '0 8px 14px rgba(0,0,0,.5)' }}
            data-testid="archive-note"
            data-tone={note.tone}
          >
            <p className="m-0 font-type text-label font-bold leading-snug">{t.t(note.code, note.params)}</p>
            <button
              type="button"
              onClick={dismissNote}
              className="press min-h-touch shrink-0 cursor-pointer rounded-sm border-2 border-ink bg-transparent px-3 font-type text-label font-bold uppercase text-ink"
            >
              {t.t('ui.sheet.close')}
            </button>
          </div>
        ) : (
          <p className="m-0 mt-1 font-hand text-[19px] font-semibold italic leading-tight text-[#efe3c4]">
            {over ? t.t('ui.archive.upload.dropping') : t.t('ui.archive.upload.drop')}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <input
            ref={input}
            id="archive-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="peer sr-only"
            disabled={reading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void inspect(file);
              // the same file may be chosen again after it was fixed
              e.target.value = '';
            }}
            data-testid="file-input"
          />
          <label
            htmlFor="archive-file"
            className="press brass flex h-touch cursor-pointer items-center rounded-[3px] px-5 font-display text-base font-bold peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-[#f3da8c] peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
            data-testid="file-browse"
          >
            {t.t('ui.archive.upload.browse')}
          </label>
          {reading && (
            <span className="font-type text-label text-[#efe3c4]" role="status">
              {t.t('ui.archive.upload.reading', { name: inspection.fileName })}
            </span>
          )}
        </div>
        <p className="m-0 mt-2 font-type text-label leading-snug text-[#e3d9bf]" data-testid="upload-privacy">
          {t.t('ui.archive.upload.privacy')}
        </p>
      </div>
    </section>
  );
}
