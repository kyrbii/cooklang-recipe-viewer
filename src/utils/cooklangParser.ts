import type {
  CookCookware,
  CookIngredient,
  CookMetadata,
  CookSection,
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

  const allIngredientsMap = new Map<string, CookIngredient>();
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

      // Aggregate ingredients (optional amounts separated according to spec)
      ingredients.forEach((ing) => {
        const key = `${ing.name.toLowerCase()}|${(ing.units || '').toLowerCase()}|${ing.optional ? 'opt' : 'req'}`;
        if (!allIngredientsMap.has(key)) {
          allIngredientsMap.set(key, { ...ing });
        } else {
          const existing = allIngredientsMap.get(key)!;
          const exQty = parseQuantity(existing.quantity);
          const curQty = parseQuantity(ing.quantity);
          if (exQty !== null && curQty !== null) {
            existing.quantity = exQty + curQty;
          }
        }
      });

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
    ingredients: Array.from(allIngredientsMap.values()),
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

/**
 * Helper to extract numeric or text quantity and unit from Cook CLI AST objects
 */
function extractCookCliQuantity(rawQty: unknown): { quantity?: string | number; units?: string } {
  if (!rawQty || typeof rawQty !== 'object') {
    if (typeof rawQty === 'number' || typeof rawQty === 'string') {
      return { quantity: rawQty };
    }
    return {};
  }

  const obj = rawQty as Record<string, unknown>;
  const units = typeof obj.unit === 'string' && obj.unit.trim() !== '' ? obj.unit.trim() : undefined;
  let quantity: string | number | undefined;

  if (typeof obj.value === 'number' || typeof obj.value === 'string') {
    quantity = obj.value;
  } else if (obj.value && typeof obj.value === 'object') {
    const valObj = obj.value as Record<string, unknown>;
    if (valObj.type === 'number' && valObj.value && typeof valObj.value === 'object') {
      const inner = valObj.value as Record<string, unknown>;
      if (typeof inner.value === 'number' || typeof inner.value === 'string') {
        quantity = inner.value;
      }
    } else if (valObj.type === 'text' && (typeof valObj.value === 'string' || typeof valObj.value === 'number')) {
      quantity = valObj.value;
    } else if (valObj.value !== undefined) {
      quantity = valObj.value as string | number;
    }
  }

  return { quantity, units };
}

/**
 * Normalizes Cook CLI Server API response
 * The server may return:
 * 1) Parsed AST JSON ({ recipe: { metadata: {}, sections: [...], ingredients: [...] } })
 * 2) Direct AST JSON ({ metadata: {}, steps: [...], ... })
 * 3) Plain Cook text
 */
export function normalizeServerRecipe(
  data: unknown,
  recipePath: string
): Recipe {
  if (typeof data === 'string') {
    return parseCooklangText(data, recipePath);
  }

  if (data && typeof data === 'object') {
    const raw = data as Record<string, unknown>;

    // Case 1: Cook CLI official AST response ({ recipe: { metadata: ..., sections: ... }, image: ... })
    const root = (raw.recipe && typeof raw.recipe === 'object')
      ? (raw.recipe as Record<string, unknown>)
      : raw;

    if (Array.isArray(root.sections) || Array.isArray(root.ingredients) || Array.isArray(root.cookware)) {
      const rawMeta = (root.metadata && typeof root.metadata === 'object' && 'map' in (root.metadata as Record<string, unknown>))
        ? ((root.metadata as Record<string, unknown>).map as Record<string, unknown>)
        : ((root.metadata as Record<string, unknown>) || {});

      // Standardize metadata keys
      const metadata: CookMetadata = {};
      for (const [k, v] of Object.entries(rawMeta)) {
        metadata[k.toLowerCase()] = v as string | number | string[];
      }
      if (metadata['time required'] && !metadata.time) {
        metadata.time = String(metadata['time required']);
      }
      if (metadata['cook time'] && !metadata.cook_time) {
        metadata.cook_time = String(metadata['cook time']);
      }
      if (metadata['prep time'] && !metadata.prep_time) {
        metadata.prep_time = String(metadata['prep time']);
      }
      if (typeof metadata.tags === 'string') {
        metadata.tags = (metadata.tags as string).split(',').map((t) => t.trim()).filter(Boolean);
      }

      const filename = recipePath.split('/').pop()?.replace(/\.cook$/i, '') || 'Recipe';
      const name = (metadata.title as string) || (root.name as string) || filename.replace(/[-_]/g, ' ');

      // Parse ingredients
      const rawIngredients = Array.isArray(root.ingredients) ? root.ingredients : [];
      const ingredients: CookIngredient[] = rawIngredients.map((ing) => {
        const item = ing as Record<string, unknown>;
        const { quantity, units } = extractCookCliQuantity(item.quantity);
        const rawName = String(item.name || 'Ingredient');
        const isOptional = Boolean(
          rawName.startsWith('?') ||
          item.optional ||
          item.is_optional ||
          item.modifier === 'optional' ||
          (Array.isArray(item.modifiers) && item.modifiers.includes('optional'))
        );
        const name = rawName.replace(/^\?+\s*/, '').trim();
        return {
          name,
          quantity,
          units,
          optional: isOptional || undefined
        };
      });

      // Parse cookware
      const rawCookware = Array.isArray(root.cookware) ? root.cookware : [];
      const cookware: CookCookware[] = rawCookware.map((cw) => {
        const item = cw as Record<string, unknown>;
        const { quantity } = extractCookCliQuantity(item.quantity);
        const rawName = String(item.name || 'Cookware');
        const isOptional = Boolean(
          rawName.startsWith('?') ||
          item.optional ||
          item.is_optional ||
          item.modifier === 'optional' ||
          (Array.isArray(item.modifiers) && item.modifiers.includes('optional'))
        );
        const name = rawName.replace(/^\?+\s*/, '').trim();
        return {
          name,
          quantity,
          optional: isOptional || undefined
        };
      });

      // Parse timers
      const rawTimers = Array.isArray(root.timers) ? root.timers : [];
      const timers: CookTimer[] = rawTimers.map((t, idx) => {
        const item = t as Record<string, unknown>;
        const { quantity, units } = extractCookCliQuantity(item.quantity);
        const u = units || 'minutes';
        const num = parseQuantity(quantity) ?? 5;
        const totalSeconds = unitToSeconds(u, num);
        return {
          name: item.name ? String(item.name) : `Timer ${idx + 1}`,
          quantity: quantity || 5,
          units: u,
          totalSeconds
        };
      });

      // Parse sections / steps
      const steps: CookStep[] = [];
      const cookSections: CookSection[] = [];
      const notes: string[] = [];
      const sections = Array.isArray(root.sections) ? root.sections : [];

      let globalStepNumber = 1;
      for (const section of sections) {
        const secObj = section as Record<string, unknown>;
        const secName = typeof secObj.name === 'string' && secObj.name.trim() ? secObj.name.trim() : undefined;
        const content = Array.isArray(secObj.content) ? secObj.content : [];
        const sectionSteps: CookStep[] = [];

        for (const item of content) {
          const itemObj = item as Record<string, unknown>;
          if (itemObj.type === 'step' && itemObj.value && typeof itemObj.value === 'object') {
            const stepVal = itemObj.value as Record<string, unknown>;
            const stepNumber = globalStepNumber++;
            const stepItems: StepItem[] = [];
            const stepIngredients: CookIngredient[] = [];
            const stepCookware: CookCookware[] = [];
            const stepTimers: CookTimer[] = [];

            if (Array.isArray(stepVal.items)) {
              for (const node of stepVal.items) {
                const nodeObj = node as Record<string, unknown>;
                const nodeType = nodeObj.type;

                if (nodeType === 'text') {
                  stepItems.push({ type: 'text', value: String(nodeObj.value || '') });
                } else if (nodeType === 'ingredient') {
                  const idx = typeof nodeObj.index === 'number' ? nodeObj.index : -1;
                  const ing = idx >= 0 ? ingredients[idx] : undefined;
                  if (ing) {
                    stepItems.push({ type: 'ingredient', ...ing });
                    stepIngredients.push(ing);
                  } else if (nodeObj.name) {
                    const rawName = String(nodeObj.name);
                    const isOpt = Boolean(rawName.startsWith('?') || nodeObj.optional);
                    const cleanName = rawName.replace(/^\?+\s*/, '').trim();
                    const standaloneIng: CookIngredient = {
                      name: cleanName,
                      quantity: extractCookCliQuantity(nodeObj.quantity).quantity,
                      units: extractCookCliQuantity(nodeObj.quantity).units,
                      optional: isOpt || undefined
                    };
                    stepItems.push({ type: 'ingredient', ...standaloneIng });
                    stepIngredients.push(standaloneIng);
                  }
                } else if (nodeType === 'cookware') {
                  const idx = typeof nodeObj.index === 'number' ? nodeObj.index : -1;
                  const cw = idx >= 0 ? cookware[idx] : undefined;
                  if (cw) {
                    stepItems.push({ type: 'cookware', ...cw });
                    stepCookware.push(cw);
                  } else if (nodeObj.name) {
                    const rawName = String(nodeObj.name);
                    const isOpt = Boolean(rawName.startsWith('?') || nodeObj.optional);
                    const cleanName = rawName.replace(/^\?+\s*/, '').trim();
                    const standaloneCw: CookCookware = {
                      name: cleanName,
                      quantity: extractCookCliQuantity(nodeObj.quantity).quantity,
                      optional: isOpt || undefined
                    };
                    stepItems.push({ type: 'cookware', ...standaloneCw });
                    stepCookware.push(standaloneCw);
                  }
                } else if (nodeType === 'timer' && typeof nodeObj.index === 'number') {
                  const tm = timers[nodeObj.index];
                  if (tm) {
                    stepItems.push({ type: 'timer', ...tm });
                    stepTimers.push(tm);
                  }
                }
              }
            }

            const step: CookStep = {
              stepNumber,
              section: secName,
              items: stepItems,
              rawText: '',
              ingredients: stepIngredients,
              cookware: stepCookware,
              timers: stepTimers
            };
            steps.push(step);
            sectionSteps.push(step);
          } else if (itemObj.type === 'note' || itemObj.type === 'text') {
            const noteVal = typeof itemObj.value === 'string'
              ? itemObj.value
              : typeof (itemObj.value as Record<string, unknown>)?.text === 'string'
              ? (itemObj.value as Record<string, unknown>).text as string
              : '';
            if (noteVal && noteVal.trim()) {
              notes.push(noteVal.trim());
            }
          }
        }

        if (sectionSteps.length > 0 && (secName || sections.length > 1)) {
          cookSections.push({
            name: secName,
            steps: sectionSteps
          });
        }
      }

      if (Array.isArray(root.notes)) {
        root.notes.forEach((n) => {
          if (typeof n === 'string' && n.trim()) notes.push(n.trim());
        });
      }

      const metaNotes = metadata.notes ?? metadata.note ?? metadata.tips ?? metadata.tip;
      if (metaNotes) {
        if (Array.isArray(metaNotes)) {
          metaNotes.forEach((n) => {
            const str = String(n).trim();
            if (str && !notes.includes(str)) notes.push(str);
          });
        } else if (typeof metaNotes === 'string' && metaNotes.trim() && !notes.includes(metaNotes.trim())) {
          notes.push(metaNotes.trim());
        }
      }

      const folder = recipePath.includes('/') ? recipePath.split('/').slice(0, -1).join('/') : undefined;

      const image =
        (raw.image as string) ||
        (root.image as string) ||
        (metadata.image as string) ||
        (metadata.picture as string) ||
        (metadata.photo as string);

      return {
        id: recipePath,
        path: recipePath,
        name,
        folder,
        metadata,
        steps,
        sections: cookSections.length > 0 ? cookSections : undefined,
        ingredients,
        cookware,
        notes: notes.length > 0 ? notes : undefined,
        image,
        cachedAt: Date.now()
      };
    }

    // Case 2: Legacy or simplified steps array
    if (Array.isArray(raw.steps)) {
      const metadata = (raw.metadata as CookMetadata) || {};
      const filename = recipePath.split('/').pop()?.replace(/\.cook$/i, '') || 'Recipe';
      const name = (metadata.title as string) || (raw.name as string) || filename.replace(/[-_]/g, ' ');

      const steps: CookStep[] = [];
      const notes: string[] = [];
      const allIngredients: CookIngredient[] = [];
      const allCookware: CookCookware[] = [];

      raw.steps.forEach((stepRaw, idx) => {
        const stepNumber = idx + 1;
        const items: StepItem[] = [];
        const stepIngredients: CookIngredient[] = [];
        const stepCookware: CookCookware[] = [];
        const stepTimers: CookTimer[] = [];
        let rawText = '';

        if (Array.isArray(stepRaw)) {
          stepRaw.forEach((node) => {
            if (typeof node === 'string') {
              items.push({ type: 'text', value: node });
              rawText += node;
            } else if (node && typeof node === 'object') {
              const itemType = node.type || 'text';
              if (itemType === 'text') {
                const val = String(node.value || '');
                items.push({ type: 'text', value: val });
                rawText += val;
              } else if (itemType === 'ingredient') {
                const rawName = String(node.name || '');
                const isOptional = Boolean(
                  rawName.startsWith('?') ||
                  (node as Record<string, unknown>).optional ||
                  (node as Record<string, unknown>).is_optional
                );
                const name = rawName.replace(/^\?+\s*/, '').trim();
                const ing: CookIngredient = {
                  name,
                  quantity: node.quantity as number | string | undefined,
                  units: (node.units as string) || undefined,
                  optional: isOptional || undefined
                };
                items.push({ type: 'ingredient', ...ing });
                stepIngredients.push(ing);
                allIngredients.push(ing);
                rawText += ing.name;
              } else if (itemType === 'cookware') {
                const rawName = String(node.name || '');
                const isOptional = Boolean(
                  rawName.startsWith('?') ||
                  (node as Record<string, unknown>).optional ||
                  (node as Record<string, unknown>).is_optional
                );
                const name = rawName.replace(/^\?+\s*/, '').trim();
                const cw: CookCookware = {
                  name,
                  quantity: node.quantity as number | string | undefined,
                  optional: isOptional || undefined
                };
                items.push({ type: 'cookware', ...cw });
                stepCookware.push(cw);
                allCookware.push(cw);
                rawText += cw.name;
              } else if (itemType === 'timer') {
                const qty = (node.quantity as number | string) || 1;
                const units = String(node.units || 'minutes');
                const numQty = parseQuantity(qty) ?? 1;
                const tm: CookTimer = {
                  name: node.name ? String(node.name) : 'Timer',
                  quantity: qty,
                  units,
                  totalSeconds: unitToSeconds(units, numQty)
                };
                items.push({ type: 'timer', ...tm });
                stepTimers.push(tm);
                rawText += `${tm.name} (${qty} ${units})`;
              }
            }
          });
        } else if (typeof stepRaw === 'string') {
          const parsed = parseStepText(stepRaw);
          items.push(...parsed.items);
          stepIngredients.push(...parsed.ingredients);
          stepCookware.push(...parsed.cookware);
          stepTimers.push(...parsed.timers);
          rawText = stepRaw;
        }

        steps.push({
          stepNumber,
          items,
          rawText,
          ingredients: stepIngredients,
          cookware: stepCookware,
          timers: stepTimers
        });
      });

      if (Array.isArray(raw.notes)) {
        raw.notes.forEach((n) => {
          if (typeof n === 'string' && n.trim()) notes.push(n.trim());
        });
      }

      const metaNotes = metadata.notes ?? metadata.note ?? metadata.tips ?? metadata.tip;
      if (metaNotes) {
        if (Array.isArray(metaNotes)) {
          metaNotes.forEach((n) => {
            const str = String(n).trim();
            if (str && !notes.includes(str)) notes.push(str);
          });
        } else if (typeof metaNotes === 'string' && metaNotes.trim() && !notes.includes(metaNotes.trim())) {
          notes.push(metaNotes.trim());
        }
      }

      const ingredients = Array.isArray(raw.ingredients)
        ? (raw.ingredients as CookIngredient[])
        : allIngredients;
      const cookware = Array.isArray(raw.cookware)
        ? (raw.cookware as CookCookware[])
        : allCookware;

      const folder = recipePath.includes('/')
        ? recipePath.split('/').slice(0, -1).join('/')
        : undefined;

      return {
        id: recipePath,
        path: recipePath,
        name,
        folder,
        metadata,
        steps,
        ingredients,
        cookware,
        notes: notes.length > 0 ? notes : undefined,
        image: (metadata.image as string) || (metadata.picture as string) || (metadata.photo as string) || (raw.image as string),
        cachedAt: Date.now()
      };
    }
  }

  // Fallback string representation
  return parseCooklangText(String(data), recipePath);
}
