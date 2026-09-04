/**
 * order-detail-parser.ts — Parse le HTML de GET /client/mes-commandes/{ref}/{num}
 * Même approche que les autres parsers : regex sur le HTML brut.
 */

import type { OrderDetail, OrderProduct } from '../types.js';
import { parsePrice, decode, extractTagBlocks, stripTags, hasClass } from './html-utils.js';
import { extractEmbeddedProducts } from './product-json.js';

/**
 * Parse la page HTML de détail d'une commande.
 *
 * Structure HTML attendue :
 * ```html
 * <div class="p-detail__header">
 *   <span class="a-pointOfService__place">Auchan Drive Caluire</span>
 *   <span class="a-simplifiedState__label">Retirée</span>
 * </div>
 * <div class="p-detail__deliveryDate">dimanche 8h30&gt;13h</div>
 *
 * <!-- Une section par rayon -->
 * <section class="o-products__list">
 *   <div class="o-products__category">Boucherie, volaille, poissonnerie</div>
 *   <div class="o-products__line m-productItem">
 *     <article class="product-thumbnail" data-id="…">…</article>
 *     <script>const productUpdateDetail = {"product":{"name":"Chipolatas",…}};</script>
 *     <aside class="m-productItem__aside">
 *       <div class="a-amount__amount">8,34 €</div>
 *       <div class="p-detail__productQuantity">Quantité : 6</div>
 *     </aside>
 *   </div>
 * </section>
 *
 * <!-- Récapitulatif -->
 * <div class="m-receipt__total"><span class="m-receipt__label">Total</span>
 *   <strong class="m-receipt__value">82,12 €</strong></div>
 * ```
 *
 * Le nom et la marque sont lus dans le JSON `productUpdateDetail` embarqué plutôt
 * que dans le markup : il est partagé par toutes les pages produit du site et
 * survit aux changements de classes CSS.
 */
export function parseOrderDetailPage(
  html: string,
  orderRef: string,
  orderNumber: string,
): OrderDetail {
  const storeName = textOf(html, 'a-pointOfService__place');
  const status = textOf(html, 'a-simplifiedState__label');
  const storeAddress = parseStoreAddress(html, storeName);

  // "Retrait prévu le: mardi 16 juin entre 17h00 et 17h30" → on retire le libellé.
  const deliveryDate = textOf(html, 'p-detail__deliveryDate');
  const pickupSlot = deliveryDate.replace(/^.*?pr[ée]vu\s+le\s*:\s*/i, '').trim() || undefined;

  // Total : la ligne "Total" du récapitulatif, sinon l'entête de la commande.
  const totalFormatted = receiptTotal(html) || textOf(html, 'p-detail__totalAmount');

  return {
    orderNumber,
    orderRef,
    storeName,
    storeAddress,
    status,
    pickupSlot,
    total: parsePrice(totalFormatted),
    totalFormatted,
    products: parseProducts(html),
  };
}

/** Parcourt les sections de rayon et en extrait les lignes produit. */
function parseProducts(html: string): OrderProduct[] {
  const products: OrderProduct[] = [];

  for (const section of extractTagBlocks(html, 'section', 'o-products__list')) {
    const category = textOf(section, 'o-products__category');

    for (const line of extractTagBlocks(section, 'div', 'o-products__line')) {
      const [embedded] = extractEmbeddedProducts(line);

      // Sans JSON embarqué, on retombe sur la description affichée.
      const name = embedded?.name ?? textOf(line, 'product-thumbnail__description');
      if (!name) continue;

      const priceFormatted = textOf(line, 'a-amount__amount');

      // "Quantité : 6" → 6
      const quantityText = textOf(line, 'p-detail__productQuantity');
      const quantity = Number(quantityText.match(/\d+/)?.[0] ?? 1);

      products.push({
        name,
        brand: embedded?.brand ?? '',
        quantity,
        price: parsePrice(priceFormatted),
        priceFormatted,
        category: category || embedded?.category || '',
        categoryPath: embedded?.categoryPath,
      });
    }
  }

  return products;
}

/**
 * Adresse du magasin de retrait.
 *
 * La page rend deux blocs `p-detail__address` : le magasin puis l'adresse de
 * facturation du client. On sélectionne explicitement celui intitulé "Magasin"
 * pour ne jamais remonter l'adresse personnelle du titulaire du compte.
 */
function parseStoreAddress(html: string, storeName: string): string {
  // Le conteneur parent "p-detail__addressesAndDelivery" englobe les deux blocs :
  // on ne garde que les <div> dont la classe est exactement "p-detail__address".
  const storeBlock = extractTagBlocks(html, 'div', 'p-detail__address')
    .filter((b) => hasClass(b.match(/^<div[^>]*>/)?.[0] ?? '', 'p-detail__address'))
    .find((b) => /<strong>\s*Magasin\s*<\/strong>/i.test(b));
  if (!storeBlock) return '';

  // Le lien "Infos" et le libellé ne font pas partie de l'adresse.
  const body = storeBlock
    .replace(/<strong>[\s\S]*?<\/strong>/i, '')
    .replace(/<a\b[\s\S]*?<\/a>/gi, '');

  const lines = body
    .split(/<br\s*\/?>/i)
    .map((line) => stripTags(line))
    .filter(Boolean);

  // La première ligne répète le nom du magasin, déjà exposé par `storeName`.
  if (lines[0] === storeName) lines.shift();

  return lines.join(' ');
}

/** Lit la valeur de la ligne "Total" du récapitulatif de commande. */
function receiptTotal(html: string): string {
  const totalBlock = html.match(
    /class="[^"]*m-receipt__total[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  if (!totalBlock) return '';

  const value = totalBlock[1].match(
    /class="[^"]*m-receipt__value[^"]*"[^>]*>([\s\S]*?)<\//,
  );
  return value ? stripTags(value[1]) : '';
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
