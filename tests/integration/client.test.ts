import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuchanClient } from '../../src/auchan/client.js';
import { Throttler } from '../../src/auchan/throttle.js';
import type { CookieProvider } from '../../src/types.js';
import cartGetFixture from '../fixtures/cart-get-response.json' assert { type: 'json' };
import cartAddFixture from '../fixtures/cart-add-response.json' assert { type: 'json' };
import cartUpdateFixture from '../fixtures/cart-update-response.json' assert { type: 'json' };
import cartRemoveFixture from '../fixtures/cart-remove-response.json' assert { type: 'json' };

// HTML minimal simulant une page de résultats de recherche Auchan Drive
const SEARCH_HTML = `
<html><body>
<div class="quantity-selector"
  data-product-id="acfdc139-5da2-4e2c-b652-5687fa2932b1"
  data-offer-id="19f46dfd-f09f-5533-9958-a71f53c6adbb"
  data-seller-id="b42fbf5b-51d4-42d0-bad8-abe4e6963846"
  data-seller-type="GROCERY">
</div>
<p class="product-thumbnail__description">Beurre tendre doux 82%MG</p>
<article><strong>ELLE &amp; VIRE</strong></article>
<div class="product-price">2,98 €</div>
<span>11,92 € / kg</span>
<span class="product-attribute">250g</span>
<a href="/produit/pr-C1264653">voir</a>
</body></html>
`;

// Throttler sans délai pour les tests
function fastThrottler() {
  return new Throttler({ minIntervalMs: 0, jitterMs: 0, maxRetries: 3, backoffBaseMs: 0 });
}

// CookieProvider factice
function fakeCookies(cookie = 'lark-session=test; datadome=dd; lark-consentId=consent-uuid'): CookieProvider {
  return {
    getCookie: vi.fn().mockResolvedValue(cookie),
    invalidate: vi.fn(),
  };
}

// Construit un mock fetch retournant une réponse JSON
function mockFetchJson(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

// Construit un mock fetch retournant du HTML
function mockFetchHtml(html: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(html),
  } as Response);
}

// Construit un mock fetch qui échoue avec un status HTTP
function mockFetchError(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as Response);
}

// ── search ────────────────────────────────────────────────────────────────────

describe('AuchanClient.search', () => {
  it('retourne les produits parsés depuis le HTML de recherche', async () => {
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', mockFetchHtml(SEARCH_HTML));
    const results = await client.search('beurre');

    expect(results).toHaveLength(1);
    expect(results[0].productId).toBe('acfdc139-5da2-4e2c-b652-5687fa2932b1');
    expect(results[0].offerId).toBe('19f46dfd-f09f-5533-9958-a71f53c6adbb');
    expect(results[0].name).toBe('Beurre tendre doux 82%MG');
    expect(results[0].brand).toBe('ELLE & VIRE');
    expect(results[0].price).toBe(298);
    expect(results[0].pricePerKg).toBe(1192);
    expect(results[0].format).toBe('250g');
    expect(results[0].available).toBe(true);
  });

  it('retourne [] si la page ne contient aucun produit', async () => {
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', mockFetchHtml('<html><body>Aucun résultat</body></html>'));
    const results = await client.search('produitinexistant');
    expect(results).toEqual([]);
  });

  it('retente une reponse vide puis rend les produits', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve('') } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve(SEARCH_HTML) } as Response);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);

    const results = await client.search('beurre');

    expect(results).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('leve sur une reponse vide persistante au lieu de rendre []', async () => {
    // Sous throttling, auchan.fr repond 200 avec un corps vide : sans garde,
    // parseSearchResults('') rend [] et le blocage passe pour un catalogue vide.
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve(''),
    } as Response);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);

    await expect(client.search('beurre')).rejects.toThrow(/throttling anti-bot/);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('lève une erreur sur 403 après épuisement des retries', async () => {
    const fetch403 = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    } as Response);
    const cookies = fakeCookies();
    const client = new AuchanClient(cookies, fastThrottler(), 'https://www.auchan.fr', fetch403);

    await expect(client.search('beurre')).rejects.toThrow('HTTP 403');
    // invalidate() doit avoir été appelé à chaque tentative (4 = 1 + 3 retries)
    expect(cookies.invalidate).toHaveBeenCalledTimes(4);
  });

  it('ne retry pas sur une erreur 500 (non-retryable)', async () => {
    const fetch500 = mockFetchError(500);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetch500);

    await expect(client.search('beurre')).rejects.toThrow('HTTP 500');
    expect(fetch500).toHaveBeenCalledTimes(1);
  });
});

