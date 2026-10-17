import { Parser } from '@cooklang/cooklang';
import type {
  CookCookware,
  CookIngredient,
  CookMetadata,
  CookStep,
  CookTimer,
  Recipe,
  StepItem
} from '../types/cook';

/*
 * Cooklang text is parsed by the official parser (cooklang-rs, WASM build). This file turns its
 * result into the Recipe shape the app uses and holds the quantity helpers (scaling, formatting,
 * merging ingredients).
 */

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 1 / 4,
  '½': 1 / 2,
  '¾': 3 / 4,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8
};

const UNICODE_FRACTION_RE = /^(\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/;

/**
 * Converts a quantity (number, fraction, decimal with point or comma) to a number.
 * Ranges and free text give null.
 */
export function parseQuantity(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return isNaN(raw) ? null : raw;
  }
  if (typeof raw !== 'string') return null;

  const str = raw.trim();
  if (!str) return null;

  const unicode = str.match(UNICODE_FRACTION_RE);
  if (unicode) {
    return Number(unicode[1] ?? 0) + UNICODE_FRACTIONS[unicode[2]];
  }

  // Mixed fractions like "1 1/2"
  const mixed = str.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const den = Number(mixed[3]);
    return den === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / den;
  }

  // Simple fractions like "1/2" or "3/4"
  const fraction = str.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const den = Number(fraction[2]);
    return den === 0 ? null : Number(fraction[1]) / den;
  }

  // Decimals, "1.5" as well as "1,5"
  if (/^\d+([.,]\d+)?$/.test(str)) {
    return Number(str.replace(',', '.'));
  }

  return null;
}

/** The number a text starts with, "6 portions" gives 6. For servings, which may carry a unit. */
export function parseLeadingNumber(raw: unknown): number | null {
  const whole = parseQuantity(raw);
  if (whole !== null) return whole;
  if (typeof raw !== 'string') return null;
  const lead = raw.trim().match(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)/);
  return lead ? parseQuantity(lead[1]) : null;
}

/** Both ends of a range such as "1-2" or "200 – 250", null for everything else */
export function parseQuantityRange(raw: unknown): [number, number] | null {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (!match) return null;
  const start = parseQuantity(match[1]);
  const end = parseQuantity(match[2]);
  return start === null || end === null ? null : [start, end];
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
 * Scale an ingredient quantity given a ratio. Ranges scale at both ends, free text stays as
 * written, and a fixed quantity (`@salt{=1%tsp}`) is not scaled at all.
 */
export function scaleQuantity(
  rawQty: number | string | undefined,
  ratio: number,
  fixed = false
): string {
  if (rawQty === undefined || rawQty === null || rawQty === '') return '';
  const factor = fixed ? 1 : ratio;

  const range = parseQuantityRange(rawQty);
  if (range) {
    return `${formatQuantity(range[0] * factor)}-${formatQuantity(range[1] * factor)}`;
  }

  const num = parseQuantity(rawQty);
  if (num === null) return String(rawQty);
  return formatQuantity(num * factor);
}

/**
 * Multiplies a quantity by a factor without rounding it to kitchen fractions.
 * Ranges are multiplied at both ends, free text stays as written, a fixed quantity stays as is.
 */
export function multiplyQuantity(
  rawQty: number | string | undefined,
  factor: number,
  fixed = false
): number | string | undefined {
  if (rawQty === undefined || rawQty === '' || fixed || factor === 1) return rawQty;
  const range = parseQuantityRange(rawQty);
  if (range) return `${formatQuantity(range[0] * factor)}-${formatQuantity(range[1] * factor)}`;
  const num = parseQuantity(rawQty);
  return num === null ? rawQty : Math.round(num * factor * 1000) / 1000;
}

/** What follows the number in `servings: 6 portions`, undefined when there is only a number */
export function servingsUnit(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const rest = raw
    .trim()
    .replace(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)/, '')
    .trim();
  return rest || undefined;
}

/** The name to show for an ingredient or cookware: the alias if there is one */
export function displayName(item: { name: string; alias?: string }): string {
  return item.alias || item.name;
}

interface UnitInfo {
  family: 'mass' | 'volume' | 'spoon' | 'mass-imperial';
  /** How many base units one of this unit is (g, ml, teaspoons, oz) */
  factor: number;
}

