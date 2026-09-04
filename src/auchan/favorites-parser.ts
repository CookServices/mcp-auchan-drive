/**
 * favorites-parser.ts — Parse le HTML de GET /client/mes-produits-preferes
 * Même approche que parser.ts : regex sur le HTML brut, pas de cheerio/jsdom.
 *
 * Structure de la page :
 *   - Une carte <article class="product-thumbnail"> par produit racheté régulièrement,
 *     marquée `data-list="frequent_products"` (les autres cartes de la page sont des
 *     carrousels de recommandation, à ignorer)
 *   - Un <script> `productUpdateDetail` par carte : nom, marque, rayon, disponibilité
 *   - Prix, contenance et promotions dans le markup de la carte
 */

import type { FavoriteProduct } from '../types.js';
import { parsePrice, decode, extractTagBlocks } from './html-utils.js';
import { extractEmbeddedProducts } from './product-json.js';
import { assertAuthenticated, assertAnchor } from './page-guard.js';

/** Attribut qui distingue les produits favoris des carrousels de recommandation. */
const FAVORITES_MARKER = 'data-list="frequent_products"';

/**
 * Parse le HTML brut de /client/mes-produits-preferes et retourne un tableau plat
 * de FavoriteProduct. La page ne groupant plus les produits par section, le rayon
 * provient de la taxonomie du JSON embarqué.
 */
export function parseFavoritesPage(html: string): FavoriteProduct[] {
  assertAuthenticated(html, '/client/mes-produits-preferes');
  // Présent même quand le compte n'a encore aucun produit favori.
  assertAnchor(html, 'wishlist__content', '/client/mes-produits-preferes');

  const results: FavoriteProduct[] = [];

  // Le <script> productUpdateDetail est un frère de l'<article>, pas un descendant :
  // on indexe donc les produits de toute la page, puis on les rattache à leur carte
  // via l'identifiant porté par `data-id`.
  const byId = new Map(
    extractEmbeddedProducts(html)
      .filter((p) => p.digitalId)
      .map((p) => [p.digitalId, p]),
  );

  for (const card of extractTagBlocks(html, 'article', FAVORITES_MARKER)) {
    const dataId = card.match(/data-id="([^"]+)"/)?.[1] ?? '';
    const embedded = byId.get(dataId);

    // Lien produit : "/auchan-filets-de-poulet-blanc/pr-C1164797"
    const linkM = card.match(/href="(\/[^"]*\/pr-(C\d+))"/);

    const name = embedded?.name ?? textOf(card, 'product-thumbnail__description');
    if (!name) continue;

    const priceFormatted = textOf(card, 'product-price');

    results.push({
      productId: dataId || undefined,
      name,
      brand: embedded?.brand,
      format: textOf(card, 'product-attribute') || undefined,
      category: embedded?.category ?? '',
      categoryPath: embedded?.categoryPath,
      price: parsePrice(priceFormatted),
      priceFormatted,
      pricePerUnit: pricePerUnit(card),
      promo: textOf(card, 'product-discount-label') || undefined,
      productUrl: linkM?.[1] ?? '',
      productCode: linkM?.[2],
      available: isAvailable(card, embedded?.available),
    });
  }

  return results;
}

/**
 * Prix à l'unité, ex. "12,97€ / kg". Il est rendu dans un <span> sans classe,
 * voisin de `product-attribute` : on le repère donc à son motif "… € / unité".
 */
function pricePerUnit(card: string): string | undefined {
  const attributes = card.match(
    /class="[^"]*product-thumbnail__attributes[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  if (!attributes) return undefined;

  const m = attributes[1].match(/>\s*([\d\s,.]+(?:&#x20AC;|€)\s*\/\s*[^<]+)</);
  return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : undefined;
}

/**
 * Disponibilité : le sélecteur de quantité porte l'état réel du stock.
 * On retombe sur la disponibilité du JSON embarqué s'il est absent.
 */
function isAvailable(card: string, embeddedAvailable?: boolean): boolean {
  const selector = card.match(/<div[^>]*class="[^"]*quantity-selector[^"]*"[^>]*>/);
  if (!selector) return embeddedAvailable ?? false;

  const tag = selector[0];
  if (/data-disable-button="true"/.test(tag)) return false;

  const stock = tag.match(/data-stock="(\d+)"/);
  if (stock) return Number(stock[1]) > 0;

  return embeddedAvailable ?? true;
}

/**
 * Retourne le texte de l'élément portant `className`, balises internes retirées.
 * Chaîne vide si l'élément est absent.
 */
function textOf(html: string, className: string): string {
  const m = html.match(new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/`));
  if (!m) return '';
  return decode(m[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
