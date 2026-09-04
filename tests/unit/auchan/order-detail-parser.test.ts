import { describe, it, expect } from 'vitest';
import { parseOrderDetailPage } from '../../../src/auchan/order-detail-parser.js';

/** Ligne produit telle que rendue dans une section de rayon. */
function line(opts: {
  id: string;
  refFo: string;
  name: string;
  brand: string;
  level1: string;
  level2: string;
  price: string;
  quantity: number;
}): string {
  const payload = JSON.stringify({
    product: {
      name: opts.name,
      grocery: true,
      id: { digital: opts.id, ref_fo: opts.refFo, cug: '000000' },
      availability: { status: true },
      category: { level1: opts.level1, level2: opts.level2 },
      brand: { internal: false, name: opts.brand },
    },
  });

  return `
  <div class="o-products__line m-productItem" role="list">
    <article itemscope="itemscope" itemtype="http://schema.org/Product" class="product-thumbnail m-productItem__product product-thumbnail--row" data-id="${opts.id}">
      <div class="product-thumbnail__content-wrapper">
        <a class="product-thumbnail__details-wrapper" href="/slug/pr-${opts.refFo}">
          <div class="product-thumbnail__details">
            <p class="product-thumbnail__description" itemprop="name description">${opts.name}</p>
          </div>
        </a>
      </div>
    </article>
    <script>
      const productUpdateDetail = ${payload};
      (window.G.productSearchQueue = window.G.productSearchQueue || []).push(productUpdateDetail);
    </script>
    <aside class="m-productItem__aside">
      <div class="a-amount">
        <div class="a-amount__amount">${opts.price}</div>
        <div class="a-amount__taxes"><div class="a-amount__tax"></div></div>
      </div>
      <div class="p-detail__productQuantity">Quantit&#xE9; : ${opts.quantity}</div>
    </aside>
  </div>`;
}

const HEADER = (store: string, status: string) => `
<div class="p-detail__header">
  <div class="p-detail__pointOfService">
    <div class="a-pointOfService">
      <div class="a-pointOfService__infos">
        <span class="a-pointOfService__label">Drive</span>
        <span class="a-pointOfService__place">${store}</span>
      </div>
    </div>
  </div>
  <div class="p-detail__simplifiedState">
    <div class="a-simplifiedState a-simplifiedState--light-grey">
      <span class="a-simplifiedState__label">${status}</span>
    </div>
  </div>
</div>`;

/** Les deux blocs d'adresse rendus par la page : magasin puis facturation. */
const ADDRESSES = `
<div class="p-detail__addressesAndDelivery">
  <div class="p-detail__address">
    <strong>Magasin</strong>
    Auchan Drive Caluire<br>
    10 Chemin Jean Petit<br>
    69300 CALUIRE-ET-CUIRE
    <a class="p-detail__storeLink" href="https://www.auchan.fr/magasins/s-868">Infos</a>
  </div>
  <div class="p-detail__address">
    <strong>Adresse de facturation</strong>
    Prénom NOM<br>
    1 rue de la Paix<br>
    75002 PARIS
  </div>
</div>`;

const RECEIPT = (total: string) => `
<section class="p-detail__receiptInfos">
  <div class="m-receipt">
    <ul class="m-receipt__details">
      <li class="m-receipt__line">
        <span class="m-receipt__label">Total produits</span>
        <strong class="m-receipt__value">95,08 &#x20AC;</strong>
      </li>
    </ul>
    <div class="m-receipt__total m-receipt__line">
      <span class="m-receipt__label">Total</span>
      <strong class="m-receipt__value">${total}</strong>
    </div>
  </div>
</section>`;

const FULL_HTML = `
<html><body>
${HEADER('Auchan Drive Caluire', 'En cours de pr&#xE9;paration')}
<div class="p-detail__deliveryModeAndDate">
  <div class="p-detail__deliveryMode"><strong>Mode d&#x2019;achat</strong> Retrait Drive</div>
  <div class="p-detail__deliveryDate">Retrait pr&#xE9;vu le: mardi 16 juin entre 17h00 et 17h30</div>
</div>
${ADDRESSES}
<div class="p-detail__categoriesAndProducts o-products">
  <section class="o-products__list">
    <div aria-level="3" class="o-products__category" role="heading">Boucherie, volaille, poissonnerie</div>
    ${line({ id: 'id-1', refFo: 'C0000001', name: 'Chipolatas supérieures aux herbes', brand: 'AUCHAN', level1: 'PRODUITS FRAIS', level2: 'BOUCHERIE', price: '8,34 &#x20AC;', quantity: 6 })}
    ${line({ id: 'id-2', refFo: 'C0000002', name: 'Quiche lorraine 900g', brand: 'MARIE', level1: 'PRODUITS FRAIS', level2: 'TRAITEUR LS', price: '5,49 &#x20AC;', quantity: 1 })}
  </section>
  <section class="o-products__list">
    <div aria-level="3" class="o-products__category" role="heading">&#xC9;picerie sal&#xE9;e</div>
    ${line({ id: 'id-3', refFo: 'C0000003', name: 'Pâtes spaghetti', brand: 'PANZANI', level1: 'EPICERIE', level2: 'PATES', price: '2,40 &#x20AC;', quantity: 2 })}
  </section>
</div>
${RECEIPT('38,62 &#x20AC;')}
</body></html>
`;

