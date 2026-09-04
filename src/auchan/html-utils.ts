/** Convertit "2,98 €" ou "11,92" → centimes entiers (298, 1192). */
export function parsePrice(text: string): number {
  const m = text.match(/(\d+)[,.](\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

/**
 * Extrait les blocs `<tag …>…</tag>` dont la balise ouvrante contient `marker`.
 *
 * Contrairement à un regex non-greedy `<li>([\s\S]*?)<\/li>`, cette fonction
 * compte les ouvertures/fermetures et retourne donc le bloc complet même quand
 * la même balise est imbriquée.
 */
export function extractTagBlocks(html: string, tag: string, marker: string): string[] {
  const blocks: string[] = [];
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'g');
  const boundaryRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'g');

  let openMatch: RegExpExecArray | null;
  while ((openMatch = openRe.exec(html)) !== null) {
    if (!openMatch[0].includes(marker)) continue;

    const start = openMatch.index;
    boundaryRe.lastIndex = start;

    let depth = 0;
    let boundary: RegExpExecArray | null;
    while ((boundary = boundaryRe.exec(html)) !== null) {
      depth += boundary[0].startsWith(`</`) ? -1 : 1;
      if (depth === 0) {
        // `openRe.lastIndex` reste juste après la balise ouvrante : un bloc
        // imbriqué portant le même marqueur doit lui aussi être retourné.
        blocks.push(html.slice(start, boundary.index + boundary[0].length));
        break;
      }
    }
  }

  return blocks;
}

/**
 * Teste si la balise ouvrante `tag` porte exactement la classe `name`.
 *
 * Évite les faux positifs entre classes préfixées : "p-detail__address" ne doit
 * pas matcher "p-detail__addressesAndDelivery".
 */
export function hasClass(tag: string, name: string): boolean {
  const classAttr = tag.match(/class="([^"]*)"/)?.[1];
  return classAttr ? classAttr.split(/\s+/).includes(name) : false;
}

/**
 * Extrait l'objet JSON qui suit `marker` dans le HTML, en équilibrant les
 * accolades et en ignorant celles situées dans une chaîne de caractères.
 * Retourne `null` si aucun objet complet n'est trouvé.
 */
export function extractJsonAfter(html: string, marker: string, from = 0): { json: string; end: number } | null {
  const markerPos = html.indexOf(marker, from);
  if (markerPos === -1) return null;

  const start = html.indexOf('{', markerPos + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { json: html.slice(start, i + 1), end: i + 1 };
    }
  }

  return null;
}

/** Supprime les balises HTML et normalise les espaces. */
export function stripTags(html: string): string {
  return decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Table des entités HTML nommées courantes. */
const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Décode les entités HTML (nommées + numériques décimales et hexadécimales).
 * Les entités nommées sont traitées en un seul passage pour éviter le double-décodage
 * (ex. "&amp;lt;" → "&lt;" et non "<").
 */
export function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => NAMED_ENTITIES[m] ?? m);
}
