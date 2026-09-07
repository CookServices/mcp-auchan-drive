/**
 * product-json.ts — Extraction des produits depuis le JSON embarqué dans les pages.
 *
 * Chaque carte produit rendue par le composant `product-thumbnail` est suivie d'un
 * <script> qui pousse un objet `productUpdateDetail` dans `window.G.productSearchQueue` :
 *
 * ```html
 * <script>
 *   const productUpdateDetail = {"product":{"name":"Filets de poulet","brand":{…},
 *     "id":{"digital":"…","ref_fo":"C1164797"},"category":{"level1":"…","level2":"…"},
 *     "availability":{"status":true}}};
 * </script>
 * ```
 *
 * Ce JSON est nettement plus stable que les classes CSS environnantes : il est
 * partagé par /recherche, /client/mes-commandes/… et /client/mes-produits-preferes.
 */

import { extractJsonAfter } from './html-utils.js';

const MARKER = 'productUpdateDetail';

export interface EmbeddedProduct {
  /** Identifiant interne (UUID) — correspond à l'attribut `data-id` de l'<article>. */
  digitalId: string;
  /** Référence catalogue, ex. "C1164797" — utilisée dans les URLs "/slug/pr-C1164797". */
  refFo: string;
  name: string;
  brand?: string;
  /** Rayon le plus général (level1) : "FRUITS ET LEGUMES", "CREMERIE"… */
  category: string;
  /** Taxonomie complète, du plus général au plus fin. */
  categoryPath: string[];
  available: boolean;
  /** Position du JSON dans le document — sert à apparier avec le HTML voisin. */
  offset: number;
}

interface RawProductPayload {
  product?: {
    name?: string;
    brand?: { name?: string; internal?: boolean };
    id?: { digital?: string; ref_fo?: string; cug?: string };
    category?: Record<string, string>;
    availability?: { status?: boolean };
  };
}

/**
 * Extrait tous les produits décrits par un bloc `productUpdateDetail` du HTML,
 * dans l'ordre du document. Les blocs illisibles sont ignorés silencieusement :
 * une carte cassée ne doit pas faire échouer la page entière.
 */
export function extractEmbeddedProducts(html: string): EmbeddedProduct[] {
  const products: EmbeddedProduct[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  for (;;) {
    const found = extractJsonAfter(html, MARKER, cursor);
    if (!found) break;

    const offset = found.end - found.json.length;
    cursor = found.end;

    let payload: RawProductPayload;
    try {
      payload = JSON.parse(found.json) as RawProductPayload;
    } catch {
      continue;
    }

    const product = payload.product;
    if (!product?.name) continue;

    const digitalId = product.id?.digital ?? '';
    const refFo = product.id?.ref_fo ?? '';

    // Une même carte peut être rendue deux fois (carrousel + liste) : on dédoublonne.
    const key = digitalId || refFo || product.name;
    if (seen.has(key)) continue;
    seen.add(key);

    const categoryPath = categoryLevels(product.category);

    products.push({
      digitalId,
      refFo,
      name: product.name,
      brand: product.brand?.name,
      category: categoryPath[0] ?? '',
      categoryPath,
      available: product.availability?.status === true,
      offset,
    });
  }

  return products;
}

/** Ordonne "level1".."level5" et retire les niveaux vides. */
function categoryLevels(category?: Record<string, string>): string[] {
  if (!category) return [];
  return Object.keys(category)
    .filter((k) => /^level\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((k) => category[k]?.trim())
    .filter((v): v is string => Boolean(v));
}
