import { describe, it, expect } from 'vitest';
import { parseOrdersPage } from '../../../src/auchan/orders-parser.js';
import { PageShapeError, NotAuthenticatedError } from '../../../src/auchan/page-guard.js';

/**
 * Construit un <li class="t-orders__item"> reproduisant la structure réelle de
 * /client/mes-commandes. `extra` permet d'injecter du markup supplémentaire
 * (listes imbriquées, vignettes…) dans le pied de la carte.
 */
function order(opts: {
  ref: string;
  number: string;
  store: string;
  reference: string;
  status: string;
  count: string;
  total: string;
  extra?: string;
}): string {
  return `
  <li class="t-orders__item" data-fetch="/customer/async/orders/details/${opts.ref}/${opts.number}/false" data-renderer="customer-renderer">
    <div class="p-order">
      <div class="p-order__header">
        <div class="p-order__pointOfServiceAndReference">
          <div class="a-pointOfService">
            <i aria-hidden="true" class="a-pointOfService__icon icon-car"></i>
            <div class="a-pointOfService__infos">
              <span class="a-pointOfService__label">Retrait</span>
              <span class="a-pointOfService__place">${opts.store}</span>
            </div>
          </div>
          <div class="p-order__reference">${opts.reference}</div>
        </div>
        <div class="a-simplifiedState a-simplifiedState--light-grey">
          <span class="a-simplifiedState__label">${opts.status}</span>
        </div>
      </div>
      <div class="p-order__footer">
        <div class="p-order__footerLeft">
          <div class="p-order__thumbnailsAndTotalAmount">
            <div class="m-productThumbnails">
              <div class="m-productThumbnails__images"></div>
              <div class="m-productThumbnails__count"><span>${opts.count}</span> Produits</div>
            </div>
            <div class="p-order__totalAmount">${opts.total}</div>
          </div>
          ${opts.extra ?? ''}
        </div>
        <div class="p-order__footerRight">
          <a href="/client/mes-commandes/${opts.ref}/${opts.number}" class="btn btn--white btn--small">Voir le d&#xE9;tail</a>
        </div>
      </div>
    </div>
  </li>`;
}

const THREE_ORDERS_HTML = `
<html><body>
<ul class="t-orders__wrapper t-orders__wrapper__list">
${order({
  ref: 'AROM-761999631', number: '370069704', store: 'Auchan Drive Caluire',
  reference: 'Commande n&#xB0; 370069704 du 14 juin 2026', status: 'Enregistr&#xE9;e',
  count: '14', total: '38,62 &#x20AC;',
})}
${order({
  ref: 'AROM-123456789', number: '370000001', store: 'Auchan Drive Lyon Nord',
  reference: 'Commande n&#xB0; 370000001 du 2 mai 2026', status: 'Retir&#xE9;e',
  count: '7', total: '21,50 &#x20AC;',
})}
${order({
  ref: 'AROM-987654321', number: '369000002', store: 'Auchan Drive Caluire',
  reference: 'Commande n&#xB0; 369000002 du 10 avril 2026', status: 'Annul&#xE9;e',
  count: '3', total: '9,99 &#x20AC;',
})}
</ul>
</body></html>
`;

const SINGLE_ORDER_HTML = `
<html><body>
<ul class="t-orders__wrapper">
${order({
  ref: 'AROM-111111111', number: '400000001', store: 'Auchan Drive Paris Est',
  reference: 'Commande n&#xB0; 400000001 du 16 juin 2026', status: 'En cours de pr&#xE9;paration',
  count: '5', total: '15,00 &#x20AC;',
})}
</ul>
</body></html>
`;

// La carte contient une liste imbriquée : la découpe des blocs doit rester équilibrée.
const NESTED_LIST_HTML = `
<html><body>
<ul class="t-orders__wrapper">
${order({
  ref: 'AROM-222222222', number: '400000002', store: 'Auchan Drive Nantes',
  reference: 'Commande n&#xB0; 400000002 du 1 juillet 2026', status: 'Retir&#xE9;e',
  count: '9', total: '54,10 &#x20AC;',
  extra: '<ul class="m-productThumbnails__list"><li class="m-productThumbnails__image">vignette</li><li class="m-productThumbnails__image">vignette</li></ul>',
})}
</ul>
</body></html>
`;

// Cas réel : la liste est rendue avant que le résumé ne soit complété côté client.
const EMPTY_SUMMARY_HTML = `
<html><body>
<ul class="t-orders__wrapper">
${order({
  ref: 'AROM-333333333', number: '400000003', store: '',
  reference: 'Commande n&#xB0; 400000003 du 30 ao&#xFB;t 2026', status: 'Retir&#xE9;e',
  count: '0', total: '0.00 &#x20AC;',
})}
</ul>
</body></html>
`;