// ── getCart ───────────────────────────────────────────────────────────────────

describe('AuchanClient.getCart', () => {
  it('retourne le panier avec les articles et le total', async () => {
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', mockFetchJson(cartGetFixture));
    const cart = await client.getCart();

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].productId).toBe('d2b82432-fe6b-4d95-a52f-3a6a65150092');
    expect(cart.items[0].quantity).toBe(4);
    expect(cart.total).toBe(4354);
    expect(cart.itemCount).toBe(1);
  });

  it('retourne un panier vide si items est absent', async () => {
    const emptyCart = { cart: { cart: { id: 'x', prices: { totalPrice: { amount: 0 } }, items: [] } } };
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', mockFetchJson(emptyCart));
    const cart = await client.getCart();

    expect(cart.items).toHaveLength(0);
    expect(cart.total).toBe(0);
  });
});

// ── addToCart ─────────────────────────────────────────────────────────────────

describe('AuchanClient.addToCart', () => {
  it('POST /cart/update avec le bon body et retourne le panier mis à jour', async () => {
    // Premier appel : GET /cart, deuxième appel : POST /cart/update
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartAddFixture) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.addToCart(
      'acfdc139-5da2-4e2c-b652-5687fa2932b1',
      '19f46dfd-f09f-5533-9958-a71f53c6adbb',
      'b42fbf5b-51d4-42d0-bad8-abe4e6963846',
      'GROCERY',
      1,
    );

    expect(cart.items).toHaveLength(2);
    expect(cart.items[1].productId).toBe('acfdc139-5da2-4e2c-b652-5687fa2932b1');

    // Vérifier le body du POST
    const [, postInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.cartId).toBe('438e38d8-958a-4c66-93be-f4de245a9c98');
    expect(body.items[0].productId).toBe('acfdc139-5da2-4e2c-b652-5687fa2932b1');
    expect(body.items[0].desiredQuantity).toBe(1);
    expect(body.consentId).toBe('consent-uuid');
  });
});

// ── updateQuantity ────────────────────────────────────────────────────────────

describe('AuchanClient.updateQuantity', () => {
  it('met à jour la quantité d\'un article existant', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartUpdateFixture) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.updateQuantity('d2b82432-fe6b-4d95-a52f-3a6a65150092', 3);

    expect(cart.items[0].quantity).toBe(3);

    const [, postInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.items[0].desiredQuantity).toBe(3);
    // le champ id doit être présent pour un UPDATE
    expect(body.items[0].id).toBe('5797d20b-68cc-4484-a711-69f3b5e8893c');
  });

  it('appelle removeFromCart si quantity === 0', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartRemoveFixture) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.updateQuantity('d2b82432-fe6b-4d95-a52f-3a6a65150092', 0);

    expect(cart.items).toHaveLength(0);

    const [, postInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.items[0].desiredQuantity).toBe(0);
  });

  it('lève une erreur si le produit n\'est pas dans le panier', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(cartGetFixture),
    } as Response);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);

    await expect(client.updateQuantity('produit-inexistant', 2)).rejects.toThrow('not found in cart');
  });
});

// ── removeFromCart ────────────────────────────────────────────────────────────

describe('AuchanClient.removeFromCart', () => {
  it('supprime l\'article et retourne le panier vide', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartRemoveFixture) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.removeFromCart('d2b82432-fe6b-4d95-a52f-3a6a65150092');

    expect(cart.items).toHaveLength(0);
    expect(cart.total).toBe(0);

    const [, postInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.items[0].desiredQuantity).toBe(0);
    expect(body.items[0].id).toBe('5797d20b-68cc-4484-a711-69f3b5e8893c');
  });

  it('lève une erreur si le produit n\'est pas dans le panier', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(cartGetFixture),
    } as Response);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);

    await expect(client.removeFromCart('produit-absent')).rejects.toThrow('not found in cart');
  });
});

// ── getLoyaltyHistory ─────────────────────────────────────────────────────────