const UNIT_TABLE: Array<[string[], UnitInfo]> = [
  [['mg'], { family: 'mass', factor: 0.001 }],
  [['g', 'gr', 'gramm', 'gram', 'grams'], { family: 'mass', factor: 1 }],
  [['kg', 'kilo', 'kilogramm', 'kilogram'], { family: 'mass', factor: 1000 }],
  [['ml', 'milliliter', 'millilitre'], { family: 'volume', factor: 1 }],
  [['cl', 'zentiliter'], { family: 'volume', factor: 10 }],
  [['dl', 'deziliter'], { family: 'volume', factor: 100 }],
  [['l', 'liter', 'litre', 'ltr'], { family: 'volume', factor: 1000 }],
  [['tsp', 'teaspoon', 'teaspoons', 'tl', 'teelöffel'], { family: 'spoon', factor: 1 }],
  [['tbsp', 'tablespoon', 'tablespoons', 'el', 'esslöffel'], { family: 'spoon', factor: 3 }],
  [['oz', 'ounce', 'ounces'], { family: 'mass-imperial', factor: 1 }],
  [['lb', 'lbs', 'pound', 'pounds'], { family: 'mass-imperial', factor: 16 }]
];

const normalizeUnit = (unit: string | undefined) => (unit || '').trim().toLowerCase().replace(/\.$/, '');

/** Weight and volume units that can be added up: g with kg, ml with l, TL with EL. Others give null. */
export function unitInfo(unit: string | undefined): UnitInfo | null {
  const u = normalizeUnit(unit);
  if (!u) return null;
  return UNIT_TABLE.find(([names]) => names.includes(u))?.[1] ?? null;
}

/** Writes a sum in base units back as quantity and unit, kg instead of 1500 g and so on */
function fromBaseUnits(family: UnitInfo['family'], base: number, smallestUnit: string): { quantity: number; units: string } {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  if (family === 'mass') {
    if (base >= 1000) return { quantity: round(base / 1000), units: 'kg' };
    if (base < 1) return { quantity: round(base * 1000), units: 'mg' };
    return { quantity: round(base), units: 'g' };
  }
  if (family === 'volume') {
    if (base >= 1000) return { quantity: round(base / 1000), units: 'l' };
    return { quantity: round(base), units: 'ml' };
  }
  if (family === 'mass-imperial') {
    if (base >= 16) return { quantity: round(base / 16), units: 'lb' };
    return { quantity: round(base), units: 'oz' };
  }
  // Spoons keep the smaller of the units that were used, so 1 EL and 1 TL make 4 TL
  const info = unitInfo(smallestUnit);
  return { quantity: round(base / (info?.factor ?? 1)), units: smallestUnit };
}

/**
 * Fasst gleiche Zutaten zu einer Zeile zusammen und addiert die Mengen.
 * Gleiche Einheiten werden addiert, Gewichte und Volumen auch über Einheiten hinweg (g und kg,
 * ml und l, TL und EL). Fehlt eine Menge, wird die andere übernommen.
 * Getrennt bleiben: andere Einheiten, optionale und feste Mengen, Bereiche und Freitext-Mengen,
 * neue Zutaten (`@+`) und Zutaten mit unterschiedlichem Alias. Zubereitungshinweise werden gesammelt.
 */