const EMPTY_HTML = `<html><body><ul class="t-orders__wrapper"></ul></body></html>`;

describe('parseOrdersPage', () => {
  // ── Liste de 3 commandes ────────────────────────────────────────────────────

  it('retourne 3 commandes depuis le HTML avec 3 entrées', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders).toHaveLength(3);
  });

  it('extrait orderRef correctement', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].orderRef).toBe('AROM-761999631');
    expect(orders[1].orderRef).toBe('AROM-123456789');
    expect(orders[2].orderRef).toBe('AROM-987654321');
  });

  it('extrait orderNumber correctement', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].orderNumber).toBe('370069704');
    expect(orders[1].orderNumber).toBe('370000001');
    expect(orders[2].orderNumber).toBe('369000002');
  });

  it('extrait la date correctement', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].date).toBe('14 juin 2026');
    expect(orders[1].date).toBe('2 mai 2026');
    expect(orders[2].date).toBe('10 avril 2026');
  });

  it('extrait le nom du magasin', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].storeName).toBe('Auchan Drive Caluire');
    expect(orders[1].storeName).toBe('Auchan Drive Lyon Nord');
  });

  it('extrait le statut', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].status).toBe('Enregistrée');
    expect(orders[1].status).toBe('Retirée');
    expect(orders[2].status).toBe('Annulée');
  });

  it('extrait le nombre de produits', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].productCount).toBe(14);
    expect(orders[1].productCount).toBe(7);
    expect(orders[2].productCount).toBe(3);
  });

  it('extrait le total en centimes', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].total).toBe(3862);
    expect(orders[1].total).toBe(2150);
    expect(orders[2].total).toBe(999);
  });

  it('extrait le total formaté', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].totalFormatted).toBe('38,62 €');
    expect(orders[1].totalFormatted).toBe('21,50 €');
    expect(orders[2].totalFormatted).toBe('9,99 €');
  });

  it('extrait l\'URL de détail', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].detailUrl).toBe('/client/mes-commandes/AROM-761999631/370069704');
    expect(orders[1].detailUrl).toBe('/client/mes-commandes/AROM-123456789/370000001');
  });

  // ── Statut "En cours de préparation" ───────────────────────────────────────

  it('parse le statut "En cours de préparation"', () => {
    const orders = parseOrdersPage(SINGLE_ORDER_HTML);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('En cours de préparation');
    expect(orders[0].orderRef).toBe('AROM-111111111');
    expect(orders[0].orderNumber).toBe('400000001');
    expect(orders[0].total).toBe(1500);
    expect(orders[0].productCount).toBe(5);
  });

  // ── Découpe des blocs ───────────────────────────────────────────────────────

  it('parse une commande contenant une liste imbriquée', () => {
    const orders = parseOrdersPage(NESTED_LIST_HTML);
    expect(orders).toHaveLength(1);
    expect(orders[0].orderRef).toBe('AROM-222222222');
    expect(orders[0].detailUrl).toBe('/client/mes-commandes/AROM-222222222/400000002');
    expect(orders[0].total).toBe(5410);
  });

  it('parse une commande dont le résumé est vide', () => {
    const orders = parseOrdersPage(EMPTY_SUMMARY_HTML);
    expect(orders).toHaveLength(1);
    expect(orders[0].orderNumber).toBe('400000003');
    expect(orders[0].date).toBe('30 août 2026');
    expect(orders[0].storeName).toBe('');
    expect(orders[0].productCount).toBe(0);
    expect(orders[0].total).toBe(0);
  });

  // ── Edge case : liste vide ──────────────────────────────────────────────────

  it('retourne [] pour une page sans commande', () => {
    const orders = parseOrdersPage(EMPTY_HTML);
    expect(orders).toEqual([]);
  });

  it('leve si le conteneur de la page est absent', () => {
    expect(() => parseOrdersPage('<html></html>')).toThrow(PageShapeError);
  });

  it('leve si la page est un ecran de connexion', () => {
    const login = '<html><head><title>Se connecter a auchan.fr</title></head><body>'
      + '<form action="https://compte.auchan.fr/auth/realms/auchan.fr/protocol/openid-connect/auth">'
      + '<input type="password" name="password"></form></body></html>';
    expect(() => parseOrdersPage(login)).toThrow(NotAuthenticatedError);
  });
});