const LOYALTY_HISTORY_HTML = `
<html><body>
<table>
  <thead>
    <tr><th>Date</th><th>Canal</th><th>Magasin</th><th>Montant</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>04/06/2026</td>
      <td>Drive</td>
      <td>Auchan Drive Saint-Genis (Chapônost)</td>
      <td>+0,53</td>
    </tr>
    <tr>
      <td>01/06/2026</td>
      <td>Magasin</td>
      <td>Auchan Supermarché Lyon Garibaldi</td>
      <td>-2,00</td>
    </tr>
  </tbody>
</table>
</body></html>
`;

describe('AuchanClient.getLoyaltyHistory', () => {
  it('fetche /fidelite/ma-carte/historique et retourne les transactions parsées', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml(LOYALTY_HISTORY_HTML),
    );
    const history = await client.getLoyaltyHistory();

    expect(history).toHaveLength(2);
    expect(history[0].date).toBe('04/06/2026');
    expect(history[0].channel).toBe('Drive');
    expect(history[0].storeName).toBe('Auchan Drive Saint-Genis (Chapônost)');
    expect(history[0].amountCents).toBe(53);
    expect(history[0].amountFormatted).toBe('+0,53 €');
    expect(history[1].amountCents).toBe(-200);
    expect(history[1].amountFormatted).toBe('-2,00 €');
  });

  it('appelle bien GET /fidelite/ma-carte/historique', async () => {
    const fetchFn = mockFetchHtml(LOYALTY_HISTORY_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getLoyaltyHistory();

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/fidelite/ma-carte/historique');
  });

  it('retourne un tableau vide si la page ne contient aucune transaction', async () => {
    const emptyHtml = '<html><body><table><tbody></tbody></table></body></html>';
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml(emptyHtml),
    );
    const history = await client.getLoyaltyHistory();
    expect(history).toEqual([]);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getLoyaltyHistory()).rejects.toThrow('HTTP 403');
  });
});

// ── searchPromos ──────────────────────────────────────────────────────────────

describe('AuchanClient.searchPromos', () => {
  it('retourne les produits en promo sans argument (GET /boutique/promos)', async () => {
    const fetchFn = mockFetchHtml(SEARCH_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const results = await client.searchPromos();

    expect(results).toHaveLength(1);
    expect(results[0].productId).toBe('acfdc139-5da2-4e2c-b652-5687fa2932b1');
    expect(results[0].name).toBe('Beurre tendre doux 82%MG');
    expect(results[0].price).toBe(298);
    expect(results[0].available).toBe(true);

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/boutique/promos');
  });

  it('passe le paramètre text quand query est fournie', async () => {
    const fetchFn = mockFetchHtml(SEARCH_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.searchPromos('café');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/boutique/promos?text=caf%C3%A9');
  });

  it('passe le paramètre category quand category est fournie', async () => {
    const fetchFn = mockFetchHtml(SEARCH_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.searchPromos(undefined, 'ca-n02');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/boutique/promos?category=ca-n02');
  });

  it('passe query et category ensemble', async () => {
    const fetchFn = mockFetchHtml(SEARCH_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.searchPromos('beurre', 'ca-n01');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/boutique/promos?text=beurre&category=ca-n01');
  });

  it('retourne [] si la page ne contient aucun produit', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body>Aucune promo</body></html>'),
    );
    const results = await client.searchPromos();
    expect(results).toEqual([]);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.searchPromos()).rejects.toThrow('HTTP 403');
  });
});

// ── getLoyaltyInfo ────────────────────────────────────────────────────────────

const LOYALTY_HTML = `
<html><body>
<div class="o-cardSelector__cardNumberAndName">
  <div class="o-cardSelector__cardNumber">N° <strong>0000000000000</strong></div>
  <div class="o-cardSelector__cardName">DOE John</div>
</div>
<div class="t-myLoyalty__amount o-loyaltyMyCard__amount">
  <div class="o-loyaltyMyCard__row">
    <span>Ma cagnotte au 04/06/2026</span>
    <span class="a-waaohTag a-waaohTag--xlarge a-waaohTag--transparent">3,46 €</span>
  </div>
</div>
<div class="-waaohAccountID">Mon numéro de compte Waooh : 00000000</div>
<div class="m-discountClubBox">
  <div class="m-discountClubBox__title -waaoh">Votre jour W! est activé !</div>
  <div class="m-discountClubBox__title -noBold">
    Chaque <strong>mercredi</strong>, vous bénéficiez de
    <strong>10 % cagnottés sur tous les produits frais des Halles*</strong>
  </div>
</div>
<section class="t-myLoyalty__section t-myLoyalty__section--challenges">
  <div><strong>Jusqu’au 30 juin 2026</strong>, profitez des Défis Waaoh.</div>
  <div class="a-waaohChallengeTag">
    Cagnotte Défis Waaoh
    <span class="a-waaohChallengeTag__amount">0,00 €</span>
  </div>
</section>
</body></html>
`;

describe('AuchanClient.getLoyaltyInfo', () => {
  it('fetche /fidelite/accueil et retourne les informations de fidélité parsées', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml(LOYALTY_HTML),
    );
    const info = await client.getLoyaltyInfo();

    expect(info.card.number).toBe('0000000000000');
    expect(info.card.holder).toBe('DOE John');
    expect(info.balance.amountCents).toBe(346);
    expect(info.balance.amountFormatted).toBe('3,46 €');
    expect(info.balance.balanceDate).toBe('04/06/2026');
    expect(info.waoohAccountNumber).toBe('00000000');
    expect(info.jourW.active).toBe(true);
    expect(info.jourW.day).toBe('mercredi');
    expect(info.challenges.cagnotteCents).toBe(0);
    expect(info.challenges.deadline).toBe('30 juin 2026');
  });

  it('appelle bien GET /fidelite/accueil', async () => {
    const fetchFn = mockFetchHtml(LOYALTY_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getLoyaltyInfo();

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/fidelite/accueil');
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getLoyaltyInfo()).rejects.toThrow('HTTP 403');
  });
});

