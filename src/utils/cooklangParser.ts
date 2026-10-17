import type {
  CookCookware,
  CookIngredient,
  CookMetadata,
  CookStep,
  CookTimer,
  Recipe,
  StepItem
} from '../types/cook';

/**
 * Converts quantity representation (number, string fraction, decimal) to a number
 */
export function parseQuantity(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return isNaN(raw) ? null : raw;
  }
  if (typeof raw !== 'string') return null;

  const str = raw.trim();
  if (!str) return null;

  // Handle mixed fractions like "1 1/2"
  if (str.includes(' ') && str.includes('/')) {
    const parts = str.split(' ');
    if (parts.length === 2) {
      const whole = parseFloat(parts[0]);
      const [num, den] = parts[1].split('/').map(Number);
      if (!isNaN(whole) && !isNaN(num) && !isNaN(den) && den !== 0) {
        return whole + num / den;
      }
    }
  }

  // Handle simple fractions like "1/2" or "3/4"
  if (str.includes('/')) {
    const [num, den] = str.split('/').map(Number);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den;
    }
  }

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/**
 * Formats a scaled number into a readable kitchen quantity (fractions or clean decimals)
 */
export function formatQuantity(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num)) return '';
  if (num === 0) return '0';

  // Common fraction checks with small epsilon
  const eps = 0.02;
  const whole = Math.floor(num);
  const frac = num - whole;

  const fractionMap: [number, string][] = [
    [1 / 8, '1/8'],
    [1 / 4, '1/4'],
    [1 / 3, '1/3'],
    [3 / 8, '3/8'],
    [1 / 2, '1/2'],
    [5 / 8, '5/8'],
    [2 / 3, '2/3'],
    [3 / 4, '3/4'],
    [7 / 8, '7/8']
  ];

  for (const [val, label] of fractionMap) {
    if (Math.abs(frac - val) < eps) {
      return whole > 0 ? `${whole} ${label}` : label;
    }
  }

  if (Math.abs(frac) < eps) {
    return whole.toString();
  }

  if (Math.abs(frac - 1) < eps) {
    return (whole + 1).toString();
  }

  // Otherwise format with max 2 decimals without trailing zeros
  const formatted = num.toFixed(2).replace(/\.?0+$/, '');
  return formatted;
}

/**
 * Scale an ingredient quantity given a ratio
 */
export function scaleQuantity(
  rawQty: number | string | undefined,
  ratio: number
): string {
  if (rawQty === undefined || rawQty === null || rawQty === '') return '';
  const num = parseQuantity(rawQty);
  if (num === null) return String(rawQty);
  const scaled = num * ratio;
  return formatQuantity(scaled);
}

/**
 * Fasst gleiche Zutaten (Name + Einheit) zu einer Zeile zusammen und addiert die Mengen.
 * Fehlt eine Menge, wird die andere übernommen. Unterschiedliche Einheiten bleiben getrennt.
 */
