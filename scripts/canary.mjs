#!/usr/bin/env node
/**
 * canary.mjs — Détecte une rupture du parsing avant qu'elle ne gêne l'usage.
 *
 * Le markup d'auchan.fr a changé entre juin et septembre 2026 et a cassé trois
 * parsers en silence : les tools rendaient des listes vides sans erreur, et la
 * suite de tests restait verte parce qu'elle s'appuie sur des fixtures. Ce
 * script vérifie les mêmes invariants contre le site réel.
 *
 * Conçu pour tourner sans surveillance : silencieux quand tout va bien, sortie
 * non nulle et rapport détaillé sinon.
 *
 * Prérequis :
 *   - npm run build (dist/ doit exister)
 *   - Être connecté à Auchan Drive dans le navigateur lu (AUCHAN_BROWSER)
 *     OU renseigner AUCHAN_COOKIE
 *
 * Usage :
 *   npm run canary              # silencieux sauf échec
 *   npm run canary -- --verbose # détaille chaque contrôle
 *
 * Sortie : 0 si tout passe, 1 si un contrôle échoue.
 * Journal : canary.log à la racine du dépôt (une ligne par exécution).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuchanClient } from '../dist/auchan/client.js';
import { Throttler } from '../dist/auchan/throttle.js';
import { createCookieProvider } from '../dist/auth/cookies.js';

const verbose = process.argv.includes('--verbose');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logFile = path.join(repoRoot, 'canary.log');

const results = [];

/** Enregistre le résultat d'un contrôle. `skipped` n'est pas un échec. */
function record(name, status, detail) {
  results.push({ name, status, detail });
  if (verbose || status === 'FAIL') {
    const mark = status === 'PASS' ? '  ok  ' : status === 'SKIP' ? ' skip ' : ' FAIL ';
    console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Exécute un contrôle et transforme toute exception en échec nommé. */
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, detail === SKIP ? 'SKIP' : 'PASS', detail === SKIP ? 'rien à vérifier' : detail);
  } catch (err) {
    record(name, 'FAIL', err instanceof Error ? err.message : String(err));
  }
}

const SKIP = Symbol('skip');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Contrôles ────────────────────────────────────────────────────────────────

const client = new AuchanClient(createCookieProvider(), new Throttler());

// Un terme volontairement banal : s'il ne remonte rien, c'est le parsing ou
// l'accès qui est cassé, pas le catalogue.
await check('recherche produit', async () => {
  const results = await client.search('beurre');
  assert(results.length > 0, 'aucun résultat pour "beurre" — parsing ou accès cassé');

  const named = results.filter((p) => p.name.trim().length > 0);
  assert(named.length > 0, `${results.length} produits mais aucun nom extrait`);

  const priced = results.filter((p) => p.price > 0);
  assert(priced.length > 0, 'aucun prix extrait');

  const classified = results.filter((p) => (p.categoryPath ?? []).length > 0);
  assert(classified.length > 0, 'aucune taxonomie rayon — le JSON embarqué n\'est plus lu');

  return `${results.length} produits, ${named.length} nommés, ${classified.length} classés`;
});

let latestOrder;

await check('historique des commandes', async () => {
  const orders = await client.getOrders('6months');
  if (orders.length === 0) return SKIP; // compte sans commande récente : légitime

  const [first] = orders;
  assert(first.orderRef.length > 0, 'orderRef vide');
  assert(first.orderNumber.length > 0, 'orderNumber vide');
  assert(first.date.length > 0, 'date vide');
  latestOrder = first;

  return `${orders.length} commandes, dernière du ${first.date}`;
});

await check('détail de commande', async () => {
  if (!latestOrder) return SKIP;

  const detail = await client.getOrderDetail(latestOrder.orderRef, latestOrder.orderNumber);
  assert(detail.products.length > 0, 'commande sans aucune ligne produit');
  assert(detail.storeName.length > 0, 'nom du magasin vide');

  const named = detail.products.filter((p) => p.name.trim().length > 0);
  assert(named.length === detail.products.length, 'des lignes produit sans nom');

  // Le bloc "Adresse de facturation" ne doit jamais être extrait à la place du magasin.
  assert(!/facturation/i.test(detail.storeAddress), 'adresse de facturation extraite par erreur');

  return `${detail.products.length} produits, ${detail.totalFormatted}`;
});

await check('produits favoris', async () => {
  const favorites = await client.getFavorites();
  if (favorites.length === 0) return SKIP;

  const named = favorites.filter((f) => f.name.trim().length > 0);
  assert(named.length === favorites.length, 'des favoris sans nom');

  const priced = favorites.filter((f) => f.price > 0);
  assert(priced.length > 0, 'aucun prix sur les favoris');

  return `${favorites.length} favoris`;
});

await check('lecture du panier', async () => {
  const cart = await client.getCart();
  assert(Array.isArray(cart.items), 'panier illisible');
  return `${cart.itemCount} articles, ${(cart.total / 100).toFixed(2)} €`;
});

// ── Rapport ──────────────────────────────────────────────────────────────────

const failures = results.filter((r) => r.status === 'FAIL');
const stamp = new Date().toISOString();
const summary = failures.length === 0
  ? `OK ${results.filter((r) => r.status === 'PASS').length}/${results.length}`
  : `ECHEC ${failures.length}/${results.length} : ${failures.map((f) => f.name).join(', ')}`;

try {
  fs.appendFileSync(logFile, `${stamp}  ${summary}\n`, 'utf-8');
} catch { /* le journal ne doit jamais faire échouer le canari */ }

if (failures.length > 0) {
  console.error(`\nCanari auchan-drive — ${failures.length} contrôle(s) en échec (${stamp})`);
  for (const f of failures) console.error(`  - ${f.name} : ${f.detail}`);

  // Distinguer les deux causes : une session expirée se règle en se reconnectant,
  // un markup modifié demande de corriger les parsers.
  const authExpired = failures.some((f) => /non authentifi/i.test(f.detail));
  console.error(authExpired
    ? '\nCause probable : session expirée. Reconnectez-vous à auchan.fr dans le navigateur lu.'
    : '\nCause probable : le markup du site a changé. Voir scripts/canary.mjs.');

  process.exit(1);
}

if (verbose) console.log(`\n${summary}`);
process.exit(0);