// ── getFavorites ──────────────────────────────────────────────────────────────

const FAVORITES_HTML = `
<html><body>
<div class="wishlist__content">
  <article class="product-thumbnail product-thumbnail--column" data-id="uuid-orangina" data-list="frequent_products">
    <a class="product-thumbnail__details-wrapper" href="/orangina-boisson-gazeuse-a-l-orange/pr-C1820950">
      <p class="product-thumbnail__description">Boisson gazeuse à l'orange</p>
      <div class="product-thumbnail__attributes">
        <span class="product-attribute">1,5l</span>
        <span data-seller-type="GROCERY">1,29€ / l</span>
      </div>
    </a>
    <footer class="product-thumbnail__footer">
      <div class="discount-markups"><span class="product-discount-label">-50% sur le 2ème</span></div>
      <div class="product-price">1,93 €</div>
      <div class="quantity-selector" data-product-id="uuid-orangina" data-stock="21" data-disable-button="false"></div>
    </footer>
  </article>
  <script>
    const productUpdateDetail = {"product":{"name":"Boisson gazeuse à l'orange","id":{"digital":"uuid-orangina","ref_fo":"C1820950"},"availability":{"status":true},"category":{"level1":"BOISSONS","level2":"BOISSONS SANS ALCOOL"},"brand":{"internal":false,"name":"ORANGINA"}}};
  </script>
  <article class="product-thumbnail product-thumbnail--column" data-id="uuid-panzani" data-list="frequent_products">
    <a class="product-thumbnail__details-wrapper" href="/panzani-pates-spaghetti/pr-C9876543">
      <p class="product-thumbnail__description">Pâtes spaghetti</p>
      <div class="product-thumbnail__attributes">
        <span class="product-attribute">500g</span>
      </div>
    </a>
    <footer class="product-thumbnail__footer">
      <div class="product-price">1,20 €</div>
      <div class="quantity-selector" data-product-id="uuid-panzani" data-stock="0" data-disable-button="true"></div>
    </footer>
  </article>
  <script>
    const productUpdateDetail = {"product":{"name":"Pâtes spaghetti","id":{"digital":"uuid-panzani","ref_fo":"C9876543"},"availability":{"status":false},"category":{"level1":"EPICERIE","level2":"PATES"},"brand":{"internal":false,"name":"PANZANI"}}};
  </script>
</div>
</body></html>
`;

