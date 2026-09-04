/**
 * client.ts — Client HTTP Auchan Drive
 *
 * Orchestre :
 *   - Throttler  : sérialisation des requêtes + retry anti-DataDome
 *   - CookieProvider : auth cookie (relecture Chrome si 403)
 *   - parser.ts  : HTML search → SearchProduct[]
 *   - cart-mapper.ts : JSON GET /cart → Cart
 */

import type { CookieProvider, Cart, FavoriteProduct, OrderPeriod, OrderDetail } from '../types.js';
import { Throttler, RetryableError } from './throttle.js';
import { parseSearchResults, type SearchProduct } from './parser.js';
import { mapCart, extractCartId } from './cart-mapper.js';
import { parseLoyaltyPage, type LoyaltyInfo } from './loyalty-parser.js';
import { parseFavoritesPage } from './favorites-parser.js';
import { parseOrdersPage, type Order } from './orders-parser.js';
import { parseLoyaltyHistoryPage, type LoyaltyTransaction } from './loyalty-history-parser.js';
import { parseOrderDetailPage } from './order-detail-parser.js';

// ─── Types internes ───────────────────────────────────────────────────────────

interface HttpError extends Error { status: number; }

interface RawCartLine {
  id: string;
  productId: string;
  offerId: string;
  desiredQuantity: number;
  desiredType: string;
  offering?: {
    context?: {
      seller?: { id: string; type: string };
    };
  };
}

interface RawCartInner {
  id: string;
  items?: RawCartLine[];
}

interface RawCartResponse {
  cart?: { cart?: RawCartInner };
}

// ─── AuchanClient ─────────────────────────────────────────────────────────────

export class AuchanClient {
  constructor(
    private readonly cookieProvider: CookieProvider,
    private readonly throttler: Throttler,
    private readonly baseUrl = 'https://www.auchan.fr',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  // ── Requête HTTP de base (via throttler) ────────────────────────────────────

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    return this.throttler.run(() => this.perform(url, init));
  }

  /**
   * Requête HTML : le corps est lu *dans* la tâche throttlée, pour qu'une
   * réponse vide déclenche le backoff au lieu d'être rendue comme une page
   * sans résultat.
   */
  private async requestText(url: string, init: RequestInit = {}): Promise<string> {
    return this.throttler.run(async () => {
      const response = await this.perform(url, init);
      const text = await response.text();

      // Sous throttling, auchan.fr répond 200 avec un corps vide au lieu d'un 403.
      // Une page réelle fait toujours plusieurs dizaines de kilo-octets, y compris
      // une recherche sans résultat : un corps vide est un blocage, pas une absence
      // de produits. Sans ce test, les parsers rendent [] et le blocage est invisible.
      if (text.trim().length === 0) {
        this.cookieProvider.invalidate();
        throw new RetryableError(
          `Réponse vide sur ${url} — throttling anti-bot probable, nouvelle tentative.`,
        );
      }

      return text;
    });
  }

  /** Exécute la requête HTTP sans throttling ni retry (voir request/requestText). */
  private async perform(url: string, init: RequestInit = {}): Promise<Response> {
    const cookie = await this.cookieProvider.getCookie();
    const headers: Record<string, string> = {
      Cookie: cookie,
      'X-Requested-With': 'XMLHttpRequest',
      ...(init.headers as Record<string, string> | undefined),
    };

    const response = await this.fetchFn(url, { ...init, headers });

    if (!response.ok) {
      // 403 DataDome → invalider le cache de cookies pour le prochain retry
      if (response.status === 403) {
        this.cookieProvider.invalidate();
      }
      // Capture the response body to help diagnose unexpected errors (e.g. 404 on /boutique/promos)
      let body = '';
      try {
        const text = await response.clone().text();
        // Strip HTML tags and collapse whitespace for readability; cap at 300 chars
        body = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      } catch { /* ignore body read errors */ }
      const detail = body ? ` — ${body}` : '';
      const err = new Error(`HTTP ${response.status}: ${response.statusText}${detail} [url: ${url}]`) as HttpError;
      err.status = response.status;
      throw err;
    }

    return response;
  }

  // ── Extraction du consentId depuis le cookie header ─────────────────────────

  private extractConsentId(cookieHeader: string): string {
    const m = cookieHeader.match(/lark-consentId=([^;]+)/);
    return m?.[1] ?? '';
  }

  // ── GET /cart (raw JSON) — réutilisé par les mutations ─────────────────────

  private async getCartRaw(): Promise<RawCartResponse> {
    const response = await this.request(`${this.baseUrl}/cart`, {
      headers: { Accept: 'application/json' },
    });
    return response.json() as Promise<RawCartResponse>;
  }

  // ── API publique ────────────────────────────────────────────────────────────

  /** Recherche de produits dans le catalogue Drive. */
  async search(query: string): Promise<SearchProduct[]> {
    const html = await this.requestText(
      `${this.baseUrl}/recherche?text=${encodeURIComponent(query)}`,
      { headers: { Accept: 'text/html' } },
    );
    return parseSearchResults(html);
  }

  /** Recherche de produits en promotion sur le drive actif. */
  async searchPromos(query?: string, category?: string): Promise<SearchProduct[]> {
    const params = new URLSearchParams();
    if (query) params.set('text', query);
    if (category) params.set('category', category);
    const qs = params.toString();
    const url = `${this.baseUrl}/boutique/promos${qs ? `?${qs}` : ''}`;
    const html = await this.requestText(
      url,
      { headers: { Accept: 'text/html' } },
    );
    return parseSearchResults(html);
  }

  /** Lecture du panier courant. */
  async getCart(): Promise<Cart> {
    return mapCart(await this.getCartRaw());
  }

