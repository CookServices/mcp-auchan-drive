import { describe, it, expect } from 'vitest';
import { parseFavoritesPage } from '../../../src/auchan/favorites-parser.js';
import { PageShapeError, NotAuthenticatedError } from '../../../src/auchan/page-guard.js';

/** Enveloppe des cartes dans le conteneur que la page rend toujours. */
const page = (body: string) => `<html><body><div class="wishlist__content">${body}</div></body></html>`;

interface CardOptions {
  id: string;
  code: string;
  slug: string;
  name: string;
  brand: string;
  level1: string;
  level2: string;
  format?: string;
  pricePerUnit?: string;
  price: string;
  promo?: string;
  /** Absent = produit non drivable (pas de sélecteur de quantité). */
  stock?: number;
  disabled?: boolean;
  available?: boolean;
  /** Retire `data-list="frequent_products"` : carte de recommandation. */
  recommendation?: boolean;
}

/**
 * Reproduit une carte de /client/mes-produits-preferes : un <article> suivi du
 * <script> `productUpdateDetail`, qui en est le frère et non un descendant.
 */
function card(opts: CardOptions): string {
  const payload = JSON.stringify({
    product: {
      name: opts.name,
      grocery: true,
      id: { digital: opts.id, ref_fo: opts.code, cug: '000000' },
      availability: { status: opts.available ?? true },
      category: { level1: opts.level1, level2: opts.level2 },
      brand: { internal: false, name: opts.brand },
    },
  });

  const attributes = [
    opts.format ? `<span class="product-attribute" aria-label="Contenance">${opts.format}</span>` : '',
    opts.pricePerUnit ? `<span data-seller-type="GROCERY">${opts.pricePerUnit}</span>` : '',
  ].join('\n');

  const quantitySelector =
    opts.stock === undefined
      ? ''
      : `<div class="quantity-selector qa2c-wrapper" data-product-id="${opts.id}" data-stock="${opts.stock}" data-disable-button="${opts.disabled ?? false}"></div>`;

  const promo = opts.promo
    ? `<div class="discount-markups"><div class="product-discount"><span class="product-discount-label">${opts.promo}</span></div></div>`
    : '';

  return `
  <article itemscope="itemscope" itemtype="http://schema.org/Product" class="product-thumbnail  product-thumbnail--column  " data-id="${opts.id}"${opts.recommendation ? '' : ' data-list="frequent_products"'}>
    <div class="product-thumbnail__content-wrapper">
      <a class="product-thumbnail__details-wrapper productThumbnailLink" href="/${opts.slug}/pr-${opts.code}" data-id="${opts.id}">
        <div class="product-thumbnail__details">
          <p class="product-thumbnail__description" itemprop="name description"><strong>${opts.brand}</strong> ${opts.name}</p>
          <div class="product-thumbnail__attributes">
            ${attributes}
          </div>
        </div>
      </a>
    </div>
    <footer class="product-thumbnail__footer">
      <div class="product-thumbnail__commercials">${promo}</div>
      <div class="product-thumbnail__footer-wrapper">
        <div class="product-thumbnail__price product-price__container">
          <div class="product-price bolder text-dark-color">${opts.price}</div>
        </div>
        <div class="product-thumbnail__call-to-actions">${quantitySelector}</div>
      </div>
    </footer>
  </article>
  <script>
    const productUpdateDetail = ${payload};
    (window.G.productSearchQueue = window.G.productSearchQueue || []).push(productUpdateDetail);
  </script>`;
}

const ORANGINA: CardOptions = {
  id: 'id-orangina', code: 'C1820950', slug: 'orangina-boisson-gazeuse-a-l-orange',
  name: "Boisson gazeuse à l'orange", brand: 'ORANGINA',
  level1: 'BOISSONS', level2: 'BOISSONS SANS ALCOOL',
  format: '1,5l', pricePerUnit: '1,29&#x20AC; / l', price: '1,93&#x20AC;',
  promo: '-50% sur le 2&#xE8;me', stock: 21,
};

const EVIAN: CardOptions = {
  id: 'id-evian', code: 'C1000001', slug: 'evian-eau-minerale-naturelle',
  name: 'Eau minérale naturelle', brand: 'EVIAN',
  level1: 'BOISSONS', level2: 'EAUX', price: '3,45&#x20AC;', stock: 12,
};

const PANZANI: CardOptions = {
  id: 'id-panzani', code: 'C1000002', slug: 'panzani-pates-spaghetti',
  name: 'Pâtes spaghetti', brand: 'PANZANI',
  level1: 'EPICERIE', level2: 'PATES', price: '1,15&#x20AC;',
  stock: 0, disabled: true,
};

const FULL_HTML = `
<html><body>
<div class="wishlist__content">
${card(ORANGINA)}
${card(EVIAN)}
${card(PANZANI)}
</div>
</body></html>
`;

