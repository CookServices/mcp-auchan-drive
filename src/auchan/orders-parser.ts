/**
 * orders-parser.ts — Parse le HTML de GET /client/mes-commandes
 * Même approche que loyalty-parser.ts : regex sur le HTML brut, pas de cheerio/jsdom.
 */

import type { Order } from '../types.js';
import { parsePrice, decode, extractTagBlocks } from './html-utils.js';
import { assertAuthenticated, assertAnchor } from './page-guard.js';

export type { Order };

/**
 * Parse la page HTML de l'historique des commandes et retourne la liste des commandes.
 *
 * Structure HTML attendue :
 * ```html
 * <li class="t-orders__item" data-fetch="/customer/async/orders/details/AROM-761999631/370069704/false">
 *   <div class="p-order">
 *     <div class="p-order__header">
 *       <div class="a-pointOfService">
 *         <span class="a-pointOfService__label">Retrait</span>
 *         <span class="a-pointOfService__place">Auchan Drive Caluire</span>
 *       </div>
 *       <div class="p-order__reference">Commande n° 370069704 du 14 juin 2026</div>
 *       <div class="a-simplifiedState"><span class="a-simplifiedState__label">Retirée</span></div>
 *     </div>
 *     <div class="p-order__footer">
 *       <div class="m-productThumbnails__count"><span>14</span> Produits</div>
 *       <div class="p-order__totalAmount">38,62 €</div>
 *       <a href="/client/mes-commandes/AROM-761999631/370069704">Voir le détail</a>
 *     </div>
 *   </div>
 * </li>
 * ```
 *
 * Le résumé (nombre de produits, total) est parfois rendu à zéro dans la liste,
 * la page le complétant ensuite côté client. `get_order_detail` reste la source
 * fiable pour ces deux champs.
 */
export function parseOrdersPage(html: string): Order[] {
  assertAuthenticated(html, '/client/mes-commandes');
  // Présent même quand la période filtrée ne contient aucune commande.
  assertAnchor(html, 't-orders__wrapper', '/client/mes-commandes');

  const orders: Order[] = [];

  for (const block of extractTagBlocks(html, 'li', 't-orders__item')) {
    // Le bloc doit contenir un lien vers le détail de la commande.
    const hrefM = block.match(/href="(\/client\/mes-commandes\/([^/"]+)\/(\d+))"/);
    if (!hrefM) continue;

    const detailUrl = hrefM[1];
    const orderRef = hrefM[2];
    const orderNumber = hrefM[3];

    const storeName = textOf(block, 'a-pointOfService__place');
    const status = textOf(block, 'a-simplifiedState__label');

    // "Commande n° 370069704 du 14 juin 2026" → "14 juin 2026"
    const reference = textOf(block, 'p-order__reference');
    const date = reference.match(/du\s+(.+)$/)?.[1]?.trim() ?? '';

    // "<span>14</span> Produits" → 14
    const countText = textOf(block, 'm-productThumbnails__count');
    const productCount = Number(countText.match(/\d+/)?.[0] ?? 0);

    const totalFormatted = textOf(block, 'p-order__totalAmount');

    orders.push({
      orderRef,
      orderNumber,
      date,
      storeName,
      status,
      productCount,
      total: parsePrice(totalFormatted),
      totalFormatted,
      detailUrl,
    });
  }

  return orders;
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