  /** Informations du programme de fidélité (cagnotte, carte, Jour W!, défis). */
  async getLoyaltyInfo(): Promise<LoyaltyInfo> {
    const html = await this.requestText(`${this.baseUrl}/fidelite/accueil`, {
      headers: { Accept: 'text/html' },
    });
    return parseLoyaltyPage(html);
  }

  /** Liste des produits favoris (achetés régulièrement) groupés par catégorie. */
  async getFavorites(): Promise<FavoriteProduct[]> {
    const html = await this.requestText(`${this.baseUrl}/client/mes-produits-preferes`, {
      headers: { Accept: 'text/html' },
    });
    return parseFavoritesPage(html);
  }

  /** Historique des commandes drive. */
  async getOrders(period: OrderPeriod = '3months'): Promise<Order[]> {
    const queryString = this.buildOrdersPeriodQuery(period);
    const html = await this.requestText(
      `${this.baseUrl}/client/mes-commandes?${queryString}`,
      { headers: { Accept: 'text/html' } },
    );
    return parseOrdersPage(html);
  }

  /** Détail complet d'une commande (produits, créneau de retrait, statut). */
  async getOrderDetail(orderRef: string, orderNumber: string): Promise<OrderDetail> {
    const html = await this.requestText(
      `${this.baseUrl}/client/mes-commandes/${orderRef}/${orderNumber}`,
      { headers: { Accept: 'text/html' } },
    );
    return parseOrderDetailPage(html, orderRef, orderNumber);
  }

  /** Convertit une période en query string pour l'API des commandes. */
  private buildOrdersPeriodQuery(period: OrderPeriod): string {
    switch (period) {
      case '10days':        return 'days=10';
      case '30days':        return 'days=30';
      case '3months':       return 'days=90';
      case '6months':       return 'days=180';
      case 'current_year':  return `year=${new Date().getFullYear()}`;
      case '2025':          return 'year=2025';
      case '2024':          return 'year=2024';
    }
  }


  /** Historique des transactions de cagnotte (3 derniers mois). */
  async getLoyaltyHistory(): Promise<LoyaltyTransaction[]> {
    const html = await this.requestText(`${this.baseUrl}/fidelite/ma-carte/historique`, {
      headers: { Accept: 'text/html' },
    });
    return parseLoyaltyHistoryPage(html);
  }

  /** Ajout d'un produit au panier (sans id — article nouveau). */
  async addToCart(
    productId: string,
    offerId: string,
    sellerId: string,
    sellerType: string,
    quantity = 1,
  ): Promise<Cart> {
    const [raw, cookie] = await Promise.all([
      this.getCartRaw(),
      this.cookieProvider.getCookie(),
    ]);

    const body = JSON.stringify({
      cartId: extractCartId(raw),
      items: [{
        productId,
        offerId,
        sellerId,
        sellerType,
        desiredQuantity: quantity,
        desiredType: 'DEFAULT',
      }],
      consentId: this.extractConsentId(cookie),
      reservationId: null,
      mbaAvailabilityNeeded: true,
    });

    const response = await this.request(`${this.baseUrl}/cart/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    const cart = mapCart(await response.json());

    // POST /cart/update repond 200 avec le panier inchange quand le produit est
    // en rupture sur le drive actif. Sans ce controle, l'ajout parait reussi et
    // l'article manque a la commande.
    if (!cart.items.some((item) => item.productId === productId)) {
      throw new Error(
        `Produit "${productId}" refuse par le panier - probablement en rupture sur le drive actif. `
        + 'Le panier est inchange.',
      );
    }

    return cart;
  }

  /** Mise à jour de la quantité d'un article déjà dans le panier. */
  async updateQuantity(productId: string, quantity: number): Promise<Cart> {
    if (quantity === 0) return this.removeFromCart(productId);

    const [raw, cookie] = await Promise.all([
      this.getCartRaw(),
      this.cookieProvider.getCookie(),
    ]);

    const line = this.findLine(raw, productId);
    const body = JSON.stringify({
      cartId: extractCartId(raw),
      items: [{
        id: line.id,
        productId,
        offerId: line.offerId,
        sellerId: line.offering?.context?.seller?.id ?? '',
        sellerType: line.offering?.context?.seller?.type ?? 'GROCERY',
        desiredQuantity: quantity,
        desiredType: 'DEFAULT',
      }],
      consentId: this.extractConsentId(cookie),
      reservationId: null,
      mbaAvailabilityNeeded: true,
    });

    const response = await this.request(`${this.baseUrl}/cart/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    return mapCart(await response.json());
  }

  /** Suppression d'un article du panier (desiredQuantity: 0). */
  async removeFromCart(productId: string): Promise<Cart> {
    const [raw, cookie] = await Promise.all([
      this.getCartRaw(),
      this.cookieProvider.getCookie(),
    ]);

    const line = this.findLine(raw, productId);
    const body = JSON.stringify({
      cartId: extractCartId(raw),
      items: [{
        id: line.id,
        productId,
        offerId: line.offerId,
        sellerId: line.offering?.context?.seller?.id ?? '',
        sellerType: line.offering?.context?.seller?.type ?? 'GROCERY',
        desiredQuantity: 0,
        desiredType: 'DEFAULT',
      }],
      consentId: this.extractConsentId(cookie),
      reservationId: null,
      mbaAvailabilityNeeded: true,
    });

    const response = await this.request(`${this.baseUrl}/cart/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    return mapCart(await response.json());
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private findLine(raw: RawCartResponse, productId: string): RawCartLine {
    const lines = raw?.cart?.cart?.items ?? [];
    const line = lines.find((l) => l.productId === productId);
    if (!line) throw new Error(`Product ${productId} not found in cart`);
    return line;
  }
}
