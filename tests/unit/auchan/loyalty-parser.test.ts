import { describe, it, expect } from 'vitest';
import { parseLoyaltyPage } from '../../../src/auchan/loyalty-parser.js';
import { PageShapeError, NotAuthenticatedError } from '../../../src/auchan/page-guard.js';

/** Carte Waaoh! : titulaire, numéro de compte, cagnotte et date d'expiration. */
function waaohCard(opts: {
  holder: string;
  account: string;
  card: string;
  amount: string;
  expiry?: string;
}): string {
  return `
<article class="n-card n-card--white cockpit__aside-card">
  <header class="n-card__header">
    <h2 class="waaoh-card__title text-headline-s">Hello, ${opts.holder}</h2>
    <p class="text-body-s">N&#xB0; de compte Waaoh! : ${opts.account}</p>
  </header>
  <div class="n-card__content text-body-m">
    <article class="n-card waaoh-card waaoh-card--049">
      <div class="n-card__content text-body-m waaoh-card__content">
        <div class="waaoh-card__reward">
          <div class="waaoh-card__reward-infos">
            <h3 class="text-headline-xs">Ma cagnotte</h3>
            <p class="text-headline-m mt-s waaoh-card__reward-amount">${opts.amount}</p>
          </div>
          ${opts.expiry ? `<div class="waaoh-card__reward-expiry mt-s"><p>Jusqu&#x2019;au ${opts.expiry}</p></div>` : ''}
        </div>
      </div>
    </article>
    <div class="waaoh-card__menu">
      <div class="waaoh-card__wallet"><p>Carte N&#xB0; ${opts.card}</p></div>
    </div>
  </div>
</article>`;
}

/** Carte « Mon jour W! ». Absente quand aucun jour n'est sélectionné. */
const dayWCard = (day: string, benefit: string) => `
<article class="n-card n-card--has-aside day-w-card">
  <header class="n-card__header"><h2 class="text-headline-xs">${benefit}</h2></header>
  <div class="n-card__content text-body-m">
    <p>Mon jour W! : <strong>${day}</strong></p>
  </div>
</article>`;

/** Carte « Défis W! » : montant cagnotté et date de fin. */
const challengesCard = (amount: string, deadline: string) => `
<article class="n-card n-card--has-aside challenges-card">
  <header class="n-card__header"><h2 class="text-headline-xs">Jusqu&#x2019;&#xE0; 50 &#x20AC; cagnott&#xE9;s</h2></header>
  <footer class="n-card__footer challenges-card__footer">
    <div class="challenges-card__date-group">
      <div class="challenges-card__date-label">
        <p>D&#xE9;fis en cours</p>
        <p>Jusqu&#x2019;au ${deadline}</p>
      </div>
      <div class="challenges-card__progress"><p class="text-headline-m">10 / 10</p></div>
    </div>
    <div class="challenges-card__amount-group">
      <div class="challenges-card__amount-label"><p>Cagnotte</p><p>D&#xE9;fis Waaoh!</p></div>
      <div class="challenges-card__amount"><p class="text-headline-m">${amount}</p></div>
    </div>
  </footer>
</article>`;

const FULL_HTML = `
<html><body>
${waaohCard({ holder: 'Julien', account: '1234567890', card: '9876543210', amount: '232.89 &#x20AC;', expiry: '31/01/2027' })}
${dayWCard('mercredi', '10% sur tous les produits frais des Halles')}
${challengesCard('12.50 &#x20AC;', '31/10/2026')}
</body></html>
`;

// Compte sans jour W! choisi ni défi en cours : la carte reste rendue.
const PARTIAL_HTML = `
<html><body>
${waaohCard({ holder: 'Camille', account: '1111111111', card: '2222222222', amount: '0.00 &#x20AC;' })}
</body></html>
`;

describe('parseLoyaltyPage', () => {
  // ── Carte ──────────────────────────────────────────────────────────────────

  it('extrait le numéro de carte', () => {
    expect(parseLoyaltyPage(FULL_HTML).card.number).toBe('9876543210');
  });

  it('extrait le nom du titulaire sans la salutation', () => {
    expect(parseLoyaltyPage(FULL_HTML).card.holder).toBe('Julien');
  });

  it('extrait le numéro de compte Waaoh!', () => {
    expect(parseLoyaltyPage(FULL_HTML).waoohAccountNumber).toBe('1234567890');
  });

  // ── Cagnotte ───────────────────────────────────────────────────────────────

  it('extrait le montant de la cagnotte en centimes', () => {
    expect(parseLoyaltyPage(FULL_HTML).balance.amountCents).toBe(23289);
  });

  it('conserve le montant formaté', () => {
    expect(parseLoyaltyPage(FULL_HTML).balance.amountFormatted).toBe('232.89 €');
  });

  it('extrait la date d\'expiration de la cagnotte', () => {
    expect(parseLoyaltyPage(FULL_HTML).balance.expiryDate).toBe('31/01/2027');
  });

  it('balanceDate reste vide : la page ne l\'affiche plus', () => {
    expect(parseLoyaltyPage(FULL_HTML).balance.balanceDate).toBe('');
  });

  it('parse une cagnotte à zéro', () => {
    const info = parseLoyaltyPage(PARTIAL_HTML);
    expect(info.balance.amountCents).toBe(0);
    expect(info.balance.expiryDate).toBeUndefined();
  });

  // ── Jour W! ────────────────────────────────────────────────────────────────

  it('extrait le jour de la semaine du Jour W!', () => {
    expect(parseLoyaltyPage(FULL_HTML).jourW.day).toBe('mercredi');
  });

  it('extrait le bénéfice associé au Jour W!', () => {
    expect(parseLoyaltyPage(FULL_HTML).jourW.benefit).toBe('10% sur tous les produits frais des Halles');
  });

  it('Jour W! actif dès qu\'un jour est sélectionné', () => {
    expect(parseLoyaltyPage(FULL_HTML).jourW.active).toBe(true);
  });

  it('Jour W! inactif quand la carte est absente', () => {
    const jourW = parseLoyaltyPage(PARTIAL_HTML).jourW;
    expect(jourW.active).toBe(false);
    expect(jourW.day).toBeUndefined();
  });

  // ── Défis ──────────────────────────────────────────────────────────────────

  it('extrait la cagnotte des défis, pas son libellé', () => {
    // challenges-card__amount-label contient le mot "Cagnotte" et précède le
    // montant : une comparaison de classe en sous-chaîne remonterait le libellé.
    const challenges = parseLoyaltyPage(FULL_HTML).challenges;
    expect(challenges.cagnotteFormatted).toBe('12.50 €');
    expect(challenges.cagnotteCents).toBe(1250);
  });

  it('extrait la date de fin des défis', () => {
    expect(parseLoyaltyPage(FULL_HTML).challenges.deadline).toBe('31/10/2026');
  });

  it('retourne une cagnotte défis nulle quand la carte est absente', () => {
    const challenges = parseLoyaltyPage(PARTIAL_HTML).challenges;
    expect(challenges.cagnotteCents).toBe(0);
    expect(challenges.deadline).toBeUndefined();
  });

  // ── Gardes ─────────────────────────────────────────────────────────────────

  it('lève si le conteneur de la page est absent', () => {
    expect(() => parseLoyaltyPage('<html><body></body></html>')).toThrow(PageShapeError);
  });

  it('lève si la page est un écran de connexion', () => {
    const login = '<html><head><title>Se connecter à auchan.fr</title></head><body>'
      + '<form action="https://compte.auchan.fr/auth/realms/auchan.fr/protocol/openid-connect/auth">'
      + '<input type="password" name="password"></form></body></html>';
    expect(() => parseLoyaltyPage(login)).toThrow(NotAuthenticatedError);
  });
});