describe('AuchanClient.getFavorites', () => {
  it('fetche /client/mes-produits-preferes et retourne les favoris parsés', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml(FAVORITES_HTML),
    );
    const favorites = await client.getFavorites();

    expect(favorites).toHaveLength(2);
    expect(favorites[0].name).toBe("Boisson gazeuse à l'orange");
    expect(favorites[0].brand).toBe('ORANGINA');
    expect(favorites[0].category).toBe('BOISSONS');
    expect(favorites[0].price).toBe(193);
    expect(favorites[0].priceFormatted).toBe('1,93 €');
    expect(favorites[0].pricePerUnit).toBe('1,29€ / l');
    expect(favorites[0].promo).toBe('-50% sur le 2ème');
    expect(favorites[0].productCode).toBe('C1820950');
    expect(favorites[0].available).toBe(true);

    expect(favorites[1].name).toBe('Pâtes spaghetti');
    expect(favorites[1].available).toBe(false);
  });

  it('appelle bien GET /client/mes-produits-preferes', async () => {
    const fetchFn = mockFetchHtml(FAVORITES_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getFavorites();

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-produits-preferes');
  });

  it('retourne [] quand le compte na aucun favori', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body><div class="wishlist__content"></div></body></html>'),
    );
    const favorites = await client.getFavorites();
    expect(favorites).toEqual([]);
  });

  it('leve si la page recue nest pas celle des favoris', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body>Connectez-vous</body></html>'),
    );
    await expect(client.getFavorites()).rejects.toThrow(/Structure inattendue/);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getFavorites()).rejects.toThrow('HTTP 403');
  });
});

// ── getOrders ─────────────────────────────────────────────────────────────────

const ORDERS_HTML = `
<html><body>
<ul class="t-orders__wrapper t-orders__wrapper__list">
  <li class="t-orders__item" data-fetch="/customer/async/orders/details/AROM-761999631/370069704/false">
    <div class="p-order">
      <div class="p-order__header">
        <div class="a-pointOfService">
          <div class="a-pointOfService__infos">
            <span class="a-pointOfService__label">Retrait</span>
            <span class="a-pointOfService__place">Auchan Drive Caluire</span>
          </div>
        </div>
        <div class="p-order__reference">Commande n° 370069704 du 14 juin 2026</div>
        <div class="a-simplifiedState"><span class="a-simplifiedState__label">Enregistrée</span></div>
      </div>
      <div class="p-order__footer">
        <div class="m-productThumbnails__count"><span>14</span> Produits</div>
        <div class="p-order__totalAmount">38,62 €</div>
        <a href="/client/mes-commandes/AROM-761999631/370069704" class="btn">Voir le détail</a>
      </div>
    </div>
  </li>
  <li class="t-orders__item" data-fetch="/customer/async/orders/details/AROM-123456789/370000001/false">
    <div class="p-order">
      <div class="p-order__header">
        <div class="a-pointOfService">
          <div class="a-pointOfService__infos">
            <span class="a-pointOfService__label">Retrait</span>
            <span class="a-pointOfService__place">Auchan Drive Lyon Nord</span>
          </div>
        </div>
        <div class="p-order__reference">Commande n° 370000001 du 2 mai 2026</div>
        <div class="a-simplifiedState"><span class="a-simplifiedState__label">Retirée</span></div>
      </div>
      <div class="p-order__footer">
        <div class="m-productThumbnails__count"><span>7</span> Produits</div>
        <div class="p-order__totalAmount">21,50 €</div>
        <a href="/client/mes-commandes/AROM-123456789/370000001" class="btn">Voir le détail</a>
      </div>
    </div>
  </li>
</ul>
</body></html>
`;

describe('AuchanClient.getOrders', () => {
  it('fetche /client/mes-commandes?days=90 par défaut et retourne les commandes parsées', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const orders = await client.getOrders();

    expect(orders).toHaveLength(2);
    expect(orders[0].orderRef).toBe('AROM-761999631');
    expect(orders[0].orderNumber).toBe('370069704');
    expect(orders[0].date).toBe('14 juin 2026');
    expect(orders[0].storeName).toBe('Auchan Drive Caluire');
    expect(orders[0].status).toBe('Enregistrée');
    expect(orders[0].productCount).toBe(14);
    expect(orders[0].total).toBe(3862);
    expect(orders[0].totalFormatted).toBe('38,62 €');
    expect(orders[0].detailUrl).toBe('/client/mes-commandes/AROM-761999631/370069704');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?days=90');
  });

  it('fetche ?days=10 pour la période "10days"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('10days');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?days=10');
  });

  it('fetche ?days=30 pour la période "30days"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('30days');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?days=30');
  });

  it('fetche ?days=180 pour la période "6months"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('6months');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?days=180');
  });

  it('fetche ?year=2025 pour la période "2025"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('2025');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?year=2025');
  });

  it('fetche ?year=2024 pour la période "2024"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('2024');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?year=2024');
  });

  it('retourne [] quand la periode ne contient aucune commande', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body><ul class="t-orders__wrapper"></ul></body></html>'),
    );
    const orders = await client.getOrders();
    expect(orders).toEqual([]);
  });

  it('leve si la page recue nest pas celle des commandes', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body><ul></ul></body></html>'),
    );
    await expect(client.getOrders()).rejects.toThrow(/Structure inattendue/);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getOrders()).rejects.toThrow('HTTP 403');
  });
});

