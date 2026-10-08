import React from 'react';

/**
 * Lightweight Cooklang syntax highlighter for the editor overlay.
 *
 * IMPORTANT: the returned nodes are rendered directly underneath a transparent <textarea>,
 * so they must NEVER alter glyph metrics — only colors and backgrounds.
 * No borders, no padding, no bold/italics that shift glyph widths.
 */

const ENTITY_RE = /(\[-.*?-\])|(--.*$)|([@#~])([^@#~{}\n]*?\{[^}\n]*\}|[\p{L}\p{N}_-]*)/gu;

const CLS = {
  ingredient: 'text-[#DE5D4E] dark:text-[#f87a6c] bg-[#DE5D4E]/10 rounded-xs',
  cookware: 'text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-xs',
  timer: 'text-sky-700 dark:text-sky-300 bg-sky-500/10 rounded-xs',
  brace: 'opacity-60',
  comment: 'text-stone-400 dark:text-stone-500',
  metaKey: 'text-emerald-700 dark:text-emerald-400 font-medium',
  metaValue: 'text-stone-600 dark:text-stone-300',
  fence: 'text-stone-400 dark:text-stone-500',
  section: 'text-violet-700 dark:text-violet-300 bg-violet-500/10',
  note: 'text-stone-500 dark:text-stone-400'
};

function highlightStepLine(line: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;

  for (const match of line.matchAll(ENTITY_RE)) {
    const start = match.index ?? 0;
    if (start > last) {
      out.push(line.slice(last, start));
    }

    const [full, blockComment, lineComment, marker, rest] = match;
    const key = `${keyPrefix}_${k++}`;

    if (blockComment || lineComment) {
      out.push(
        <span key={key} className={CLS.comment}>
          {full}
        </span>
      );
    } else if (marker) {
      const cls = marker === '@' ? CLS.ingredient : marker === '#' ? CLS.cookware : CLS.timer;
      const braceIdx = rest.indexOf('{');
      if (braceIdx === -1) {
        out.push(
          <span key={key} className={cls}>
            {full}
          </span>
        );
      } else {
        out.push(
          <span key={key} className={cls}>
            {marker}
            {rest.slice(0, braceIdx)}
            <span className={CLS.brace}>{rest.slice(braceIdx)}</span>
          </span>
        );
      }
    }
    last = start + full.length;
  }

  if (last < line.length) {
    out.push(line.slice(last));
  }
  return out;
}

export function highlightCooklang(source: string): React.ReactNode[] {
  const lines = source.split('\n');
  const out: React.ReactNode[] = [];
  let inFrontMatter = false;
  let frontMatterDone = false;
  let inBlockComment = false;

  lines.forEach((line, idx) => {
    const key = `l${idx}`;
    let node: React.ReactNode;

    if (idx === 0 && /^---\s*$/.test(line)) {
      inFrontMatter = true;
      node = <span className={CLS.fence}>{line}</span>;
    } else if (inFrontMatter && !frontMatterDone) {
      if (/^---\s*$/.test(line)) {
        inFrontMatter = false;
        frontMatterDone = true;
        node = <span className={CLS.fence}>{line}</span>;
      } else {
        const kv = line.match(/^(\s*-?\s*[^:]+:)(.*)$/);
        node = kv ? (
          <>
            <span className={CLS.metaKey}>{kv[1]}</span>
            <span className={CLS.metaValue}>{kv[2]}</span>
          </>
        ) : (
          <span className={CLS.metaValue}>{line}</span>
        );
      }
    } else if (inBlockComment) {
      const end = line.indexOf('-]');
      if (end === -1) {
        node = <span className={CLS.comment}>{line}</span>;
      } else {
        inBlockComment = false;
        node = (
          <>
            <span className={CLS.comment}>{line.slice(0, end + 2)}</span>
            {highlightStepLine(line.slice(end + 2), key)}
          </>
        );
      }
    } else if (/^\s*>>/.test(line)) {
      const kv = line.match(/^(\s*>>\s*[^:]*:)(.*)$/);
      node = kv ? (
        <>
          <span className={CLS.metaKey}>{kv[1]}</span>
          <span className={CLS.metaValue}>{kv[2]}</span>
        </>
      ) : (
        <span className={CLS.metaKey}>{line}</span>
      );
    } else if (/^\s*=/.test(line)) {
      node = <span className={CLS.section}>{line}</span>;
    } else if (/^\s*>/.test(line)) {
      node = <span className={CLS.note}>{line}</span>;
    } else {
      const open = line.lastIndexOf('[-');
      if (open !== -1 && line.indexOf('-]', open) === -1) {
        inBlockComment = true;
        node = (
          <>
            {highlightStepLine(line.slice(0, open), key)}
            <span className={CLS.comment}>{line.slice(open)}</span>
          </>
        );
      } else {
        node = highlightStepLine(line, key);
      }
    }

    out.push(
      <React.Fragment key={key}>
        {node}
        {idx < lines.length - 1 ? '\n' : ''}
      </React.Fragment>
    );
  });

  return out;
}