export function aggregateIngredients(list: CookIngredient[]): CookIngredient[] {
  const sourcesOf = (ing: CookIngredient) =>
    ing.sources ?? (parseQuantity(ing.quantity) !== null ? [{ quantity: ing.quantity, units: ing.units }] : []);

  const map = new Map<string, CookIngredient>();
  for (const ing of list) {
    const name = ing.name.replace(/^\?+\s*/, '').trim();
    const unit = (ing.units || '').trim().toLowerCase();
    const key = `${name.toLowerCase()}|${unit}|${ing.optional ? 'opt' : 'req'}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...ing, name });
      continue;
    }
    const added = parseQuantity(ing.quantity);
    if (added === null) continue;
    existing.sources = [...sourcesOf(existing), ...sourcesOf(ing)];
    const current = parseQuantity(existing.quantity);
    existing.quantity = current === null ? added : current + added;
  }
  return Array.from(map.values());
}

/**
 * Gruppiert gleiche Zutaten nebeneinander (auch bei unterschiedlichen Mengen oder Einheiten).
 * Gruppen mit einer Menge kommen nach der größten Menge absteigend, reine Zutaten ohne Menge ans Ende.
 * Innerhalb einer Gruppe: größte Menge zuerst, ohne Menge ganz unten.
 */
export function sortIngredientsByQuantity(list: CookIngredient[]): CookIngredient[] {
  const nameKey = (ing: CookIngredient) => ing.name.replace(/^\?+\s*/, '').trim().toLowerCase();

  const groupBest = new Map<string, number | null>();
  const groupFirst = new Map<string, number>();
  list.forEach((ing, idx) => {
    const key = nameKey(ing);
    if (!groupFirst.has(key)) groupFirst.set(key, idx);
    const qty = parseQuantity(ing.quantity);
    const current = groupBest.get(key) ?? null;
    groupBest.set(key, current === null ? qty : qty === null ? current : Math.max(current, qty));
  });

  return list
    .map((ing, idx) => ({ ing, idx, key: nameKey(ing), qty: parseQuantity(ing.quantity) }))
    .sort((a, b) => {
      if (a.key !== b.key) {
        const bestA = groupBest.get(a.key) ?? null;
        const bestB = groupBest.get(b.key) ?? null;
        const firstDiff = groupFirst.get(a.key)! - groupFirst.get(b.key)!;
        if (bestA === null && bestB === null) return firstDiff;
        if (bestA === null) return 1;
        if (bestB === null) return -1;
        return bestB - bestA || firstDiff;
      }
      if (a.qty === null && b.qty === null) return a.idx - b.idx;
      if (a.qty === null) return 1;
      if (b.qty === null) return -1;
      return b.qty - a.qty || a.idx - b.idx;
    })
    .map((x) => x.ing);
}

/**
 * Parse timer unit to seconds
 */
export function unitToSeconds(unitStr: string, qty: number): number {
  const u = unitStr.toLowerCase().trim();
  if (u.startsWith('s')) {
    return Math.round(qty);
  }
  if (u.startsWith('h')) {
    return Math.round(qty * 3600);
  }
  // Default to minutes
  return Math.round(qty * 60);
}

/**
 * Minimal YAML front matter reader (key: value, inline [a, b] lists and "- item" lists)
 */
function parseFrontMatter(yaml: string, metadata: CookMetadata): void {
  const stripQuotes = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  let listKey: string | null = null;

  for (const rawLine of yaml.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;

    const listItem = rawLine.match(/^\s+-\s+(.*)$/) || rawLine.match(/^-\s+(.*)$/);
    if (listItem && listKey) {
      const current = Array.isArray(metadata[listKey]) ? (metadata[listKey] as string[]) : [];
      metadata[listKey] = [...current, stripQuotes(listItem[1])];
      continue;
    }

    const kv = rawLine.match(/^([^:#][^:]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const value = kv[2].trim();

    if (value === '') {
      listKey = key;
      continue;
    }
    listKey = null;

    if (value.startsWith('[') && value.endsWith(']')) {
      metadata[key] = value
        .slice(1, -1)
        .split(',')
        .map(stripQuotes)
        .filter(Boolean);
    } else if ((key === 'tags' || key === 'tag') && value.includes(',')) {
      metadata.tags = value.split(',').map(stripQuotes).filter(Boolean);
    } else {
      metadata[key] = stripQuotes(value);
    }
  }

  if (metadata.tag && !metadata.tags) {
    metadata.tags = metadata.tag as string[] | string;
  }
  if (metadata['prep time'] && !metadata.prep_time) metadata.prep_time = String(metadata['prep time']);
  if (metadata['cook time'] && !metadata.cook_time) metadata.cook_time = String(metadata['cook time']);
  if (metadata['time required'] && !metadata.time) metadata.time = String(metadata['time required']);
}

/**
 * Parse a raw .cook formatted file
 */
export function parseCooklangText(content: string, path: string): Recipe {
  const metadata: CookMetadata = {};
  let body = content.replace(/^\uFEFF/, '');

  // YAML front matter (--- ... ---)
  const frontMatter = body.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (frontMatter) {
    parseFrontMatter(frontMatter[1], metadata);
    body = body.slice(frontMatter[0].length);
  }

  const lines = body.split(/\r?\n/);
  const stepsRaw: Array<{ text: string; section?: string }> = [];
  const notesRaw: string[] = [];
  let paragraph: string[] = [];
  let currentNote: string[] = [];
  let currentSection: string | undefined = undefined;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      stepsRaw.push({
        text: paragraph.join(' '),
        section: currentSection
      });
      paragraph = [];
    }
  };

  const flushNote = () => {
    if (currentNote.length > 0) {
      notesRaw.push(currentNote.join(' '));
      currentNote = [];
    }
  };

  let inBlockComment = false;

  for (const rawLine of lines) {
    let line = rawLine;

    // Block comments [- ... -]
    if (inBlockComment) {
      const end = line.indexOf('-]');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    line = line.replace(/\[-[\s\S]*?-\]/g, '');
    const openIdx = line.indexOf('[-');
    if (openIdx !== -1) {
      line = line.slice(0, openIdx);
      inBlockComment = true;
    }

    // Empty line separates steps (paragraphs in cooklang)
    if (rawLine.trim() === '') {
      flushParagraph();
      flushNote();
      continue;
    }

    // Line comments (-- until end of line)
    const commentIdx = line.indexOf('--');
    if (commentIdx !== -1) {
      line = line.slice(0, commentIdx);
    }
    line = line.trim();
    if (!line) continue;

    // Legacy metadata lines: >> key: value
    if (line.startsWith('>>')) {
      const metaLine = line.slice(2).trim();
      const colonIdx = metaLine.indexOf(':');
      if (colonIdx > -1) {
        const key = metaLine.slice(0, colonIdx).trim().toLowerCase();
        const value = metaLine.slice(colonIdx + 1).trim();
        if (key === 'tags' || key === 'tag') {
          metadata.tags = value.split(',').map((t) => t.trim()).filter(Boolean);
        } else {
          metadata[key] = value;
        }
      }
      continue;
    }

    // Cooklang notes starting with >
    if (line.startsWith('>')) {
      flushParagraph();
      const noteContent = line.replace(/^>+\s*/, '').trim();
      if (noteContent) {
        currentNote.push(noteContent);
      }
      continue;
    }

    // Section headers (= Dough =, == Dough ==, = Dough)
    if (line.startsWith('=')) {
      flushParagraph();
      flushNote();

      let secName = '';
      let remainingText = '';

      const withClosingEquals = line.match(/^=+\s*([^=]*?)\s*=+(.*)$/);
      if (withClosingEquals) {
        secName = withClosingEquals[1].trim();
        remainingText = withClosingEquals[2].trim();
      } else {
        const withoutClosing = line.match(/^=+\s*(.*)$/);
        secName = withoutClosing ? withoutClosing[1].trim() : '';
      }

      currentSection = secName || undefined;

      if (remainingText) {
        paragraph.push(remainingText);
      }
      continue;
    }

    flushNote();
    paragraph.push(line);
  }
  flushParagraph();
  flushNote();

  // Also collect any notes from metadata if present
  const metaNotes = metadata.notes ?? metadata.note ?? metadata.tips ?? metadata.tip;
  if (metaNotes) {
    if (Array.isArray(metaNotes)) {
      metaNotes.forEach((n) => {
        const str = String(n).trim();
        if (str && !notesRaw.includes(str)) notesRaw.push(str);
      });
    } else if (typeof metaNotes === 'string' && metaNotes.trim() && !notesRaw.includes(metaNotes.trim())) {
      notesRaw.push(metaNotes.trim());
    }
  }

  // Derive recipe name from metadata or path
  const filename = path.split('/').pop()?.replace(/\.cook$/i, '') || 'Recipe';
  const name = (metadata.title as string) || filename.replace(/[-_]/g, ' ');

  const allIngredients: CookIngredient[] = [];
  const allCookwareMap = new Map<string, CookCookware>();
  const steps: CookStep[] = [];
  const sectionsMap = new Map<string | undefined, CookStep[]>();
  const sectionOrder: Array<string | undefined> = [];

  stepsRaw.forEach((rawStep, idx) => {
    const { items, ingredients, cookware, timers } = parseStepText(rawStep.text);
    if (items.length > 0) {
      const step: CookStep = {
        stepNumber: idx + 1,
        section: rawStep.section,
        items,
        rawText: rawStep.text,
        ingredients,
        cookware,
        timers
      };
      steps.push(step);

      if (!sectionsMap.has(rawStep.section)) {
        sectionsMap.set(rawStep.section, []);
        sectionOrder.push(rawStep.section);
      }
      sectionsMap.get(rawStep.section)!.push(step);

      allIngredients.push(...ingredients);

      // Aggregate cookware
      cookware.forEach((cw) => {
        const key = `${cw.name.toLowerCase()}|${cw.optional ? 'opt' : 'req'}`;
        if (!allCookwareMap.has(key)) {
          allCookwareMap.set(key, { ...cw });
        }
      });
    }
  });

  const hasSections = steps.some((s) => Boolean(s.section));
  const sections = hasSections
    ? sectionOrder.map((secName) => ({
        name: secName,
        steps: sectionsMap.get(secName) || []
      }))
    : undefined;

  const folder = path.includes('/') ? path.split('/').slice(0, -1).join('/') : undefined;

  return {
    id: path,
    path,
    name,
    folder,
    metadata,
    steps,
    sections,
    ingredients: aggregateIngredients(allIngredients),
    cookware: Array.from(allCookwareMap.values()),
    notes: notesRaw.length > 0 ? notesRaw : undefined,
    rawCook: content,
    image: (metadata.image as string) || (metadata.picture as string) || (metadata.photo as string),
    cachedAt: Date.now()
  };
}

/**
 * Tokenize a single Cooklang step string into structured items
 */
export function parseStepText(text: string): {
  items: StepItem[];
  ingredients: CookIngredient[];
  cookware: CookCookware[];
  timers: CookTimer[];
} {
  const items: StepItem[] = [];
  const ingredients: CookIngredient[] = [];
  const cookware: CookCookware[] = [];
  const timers: CookTimer[] = [];

  let i = 0;
  let currentText = '';

  const flushText = () => {
    if (currentText.length > 0) {
      items.push({ type: 'text', value: currentText });
      currentText = '';
    }
  };

  while (i < text.length) {
    const char = text[i];

    // Ingredient @ or @?
    if (char === '@') {
      flushText();
      const parsed = parseEntity(text, i);
      i = parsed.nextIndex;
      const ing: CookIngredient = {
        name: parsed.name,
        quantity: parsed.quantity,
        units: parsed.units,
        optional: parsed.optional
      };
      ingredients.push(ing);
      items.push({
        type: 'ingredient',
        name: ing.name,
        quantity: ing.quantity,
        units: ing.units,
        optional: ing.optional
      });
      continue;
    }

    // Cookware # or #?
    if (char === '#') {
      flushText();
      const parsed = parseEntity(text, i);
      i = parsed.nextIndex;
      const cw: CookCookware = {
        name: parsed.name,
        quantity: parsed.quantity,
        optional: parsed.optional
      };
      cookware.push(cw);
      items.push({
        type: 'cookware',
        name: cw.name,
        quantity: cw.quantity,
        optional: cw.optional
      });
      continue;
    }

    // Timer ~
    if (char === '~') {
      flushText();
      const parsedTimer = parseTimerEntity(text, i);
      i = parsedTimer.nextIndex;
      timers.push(parsedTimer.timer);
      items.push({
        type: 'timer',
        name: parsedTimer.timer.name,
        quantity: parsedTimer.timer.quantity,
        units: parsedTimer.timer.units,
        totalSeconds: parsedTimer.timer.totalSeconds
      });
      continue;
    }

    currentText += char;
    i++;
  }

  flushText();

  return { items, ingredients, cookware, timers };
}

/**
 * Parses `@name{qty%units}`, `@?name{qty%units}`, `#name{qty}`, `#?name{qty}` or single word `@name`, `@?name`
 */
function parseEntity(
  text: string,
  startIndex: number
): {
  name: string;
  quantity?: string | number;
  units?: string;
  optional?: boolean;
  nextIndex: number;
} {
  const isOptional =
    text[startIndex + 1] === '?' &&
    startIndex + 2 < text.length &&
    !/\s/.test(text[startIndex + 2]);

  const nameStartIndex = isOptional ? startIndex + 2 : startIndex + 1;

  let braceIdx = -1;
  for (let j = nameStartIndex; j < text.length; j++) {
    const c = text[j];
    if (c === '{') {
      braceIdx = j;
      break;
    }
    if (
      c === '\n' ||
      c === '\r' ||
      c === '@' ||
      c === '#' ||
      c === '~' ||
      c === ',' ||
      (c === '.' && text[j + 1] !== '/') ||
      c === ';' ||
      c === '!' ||
      c === '?'
    ) {
      break;
    }
  }

  if (braceIdx !== -1) {
    let name = text.slice(nameStartIndex, braceIdx).trim();
    const closeIdx = text.indexOf('}', braceIdx + 1);
    const endBrace = closeIdx !== -1 ? closeIdx : text.length;
    const body = text.slice(braceIdx + 1, endBrace).trim();
    const nextIndex = closeIdx !== -1 ? closeIdx + 1 : endBrace;

    let quantity: string | number | undefined;
    let units: string | undefined;

    if (body.includes('%')) {
      const [q, u] = body.split('%');
      quantity = q.trim() || undefined;
      units = u.trim() || undefined;
    } else if (body.length > 0) {
      if (!name) {
        name = body;
      } else {
        quantity = body.trim();
      }
    }

    const rawName = name;
    const isOpt = Boolean(isOptional || rawName.startsWith('?'));
    const cleanName = rawName.replace(/^\?+\s*/, '').trim();

    return {
      name: cleanName,
      quantity,
      units,
      optional: isOpt || undefined,
      nextIndex
    };
  }

  // Single-word without braces (e.g. @salt, #pan, @Öl, @?chives)
  let j = nameStartIndex;
  while (j < text.length && /[\p{L}\p{N}_-]/u.test(text[j])) {
    j++;
  }

  const rawName = text.slice(nameStartIndex, j).trim();
  const isOpt = Boolean(isOptional || rawName.startsWith('?'));
  const cleanName = rawName.replace(/^\?+\s*/, '').trim();
  return {
    name: cleanName,
    quantity: undefined,
    units: undefined,
    optional: isOpt || undefined,
    nextIndex: j
  };
}

/**
 * Parses timer `~{20%minutes}` or `~simmer{15%min}`
 */
function parseTimerEntity(
  text: string,
  startIndex: number
): {
  timer: CookTimer;
  nextIndex: number;
} {
  let braceIdx = -1;
  for (let j = startIndex + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '{') {
      braceIdx = j;
      break;
    }
    if (
      c === '\n' ||
      c === '\r' ||
      c === '@' ||
      c === '#' ||
      c === '~' ||
      c === ',' ||
      c === '.' ||
      c === ';' ||
      c === '!' ||
      c === '?'
    ) {
      break;
    }
  }

  if (braceIdx !== -1) {
    const name = text.slice(startIndex + 1, braceIdx).trim();
    const closeIdx = text.indexOf('}', braceIdx + 1);
    const endBrace = closeIdx !== -1 ? closeIdx : text.length;
    const body = text.slice(braceIdx + 1, endBrace).trim();
    const nextIndex = closeIdx !== -1 ? closeIdx + 1 : endBrace;

    let quantity: number | string = 5;
    let units = 'minutes';

    if (body.includes('%')) {
      const [q, u] = body.split('%');
      quantity = q.trim() || '5';
      units = u.trim() || 'minutes';
    } else if (body.length > 0) {
      quantity = body.trim();
    }

    const numQty = parseQuantity(quantity) ?? 5;
    const totalSeconds = unitToSeconds(units, numQty);

    return {
      timer: {
        name: name || 'Timer',
        quantity,
        units,
        totalSeconds
      },
      nextIndex
    };
  }

  return {
    timer: {
      name: 'Timer',
      quantity: 5,
      units: 'minutes',
      totalSeconds: 300
    },
    nextIndex: startIndex + 1
  };
}