describe('parseFavoritesPage', () => {
  // ── Page vide ──────────────────────────────────────────────────────────────

  it('retourne un tableau vide quand le compte n\'a aucun favori', () => {
    expect(parseFavoritesPage(page(''))).toEqual([]);
  });

  it('lève si le conteneur de la page est absent', () => {
    expect(() => parseFavoritesPage('<html><body></body></html>')).toThrow(PageShapeError);
  });

  it('lève si la page est un écran de connexion', () => {
    const login = '<html><head><title>Se connecter à auchan.fr</title></head><body>'
      + '<form action="https://compte.auchan.fr/auth/realms/auchan.fr/protocol/openid-connect/auth">'
      + '<input type="password" name="password"></form></body></html>';
    expect(() => parseFavoritesPage(login)).toThrow(NotAuthenticatedError);
  });

  it('retourne 3 produits depuis le HTML complet', () => {
    const products = parseFavoritesPage(FULL_HTML);
    expect(products).toHaveLength(3);
  });

  // ── Sélection des cartes ───────────────────────────────────────────────────

  it('ignore les cartes de recommandation', () => {
    const html = page(`${card(ORANGINA)}${card({ ...EVIAN, recommendation: true })}`);
    const products = parseFavoritesPage(html);
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Boisson gazeuse à l'orange");
  });

  // ── Rayon ──────────────────────────────────────────────────────────────────

  it('associe les produits à leur rayon', () => {
    const products = parseFavoritesPage(FULL_HTML);
    expect(products[0].category).toBe('BOISSONS');
    expect(products[2].category).toBe('EPICERIE');
  });

  it('expose la taxonomie rayon complète', () => {
    const products = parseFavoritesPage(FULL_HTML);
    expect(products[0].categoryPath).toEqual(['BOISSONS', 'BOISSONS SANS ALCOOL']);
  });

  // ── Nom et marque ──────────────────────────────────────────────────────────

  it('extrait le nom sans la marque', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.name).toBe("Boisson gazeuse à l'orange");
  });

  it('extrait la marque séparément', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.brand).toBe('ORANGINA');
  });

  it('extrait le nom et la marque du deuxième produit', () => {
    const p2 = parseFavoritesPage(FULL_HTML)[1];
    expect(p2.name).toBe('Eau minérale naturelle');
    expect(p2.brand).toBe('EVIAN');
  });

  // ── Format ─────────────────────────────────────────────────────────────────

  it('extrait le format du produit', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.format).toBe('1,5l');
  });

  // ── Prix ───────────────────────────────────────────────────────────────────

  it('parse le prix en centimes', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.price).toBe(193);
  });

  it('conserve le prix formaté', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.priceFormatted).toBe('1,93€');
  });

  it('extrait le prix par unité', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.pricePerUnit).toBe('1,29€ / l');
  });

  it('retourne pricePerUnit undefined si absent', () => {
    const p2 = parseFavoritesPage(FULL_HTML)[1];
    expect(p2.pricePerUnit).toBeUndefined();
  });

  // ── Promotion ──────────────────────────────────────────────────────────────

  it('extrait la promotion du premier produit', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.promo).toBe('-50% sur le 2ème');
  });

  it('retourne promo undefined si absente', () => {
    const p2 = parseFavoritesPage(FULL_HTML)[1];
    expect(p2.promo).toBeUndefined();
  });

  // ── URL et code produit ────────────────────────────────────────────────────

  it('extrait l\'URL produit', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.productUrl).toBe('/orangina-boisson-gazeuse-a-l-orange/pr-C1820950');
  });

  it('extrait le code produit depuis le slug', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.productCode).toBe('C1820950');
  });

  // ── Disponibilité ──────────────────────────────────────────────────────────

  it('available = true quand le sélecteur de quantité est actif', () => {
    const p = parseFavoritesPage(FULL_HTML)[0];
    expect(p.available).toBe(true);
  });

  it('available = false quand le sélecteur est désactivé', () => {
    const panzani = parseFavoritesPage(FULL_HTML)[2];
    expect(panzani.name).toBe('Pâtes spaghetti');
    expect(panzani.available).toBe(false);
  });

  it('retombe sur le JSON embarqué si le sélecteur est absent', () => {
    const html = page(card({ ...ORANGINA, stock: undefined, available: false }));
    expect(parseFavoritesPage(html)[0].available).toBe(false);
  });

  // ── Décodage ───────────────────────────────────────────────────────────────

  it('décode les entités HTML dans la marque', () => {
    const html = page(card({
      ...EVIAN, id: 'id-ev', brand: 'ELLE & VIRE', name: 'Beurre doux',
    }));
    expect(parseFavoritesPage(html)[0].brand).toBe('ELLE & VIRE');
  });
});