export function aggregateIngredients(list: CookIngredient[]): CookIngredient[] {
  const sourcesOf = (ing: CookIngredient) =>
    ing.sources ?? (parseQuantity(ing.quantity) !== null ? [{ quantity: ing.quantity, units: ing.units }] : []);

  interface Entry {
    ing: CookIngredient;
    alias: string;
    family?: UnitInfo['family'];
    base: number;
    unitsUsed: Set<string>;
    smallest?: { unit: string; factor: number };
    hasBase: boolean;
  }

  const entries: Entry[] = [];
  const byKey = new Map<string, Entry[]>();

  list.forEach((ing, idx) => {
    const name = ing.name.trim();
    const hasQuantity = ing.quantity !== undefined && ing.quantity !== '';
    const num = parseQuantity(ing.quantity);
    const addable = !hasQuantity || num !== null;
    const info = hasQuantity && num !== null ? unitInfo(ing.units) : null;
    const unitKey = info ? `fam:${info.family}` : normalizeUnit(ing.units);
    const alias = (ing.alias || '').trim().toLowerCase();
    const key = [
      name.toLowerCase(),
      unitKey,
      ing.optional ? 'opt' : 'req',
      ing.fixed ? 'fixed' : 'scaled',
      addable ? '' : `own${idx}`,
      ing.isNew ? `new${idx}` : ''
    ].join('|');

    const candidates = byKey.get(key) ?? [];
    // Same alias, or one side without alias: the same ingredient
    const existing = candidates.find((e) => e.alias === alias || !alias || !e.alias);

    const note = ing.note?.trim();
    if (!existing) {
      const entry: Entry = {
        ing: { ...ing, name },
        alias,
        family: info?.family,
        base: 0,
        unitsUsed: new Set(),
        hasBase: false
      };
      if (info && num !== null) {
        entry.base = num * info.factor;
        entry.hasBase = true;
        entry.unitsUsed.add(normalizeUnit(ing.units));
        entry.smallest = { unit: ing.units!.trim(), factor: info.factor };
      }
      entries.push(entry);
      byKey.set(key, [...candidates, entry]);
      return;
    }

    const target = existing.ing;
    if (!target.alias && ing.alias) target.alias = ing.alias;
    if (note && !(target.note ?? '').split('; ').includes(note)) {
      target.note = target.note ? `${target.note}; ${note}` : note;
    }
    if (num === null) return;
    target.sources = [...sourcesOf(target), ...sourcesOf(ing)];

    if (info) {
      if (!existing.hasBase) {
        // The first mention had no amount, the amount of this one is the start
        existing.hasBase = true;
        existing.base = num * info.factor;
        target.units = ing.units;
        target.quantity = num;
        existing.family = info.family;
        existing.smallest = { unit: ing.units!.trim(), factor: info.factor };
      } else {
        existing.base += num * info.factor;
        if (info.factor < (existing.smallest?.factor ?? Infinity)) {
          existing.smallest = { unit: ing.units!.trim(), factor: info.factor };
        }
        target.quantity = parseQuantity(target.quantity)! + num * (info.factor / (unitInfo(target.units)?.factor ?? info.factor));
      }
      existing.unitsUsed.add(normalizeUnit(ing.units));
    } else {
      const current = parseQuantity(target.quantity);
      target.quantity = current === null ? num : current + num;
    }
  });

  // Mixed units of one family are written in a fitting unit
  for (const e of entries) {
    if (e.family && e.unitsUsed.size > 1) {
      const out = fromBaseUnits(e.family, e.base, e.smallest?.unit ?? '');
      e.ing.quantity = out.quantity;
      e.ing.units = out.units;
    }
  }
  return entries.map((e) => e.ing);
}

/**
 * Gruppiert gleiche Zutaten nebeneinander (auch bei unterschiedlichen Mengen oder Einheiten).
 * Gruppen mit einer Menge kommen nach der größten Menge absteigend, reine Zutaten ohne Menge ans Ende.
 * Innerhalb einer Gruppe: größte Menge zuerst, ohne Menge ganz unten.
 */