const RETIRED_HTML = `
<html><body>
${HEADER('Auchan Drive Caluire', 'Retir&#xE9;e')}
${ADDRESSES}
<div class="p-detail__categoriesAndProducts o-products">
  <section class="o-products__list">
    <div aria-level="3" class="o-products__category" role="heading">Cr&#xE8;merie, &#x153;ufs</div>
    ${line({ id: 'id-9', refFo: 'C0000009', name: 'Lait demi-écrémé 6×1l', brand: 'AUCHAN', level1: 'PRODUITS FRAIS', level2: 'CREMERIE', price: '4,99 &#x20AC;', quantity: 1 })}
  </section>
</div>
${RECEIPT('52,10 &#x20AC;')}
</body></html>
`;

describe('parseOrderDetailPage', () => {
  // ── Identifiants ───────────────────────────────────────────────────────────

  it('propage orderRef et orderNumber tels quels', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'AROM-761999631', '370069704');
    expect(d.orderRef).toBe('AROM-761999631');
    expect(d.orderNumber).toBe('370069704');
  });

  // ── Statut ────────────────────────────────────────────────────────────────

  it('extrait le statut courant', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.status).toBe('En cours de préparation');
  });

  it('extrait le statut "Retirée"', () => {
    const d = parseOrderDetailPage(RETIRED_HTML, 'R', '1');
    expect(d.status).toBe('Retirée');
  });

  // ── Créneau de retrait ────────────────────────────────────────────────────

  it('extrait le créneau de retrait sans son libellé', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.pickupSlot).toBe('mardi 16 juin entre 17h00 et 17h30');
  });

  it('pickupSlot est undefined quand la page ne l\'affiche pas', () => {
    const d = parseOrderDetailPage(RETIRED_HTML, 'R', '1');
    expect(d.pickupSlot).toBeUndefined();
  });

  // ── Magasin ────────────────────────────────────────────────────────────────

  it('extrait le nom du magasin', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.storeName).toBe('Auchan Drive Caluire');
  });

  it('extrait l\'adresse du magasin', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.storeAddress).toBe('10 Chemin Jean Petit 69300 CALUIRE-ET-CUIRE');
  });

  it('n\'extrait jamais l\'adresse de facturation du client', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.storeAddress).not.toContain('PARIS');
    expect(d.storeAddress).not.toContain('NOM');
  });

  // ── Total ─────────────────────────────────────────────────────────────────

  it('parse le total en centimes', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.total).toBe(3862);
  });

  it('conserve le total formaté', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.totalFormatted).toBe('38,62 €');
  });

  // ── Produits ──────────────────────────────────────────────────────────────

  it('retourne 3 produits au total', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products).toHaveLength(3);
  });

  it('extrait le nom du produit sans la marque', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].name).toBe('Chipolatas supérieures aux herbes');
  });

  it('extrait la marque du produit', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].brand).toBe('AUCHAN');
  });

  it('extrait la quantité', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].quantity).toBe(6);
    expect(d.products[1].quantity).toBe(1);
  });

  it('parse le prix en centimes', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].price).toBe(834);
  });

  it('conserve le prix formaté', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].priceFormatted).toBe('8,34 €');
  });

  // ── Catégories ────────────────────────────────────────────────────────────

  it('associe les produits à la bonne catégorie', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].category).toBe('Boucherie, volaille, poissonnerie');
    expect(d.products[1].category).toBe('Boucherie, volaille, poissonnerie');
    expect(d.products[2].category).toBe('Épicerie salée');
  });

  it('expose la taxonomie rayon du JSON embarqué', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].categoryPath).toEqual(['PRODUITS FRAIS', 'BOUCHERIE']);
    expect(d.products[2].categoryPath).toEqual(['EPICERIE', 'PATES']);
  });

  // ── Page vide ─────────────────────────────────────────────────────────────

  it('retourne un OrderDetail vide sur page sans produit', () => {
    const d = parseOrderDetailPage('<html><body></body></html>', 'REF', '000');
    expect(d.products).toEqual([]);
    expect(d.storeName).toBe('');
    expect(d.total).toBe(0);
  });
});
