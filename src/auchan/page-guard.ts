/**
 * page-guard.ts — Détecte les pages qu'on ne sait pas parser, au lieu de rendre [].
 *
 * Les parsers étant des regex sur le HTML d'auchan.fr, ils retournent un tableau
 * vide dès que le markup change ou que la session a expiré. Rien ne distingue
 * alors « ce compte n'a pas de commande » de « je ne sais plus lire cette page ».
 * Ces deux gardes rendent l'échec explicite.
 */

/** Erreur levée quand la page reçue n'est pas celle attendue. */
export class PageShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageShapeError';
  }
}

/** Erreur levée quand la page reçue est un écran de connexion. */
export class NotAuthenticatedError extends Error {
  constructor(page: string) {
    super(
      `Non authentifié : ${page} a renvoyé une page de connexion. ` +
      'Connectez-vous à auchan.fr dans le navigateur dont les cookies sont lus ' +
      '(AUCHAN_BROWSER), puis relancez.',
    );
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Lève si la page est l'écran de connexion Keycloak servi par compte.auchan.fr.
 * Les pages du compte client y redirigent en 200, sans erreur HTTP.
 */
export function assertAuthenticated(html: string, page: string): void {
  const isLoginPage =
    /openid-connect\/auth/.test(html) ||
    /<title[^>]*>\s*Se connecter/i.test(html) ||
    (/type="password"/.test(html) && /realms\/auchan/.test(html));

  if (isLoginPage) throw new NotAuthenticatedError(page);
}

/**
 * Lève si le conteneur attendu est absent de la page.
 *
 * L'ancre est choisie pour exister même quand la liste est vide : une page de
 * commandes sans commande contient toujours son `t-orders__wrapper`. Un tableau
 * vide reste donc un résultat légitime, mais une ancre manquante signale que le
 * markup a changé.
 */
export function assertAnchor(html: string, anchor: string, page: string): void {
  if (html.includes(anchor)) return;

  throw new PageShapeError(
    `Structure inattendue sur ${page} : le conteneur "${anchor}" est absent. ` +
    'Le markup d\'auchan.fr a probablement changé — le parser doit être mis à jour.',
  );
}