export function sortIngredientsByQuantity(list: CookIngredient[]): CookIngredient[] {
  const nameKey = (ing: CookIngredient) => ing.name.trim().toLowerCase();
  // Ranges sort by their upper end
  const sortQuantity = (ing: CookIngredient) => {
    const range = parseQuantityRange(ing.quantity);
    return range ? range[1] : parseQuantity(ing.quantity);
  };

  const groupBest = new Map<string, number | null>();
  const groupFirst = new Map<string, number>();
  list.forEach((ing, idx) => {
    const key = nameKey(ing);
    if (!groupFirst.has(key)) groupFirst.set(key, idx);
    const qty = sortQuantity(ing);
    const current = groupBest.get(key) ?? null;
    groupBest.set(key, current === null ? qty : qty === null ? current : Math.max(current, qty));
  });

  return list
    .map((ing, idx) => ({ ing, idx, key: nameKey(ing), qty: sortQuantity(ing) }))
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

const UNIT_SECONDS: Array<[RegExp, number]> = [
  [/^(s|sec|secs|second|seconds|sek|sekunde|sekunden)$/, 1],
  [/^(m|min|mins|minute|minutes|minuten)$/, 60],
  [/^(h|hr|hrs|hour|hours|std|stunde|stunden)$/, 3600],
  [/^(d|day|days|tag|tage|tagen)$/, 86400],
  [/^(w|week|weeks|woche|wochen)$/, 604800]
];

/**
 * Parse timer unit to seconds. Unknown units count as minutes.
 */
export function unitToSeconds(unitStr: string, qty: number): number {
  const u = unitStr.toLowerCase().trim().replace(/\.$/, '');
  const match = UNIT_SECONDS.find(([re]) => re.test(u));
  return Math.round(qty * (match ? match[1] : 60));
}

// ---------------------------------------------------------------------------------------------
// Official parser output
// ---------------------------------------------------------------------------------------------

type WasmNumber =
  | { type: 'regular'; value: number }
  | { type: 'fraction'; value: { whole: number; num: number; den: number } };

type WasmValue =
  | { type: 'number'; value: WasmNumber }
  | { type: 'range'; value: { start: WasmNumber; end: WasmNumber } }
  | { type: 'text'; value: string };

interface WasmQuantity {
  value: WasmValue;
  unit: string | null;
  scalable: boolean;
}

interface WasmComponent {
  name: string;
  alias: string | null;
  quantity: WasmQuantity | null;
  note: string | null;
  modifiers: string;
}

interface WasmIngredient extends WasmComponent {
  reference: { name: string; components: string[] } | null;
  relation: { relation: { type: 'definition' | 'reference' } };
}

interface WasmTimer {
  name: string | null;
  quantity: WasmQuantity | null;
}

type WasmItem =
  | { type: 'text'; value: string }
  | { type: 'ingredient' | 'cookware' | 'timer' | 'inlineQuantity'; index: number };

interface WasmRecipe {
  raw_metadata: { map: Record<string, unknown> };
  sections: Array<{
    name: string | null;
    content: Array<{ type: 'step'; value: { items: WasmItem[] } } | { type: 'text'; value: string }>;
  }>;
  ingredients: WasmIngredient[];
  cookware: WasmComponent[];
  timers: WasmTimer[];
  inline_quantities: WasmQuantity[];
}

/** Bit of the parser's extension flags that detects quantities such as "180°C" inside the text */
const INLINE_QUANTITIES = 1 << 7;

/** Raise when the way recipes are read changes, cached recipes are then parsed again */
export const PARSER_VERSION = 4;

let parser: Parser | null = null;

function toNumber(n: WasmNumber): number {
  if (n.type === 'regular') return n.value;
  const { whole, num, den } = n.value;
  return whole + num / den;
}

/** Fractions and ranges are kept as written ("1/2", "1-2"), plain numbers stay numbers */
function toDisplay(n: WasmNumber): number | string {
  if (n.type === 'regular') return n.value;
  const { whole, num, den } = n.value;
  return whole > 0 ? `${whole} ${num}/${den}` : `${num}/${den}`;
}

function convertQuantity(q: WasmQuantity | null): {
  quantity?: number | string;
  units?: string;
  fixed?: boolean;
} {
  if (!q) return {};
  let quantity: number | string;
  if (q.value.type === 'number') quantity = toDisplay(q.value.value);
  else if (q.value.type === 'range') quantity = `${toDisplay(q.value.value.start)}-${toDisplay(q.value.value.end)}`;
  else quantity = q.value.value;
  return {
    quantity,
    units: q.unit || undefined,
    // Free text can't be scaled either, but that is not a lock the author set
    fixed: q.value.type !== 'text' && !q.scalable ? true : undefined
  };
}

/** First number of a quantity, the lower end for ranges. Null for free text. */
function firstNumber(q: WasmQuantity | null): number | null {
  if (!q) return null;
  if (q.value.type === 'number') return toNumber(q.value.value);
  if (q.value.type === 'range') return toNumber(q.value.value.start);
  return parseQuantity(q.value.value);
}

const hasModifier = (c: WasmComponent, flag: string) => c.modifiers.split(/[^A-Z]+/).includes(flag);

function convertIngredient(ing: WasmIngredient): CookIngredient {
  const ref = ing.reference;
  const recipePath = ref
    ? [...ref.components.filter((c) => c !== '.' && c !== '..'), ref.name].join('/')
    : undefined;
  return {
    name: ing.name,
    alias: ing.alias || undefined,
    ...convertQuantity(ing.quantity),
    note: ing.note || undefined,
    optional: hasModifier(ing, 'OPT') || undefined,
    hidden: hasModifier(ing, 'HIDDEN') || undefined,
    isNew: hasModifier(ing, 'NEW') || undefined,
    isReference: ing.relation.relation.type === 'reference' || undefined,
    recipePath
  };
}

function convertCookware(cw: WasmComponent): CookCookware {
  const { quantity } = convertQuantity(cw.quantity);
  return {
    name: cw.name,
    alias: cw.alias || undefined,
    quantity,
    note: cw.note || undefined,
    optional: hasModifier(cw, 'OPT') || undefined,
    hidden: hasModifier(cw, 'HIDDEN') || undefined
  };
}

function convertTimer(t: WasmTimer): CookTimer {
  const { quantity, units } = convertQuantity(t.quantity);
  const unit = units ?? 'minutes';
  const value = firstNumber(t.quantity) ?? 0;
  return {
    name: t.name || undefined,
    quantity: quantity ?? '',
    units: unit,
    totalSeconds: unitToSeconds(unit, value)
  };
}

/** Text of a quantity found inside a sentence, such as the temperature in "180°C" */
function inlineQuantityText(q: WasmQuantity): string {
  const { quantity, units } = convertQuantity(q);
  if (quantity === undefined) return '';
  if (!units) return String(quantity);
  return /^[CFK]$/.test(units) ? `${quantity}°${units}` : `${quantity} ${units}`;
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };

/**
 * Messages that only describe how the parser runs here, or that the Cooklang conventions allow
 * anyway ("servings: 6 portions", "yield: 500%ml", timers in German), not something wrong in the recipe.
 */
function isIgnoredMessage(block: string): boolean {
  const head = block.split('\n')[0];
  if (/scaling lock|Redundant new/i.test(head)) return true;
  if (/Unsupported value for key: '(servings|yield)'/i.test(head)) return true;
  const unit = head.match(/Unknown timer unit: (.+)$/i)?.[1];
  return Boolean(unit && UNIT_SECONDS.some(([re]) => re.test(unit.trim().toLowerCase())));
}

/** The parser's report comes as HTML with colors, the app shows it as plain text */
function reportToText(html: string): string {
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/&(lt|gt|quot|amp|#39);/g, (m) => ENTITIES[m] ?? m);
  // One block per message, each starting with "Warning:" or "Error:"
  return text
    .split(/^(?=(?:Warning|Error): )/m)
    .filter((block) => !isIgnoredMessage(block))
    .join('')
    .trim();
}

/** Metadata the way the app reads it, based on the keys from the Cooklang conventions */
function buildMetadata(map: Record<string, unknown>): CookMetadata {
  const metadata: CookMetadata = {};
  const asText = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(', ') : String(v));
  const list = (v: unknown): string[] =>
    (Array.isArray(v) ? v.map(String) : String(v).split(','))
      .map((t) => t.trim())
      .filter(Boolean);

  for (const [key, value] of Object.entries(map)) {
    if (value === null || value === undefined) continue;
    metadata[key.toLowerCase()] = value;
  }

  const first = (...keys: string[]) => {
    for (const key of keys) {
      const v = metadata[key];
      if (v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) return v;
    }
    return undefined;
  };

  if (metadata.tags !== undefined || metadata.tag !== undefined) {
    metadata.tags = list(first('tags', 'tag') ?? []);
  }

  const servings = first('servings', 'serves');
  if (servings !== undefined) metadata.servings = typeof servings === 'number' ? servings : asText(servings);

  const description = first('description', 'introduction');
  if (description !== undefined) metadata.description = asText(description);

  // time: either a total ("45 minutes") or a map with prep and cook
  const time = metadata.time;
  let nestedTime: Record<string, unknown> | null = null;
  if (time && typeof time === 'object' && !Array.isArray(time)) {
    nestedTime = time as Record<string, unknown>;
    delete metadata.time;
  }
  const prep = first('prep time', 'prep_time', 'time.prep') ?? nestedTime?.prep ?? nestedTime?.prep_time;
  const cook = first('cook time', 'cook_time', 'time.cook') ?? nestedTime?.cook ?? nestedTime?.cook_time;
  const total = first('time required', 'time', 'duration', 'time.total', 'total time', 'total_time');
  if (prep !== undefined) metadata.prep_time = asText(prep);
  if (cook !== undefined) metadata.cook_time = asText(cook);
  if (total !== undefined) metadata.time = asText(total);

  // source and author, flat (`source.name`) or nested (`source: {name, url}`)
  const source = metadata.source;
  let sourceName: unknown;
  let sourceUrl: unknown;
  let sourceAuthor: unknown;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const nested = source as Record<string, unknown>;
    sourceName = nested.name;
    sourceUrl = nested.url;
    sourceAuthor = nested.author;
  }
  sourceName ??= metadata['source.name'];
  sourceUrl ??= metadata['source.url'];
  sourceAuthor ??= metadata['source.author'];
  if (typeof source === 'object' || sourceName !== undefined || sourceUrl !== undefined) {
    metadata.source = asText(sourceName ?? sourceUrl ?? '') || undefined;
  }
  if (sourceUrl !== undefined) metadata.source_url = asText(sourceUrl);
  if (metadata.author === undefined && sourceAuthor !== undefined) metadata.author = asText(sourceAuthor);
  if (metadata.author !== undefined) metadata.author = asText(metadata.author);

  const images = first('image', 'images', 'picture', 'pictures', 'photo');
  if (images !== undefined) metadata.image = asText(Array.isArray(images) ? images[0] : images);

  if (metadata.title !== undefined) metadata.title = asText(metadata.title);
  return metadata;
}

