/**
 * loyalty-parser.ts — Parse le HTML de GET /fidelite/accueil
 * Même approche que parser.ts : regex sur le HTML brut, pas de cheerio/jsdom.
 */

import type { LoyaltyInfo } from '../types.js';
import { parsePrice, decode } from './html-utils.js';
import { assertAuthenticated, assertAnchor } from './page-guard.js';

export type { LoyaltyInfo };

/**
 * Parse la page « Mes avantages » du programme Waaoh!.
 *
 * Structure HTML attendue :
 * ```html
 * <article class="n-card cockpit__aside-card">
 *   <h2 class="waaoh-card__title">Hello, Prénom</h2>
 *   <p class="text-body-s">N° de compte Waaoh! : 1234567890</p>
 *   <p class="waaoh-card__reward-amount">232.89 €</p>
 *   <div class="waaoh-card__reward-expiry"><p>Jusqu’au 31/01/2027</p></div>
 *   <div class="waaoh-card__wallet"><p>Carte N° 9876543210</p></div>
 * </article>
 *
 * <article class="day-w-card">
 *   <h2>10% sur tous les produits frais des Halles</h2>
 *   <p>Mon jour W! : <strong>mercredi</strong></p>
 * </article>
 *
 * <article class="challenges-card">
 *   <div class="challenges-card__date-label"><p>Défis en cours</p><p>Jusqu’au 31/10/2026</p></div>
 *   <div class="challenges-card__amount"><p>0.00 €</p></div>
 * </article>
 * ```
 */
export function parseLoyaltyPage(html: string): LoyaltyInfo {
  assertAuthenticated(html, '/fidelite/accueil');
  // Présent même quand la cagnotte est vide et qu'aucun défi n'est en cours.
  assertAnchor(html, 'waaoh-card', '/fidelite/accueil');

  // ── Carte ─────────────────────────────────────────────────────────────────
  // "Carte N° 9876543210" dans le volet portefeuille.
  const cardNumber = textOf(html, 'waaoh-card__wallet').match(/N°\s*(\d+)/)?.[1] ?? '';

  // Le titulaire est salué : "Hello, Prénom".
  const holder = textOf(html, 'waaoh-card__title').replace(/^Hello,?\s*/i, '').trim();

  // ── Cagnotte principale ───────────────────────────────────────────────────
  const amountFormatted = textOf(html, 'waaoh-card__reward-amount') || '0,00 €';

  // La page n'affiche plus la date d'arrêté de la cagnotte, mais sa date
  // d'expiration : "Jusqu’au 31/01/2027". Les deux n'ont pas le même sens, on
  // ne réutilise donc pas balanceDate pour la loger.
  const expiryDate = textOf(html, 'waaoh-card__reward-expiry').match(/(\d{2}\/\d{2}\/\d{4})/)?.[1];

  // ── Numéro de compte Waaoh! ──────────────────────────────────────────────
  const waoohAccountNumber = html.match(/compte Waaoh!?\s*:\s*(\d+)/i)?.[1] ?? '';

  // ── Jour W! ───────────────────────────────────────────────────────────────
  // "Mon jour W! : <strong>mercredi</strong>"
  const jourWDay = html.match(/jour W!?\s*:\s*<strong>([^<]+)<\/strong>/i)?.[1]?.trim();
  const jourWBenefit = textOf(html, 'text-headline-xs', 'day-w-card') || undefined;

  // ── Défis Waaoh! ─────────────────────────────────────────────────────────
  const challengeFormatted = textOf(html, 'challenges-card__amount') || '0,00 €';

  // La date vit dans un second <p> du bloc, hors de la portée de textOf : on
  // cherche le motif dans la carte entière, décodée au préalable — l'apostrophe
  // typographique y est encodée en &#x2019; et ne matcherait pas telle quelle.
  const challengesCard = decode(blockOf(html, 'challenges-card'));
  const challengeDeadline = challengesCard.match(/Jusqu[’']au\s+(\d{2}\/\d{2}\/\d{4})/)?.[1];

  return {
    card: { number: cardNumber, holder },
    balance: {
      amountCents: parsePrice(amountFormatted),
      amountFormatted,
      balanceDate: '',
      expiryDate,
    },
    waoohAccountNumber,
    jourW: {
      // Un jour est sélectionné : l'avantage est actif.
      active: Boolean(jourWDay),
      day: jourWDay,
      benefit: jourWBenefit,
    },
    challenges: {
      cagnotteCents: parsePrice(challengeFormatted),
      cagnotteFormatted: challengeFormatted,
      deadline: challengeDeadline,
    },
  };
}

/**
 * Texte de l'élément portant `className`, balises internes retirées.
 * `within` restreint d'abord la recherche au bloc portant cette classe, pour
 * lever l'ambiguïté d'une classe utilitaire employée à plusieurs endroits.
 */
function textOf(html: string, className: string, within?: string): string {
  const scope = within ? blockOf(html, within) : html;

  // La classe est comparée comme un mot entier : "challenges-card__amount" ne
  // doit pas matcher "challenges-card__amount-label", qui porte le libellé.
  const m = scope.match(
    new RegExp(`class="(?:[^"]*\\s)?${className}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)<\\/`),
  );
  if (!m) return '';

  return decode(m[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Fenêtre de HTML démarrant à `marker`, assez large pour couvrir une carte. */
function blockOf(html: string, marker: string): string {
  const start = html.indexOf(marker);
  return start === -1 ? '' : html.slice(start, start + 4000);
}