// ── getOrderDetail ────────────────────────────────────────────────────────────

const ORDER_DETAIL_HTML = `
<html><body>
<div class="p-detail__header">
  <div class="p-detail__pointOfService">
    <div class="a-pointOfService">
      <div class="a-pointOfService__infos">
        <span class="a-pointOfService__label">Drive</span>
        <span class="a-pointOfService__place">Auchan Drive Caluire</span>
      </div>
    </div>
  </div>
  <div class="p-detail__simplifiedState">
    <div class="a-simplifiedState"><span class="a-simplifiedState__label">Enregistrée</span></div>
  </div>
</div>
<div class="p-detail__addressesAndDelivery">
  <div class="p-detail__deliveryModeAndDate">
    <div class="p-detail__deliveryDate">Retrait prévu le: mardi 16 juin entre 17h00 et 17h30</div>
  </div>
  <div class="p-detail__address">
    <strong>Magasin</strong>
    Auchan Drive Caluire<br>
    10 Chemin Jean Petit<br>
    69300 CALUIRE-ET-CUIRE
  </div>
</div>
<section class="o-products__list">
  <div class="o-products__category" role="heading">Boucherie, volaille, poissonnerie</div>
  <div class="o-products__line m-productItem" role="list">
    <article class="product-thumbnail m-productItem__product" data-id="uuid-chipo">
      <a class="product-thumbnail__details-wrapper" href="/auchan-chipolatas/pr-C1000010">
        <p class="product-thumbnail__description">Chipolatas supérieures aux herbes</p>
      </a>
    </article>
    <script>
      const productUpdateDetail = {"product":{"name":"Chipolatas supérieures aux herbes","id":{"digital":"uuid-chipo","ref_fo":"C1000010"},"availability":{"status":true},"category":{"level1":"PRODUITS FRAIS","level2":"BOUCHERIE"},"brand":{"internal":true,"name":"AUCHAN"}}};
    </script>
    <aside class="m-productItem__aside">
      <div class="a-amount"><div class="a-amount__amount">8,34 €</div></div>
      <div class="p-detail__productQuantity">Quantité : 6</div>
    </aside>
  </div>
</section>
<div class="m-receipt__total m-receipt__line">
  <span class="m-receipt__label">Total</span>
  <strong class="m-receipt__value">38,62 €</strong>
</div>
</body></html>
`;

describe('AuchanClient.getOrderDetail', () => {
  it('fetche /client/mes-commandes/{ref}/{num} et retourne le détail parsé', async () => {
    const fetchFn = mockFetchHtml(ORDER_DETAIL_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const detail = await client.getOrderDetail('AROM-761999631', '370069704');

    expect(detail.orderRef).toBe('AROM-761999631');
    expect(detail.orderNumber).toBe('370069704');
    expect(detail.storeName).toBe('Auchan Drive Caluire');
    expect(detail.status).toBe('Enregistrée');
    expect(detail.pickupSlot).toBe('mardi 16 juin entre 17h00 et 17h30');
    expect(detail.total).toBe(3862);
    expect(detail.products).toHaveLength(1);
    expect(detail.products[0].name).toBe('Chipolatas supérieures aux herbes');
    expect(detail.products[0].quantity).toBe(6);

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes/AROM-761999631/370069704');
  });

  it('retourne un OrderDetail vide sur une commande sans produit', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body><section class="p-detail"></section></body></html>'),
    );
    const detail = await client.getOrderDetail('REF', '000');
    expect(detail.products).toEqual([]);
    expect(detail.storeName).toBe('');
  });

  it('leve si la page recue nest pas celle du detail', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body></body></html>'),
    );
    await expect(client.getOrderDetail('REF', '000')).rejects.toThrow(/Structure inattendue/);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getOrderDetail('REF', '000')).rejects.toThrow('HTTP 403');
  });
});