/** Text of the recipe when the parser can't read it: front matter dropped, one step per paragraph */
function plainTextRecipe(content: string, path: string, diagnostics: string): Recipe {
  const body = content
    .replace(/^﻿/, '')
    .replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
  const title = content.match(/^title:[ \t]*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  const steps: CookStep[] = body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text, idx) => ({
      stepNumber: idx + 1,
      items: [{ type: 'text' as const, value: text }],
      rawText: text,
      ingredients: [],
      cookware: [],
      timers: []
    }));
  return {
    id: path,
    path,
    name: title || fileName(path),
    folder: folderOf(path),
    metadata: title ? { title } : {},
    steps,
    ingredients: [],
    cookware: [],
    diagnostics,
    hasError: true,
    rawCook: content,
    parserVersion: PARSER_VERSION,
    cachedAt: Date.now()
  };
}

const fileName = (path: string) => (path.split('/').pop() ?? '').replace(/\.cook$/i, '').replace(/[-_]/g, ' ') || 'Recipe';
const folderOf = (path: string) => (path.includes('/') ? path.split('/').slice(0, -1).join('/') : undefined);

/**
 * Parse a raw .cook formatted file with the official parser.
 * Text the parser rejects is shown as plain text; `hasError` and `diagnostics` say why.
 */
export function parseCooklangText(content: string, path: string): Recipe {
  let raw: WasmRecipe | null = null;
  let report = '';
  try {
    if (!parser) {
      parser = new Parser();
      // Keep temperatures and the like as the author wrote them instead of splitting them out of the text
      parser.extensions = parser.extensions & ~INLINE_QUANTITIES;
    }
    const result = parser.parse_full(content.replace(/^﻿/, ''), true);
    report = reportToText(result.error);
    try {
      raw = JSON.parse(result.value) as WasmRecipe;
    } catch {
      raw = null;
    }
  } catch (e) {
    report = `Der Parser ist abgestürzt: ${e instanceof Error ? e.message : String(e)}`;
    parser = null;
  }
  if (!raw) return plainTextRecipe(content, path, report);

  const metadata = buildMetadata(raw.raw_metadata.map);

  const ingredientsByIndex = raw.ingredients.map(convertIngredient);
  const cookwareByIndex = raw.cookware.map(convertCookware);
  const timersByIndex = raw.timers.map(convertTimer);

  const notesRaw: string[] = [];
  let pendingNotes: string[] = [];
  const steps: CookStep[] = [];
  const sectionList: Array<{ name?: string; steps: CookStep[] }> = [];

  for (const rawSection of raw.sections) {
    const sectionName = rawSection.name?.trim() || undefined;
    const sectionSteps: CookStep[] = [];

    for (const block of rawSection.content) {
      if (block.type === 'text') {
        if (block.value.trim()) pendingNotes.push(block.value.trim());
        continue;
      }

      const items: StepItem[] = [];
      const ingredients: CookIngredient[] = [];
      const cookware: CookCookware[] = [];
      const timers: CookTimer[] = [];
      const pushText = (value: string) => {
        const last = items[items.length - 1];
        if (last?.type === 'text') last.value += value;
        else items.push({ type: 'text', value });
      };

      for (const item of block.value.items) {
        if (item.type === 'text') {
          pushText(item.value);
        } else if (item.type === 'inlineQuantity') {
          pushText(inlineQuantityText(raw.inline_quantities[item.index]));
        } else if (item.type === 'ingredient') {
          const ing = ingredientsByIndex[item.index];
          ingredients.push(ing);
          items.push({
            type: 'ingredient',
            name: ing.name,
            alias: ing.alias,
            quantity: ing.quantity,
            units: ing.units,
            note: ing.note,
            optional: ing.optional,
            fixed: ing.fixed,
            hidden: ing.hidden,
            isReference: ing.isReference,
            recipePath: ing.recipePath
          });
        } else if (item.type === 'cookware') {
          const cw = cookwareByIndex[item.index];
          cookware.push(cw);
          items.push({
            type: 'cookware',
            name: cw.name,
            alias: cw.alias,
            quantity: cw.quantity,
            note: cw.note,
            optional: cw.optional,
            hidden: cw.hidden
          });
        } else if (item.type === 'timer') {
          const timer = timersByIndex[item.index];
          timers.push(timer);
          items.push({
            type: 'timer',
            name: timer.name,
            quantity: timer.quantity,
            units: timer.units,
            totalSeconds: timer.totalSeconds
          });
        }
      }

      if (items.length === 0) continue;
      const step: CookStep = {
        // Numbering runs through the whole recipe, sections do not restart it
        stepNumber: steps.length + 1,
        section: sectionName,
        notesBefore: pendingNotes.length > 0 ? pendingNotes : undefined,
        items,
        rawText: items.map((i) => (i.type === 'text' ? i.value : (i.alias ?? i.name ?? ''))).join(''),
        ingredients,
        cookware,
        timers
      };
      pendingNotes = [];
      steps.push(step);
      sectionSteps.push(step);
    }

    // A section without steps (only a heading or notes) is not shown
    if (sectionSteps.length > 0) sectionList.push({ name: sectionName, steps: sectionSteps });
  }

  // Notes after the last step
  if (pendingNotes.length > 0) {
    if (steps.length > 0) steps[steps.length - 1].notesAfter = pendingNotes;
    else notesRaw.push(...pendingNotes);
  }

  // Also collect any notes from metadata if present
  const metaNotes = metadata.notes ?? metadata.note ?? metadata.tips ?? metadata.tip;
  for (const n of Array.isArray(metaNotes) ? metaNotes : metaNotes ? [metaNotes] : []) {
    const str = String(n).trim();
    if (str && !notesRaw.includes(str)) notesRaw.push(str);
  }

  const allCookware = new Map<string, CookCookware>();
  for (const cw of cookwareByIndex) {
    if (cw.hidden) continue;
    const key = `${cw.name.toLowerCase()}|${cw.optional ? 'opt' : 'req'}`;
    const existing = allCookware.get(key);
    if (!existing) {
      allCookware.set(key, { ...cw });
      continue;
    }
    // Same cookware mentioned again: keep the amount if the first mention had none, collect notes
    if (existing.quantity === undefined) existing.quantity = cw.quantity;
    if (cw.note && !(existing.note ?? '').split('; ').includes(cw.note)) {
      existing.note = existing.note ? `${existing.note}; ${cw.note}` : cw.note;
    }
    if (!existing.alias) existing.alias = cw.alias;
  }

  // Hidden ingredients stay out of the list, and so do references without an amount of their own
  const listed = ingredientsByIndex.filter(
    (ing) => !ing.hidden && !(ing.isReference && ing.quantity === undefined)
  );

  const hasSections = sectionList.some((s) => Boolean(s.name));

  return {
    id: path,
    path,
    name: (metadata.title as string) || fileName(path),
    folder: folderOf(path),
    metadata,
    steps,
    sections: hasSections ? sectionList : undefined,
    ingredients: aggregateIngredients(listed),
    cookware: Array.from(allCookware.values()),
    notes: notesRaw.length > 0 ? notesRaw : undefined,
    diagnostics: report || undefined,
    rawCook: content,
    parserVersion: PARSER_VERSION,
    image: metadata.image as string | undefined,
    cachedAt: Date.now()
  };
}
