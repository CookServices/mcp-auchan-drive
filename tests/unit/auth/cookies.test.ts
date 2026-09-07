import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EnvCookieProvider,
  ChromeCookieProvider,
  createCookieProvider,
} from '../../../src/auth/cookies.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Crée un loader mocké qui retourne les cookies fournis. */
function makeLoader(cookies: Record<string, string>) {
  const getCookiesPromised = vi.fn().mockResolvedValue(cookies);
  const loader = vi.fn().mockResolvedValue({ getCookiesPromised });
  return { loader, getCookiesPromised };
}

// ─── EnvCookieProvider ────────────────────────────────────────────────────────

describe('EnvCookieProvider', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.AUCHAN_COOKIE;
    delete process.env.AUCHAN_COOKIE;
  });

  afterEach(() => {
    if (saved !== undefined) process.env.AUCHAN_COOKIE = saved;
    else delete process.env.AUCHAN_COOKIE;
  });

  it('getCookie() retourne la valeur de AUCHAN_COOKIE', async () => {
    process.env.AUCHAN_COOKIE = 'lark-session=abc; datadome=xyz; lark-consentId=uuid';
    const p = new EnvCookieProvider();
    await expect(p.getCookie()).resolves.toBe('lark-session=abc; datadome=xyz; lark-consentId=uuid');
  });

  it('getCookie() rejette si AUCHAN_COOKIE absent', async () => {
    const p = new EnvCookieProvider();
    await expect(p.getCookie()).rejects.toThrow('AUCHAN_COOKIE env var is not set');
  });

  it('invalidate() ne lève pas et getCookie() fonctionne après', async () => {
    process.env.AUCHAN_COOKIE = 'x=y';
    const p = new EnvCookieProvider();
    p.invalidate(); // synchrone, no-op
    await expect(p.getCookie()).resolves.toBe('x=y');
  });
});

// ─── ChromeCookieProvider ─────────────────────────────────────────────────────

const FULL_COOKIES = {
  'lark-session': 'sess1',
  'datadome': 'dd1',
  'lark-consentId': 'cid1',
  // Cookie de session applicative : son absence renvoyait les pages du compte
  // vers Keycloak, alors qu'il est bien présent dans le profil Chrome.
  'connect.sid': 'sid1',
};

describe('ChromeCookieProvider', () => {
  it('getCookie() retourne tous les cookies du domaine', async () => {
    const { loader } = makeLoader(FULL_COOKIES);
    const p = new ChromeCookieProvider('Default', loader);
    await expect(p.getCookie()).resolves.toBe(
      'lark-session=sess1; datadome=dd1; lark-consentId=cid1; connect.sid=sid1',
    );
  });

  it('transmet connect.sid, sans quoi les pages du compte redirigent vers la connexion', async () => {
    const { loader } = makeLoader(FULL_COOKIES);
    const p = new ChromeCookieProvider('Default', loader);
    await expect(p.getCookie()).resolves.toContain('connect.sid=sid1');
  });

  it('traduit un module natif manquant en message actionnable', async () => {
    // chrome-cookies-secure delegue le dechiffrement a win-dpapi / keytar,
    // dependances optionnelles dont l'absence ne se voit qu'a l'appel.
    const loader = vi.fn().mockResolvedValue({
      getCookiesPromised: vi.fn().mockRejectedValue(new Error("Cannot find module 'win-dpapi'")),
    });
    const p = new ChromeCookieProvider('Default', loader);

    await expect(p.getCookie()).rejects.toThrow(/win-dpapi/);
    await expect(p.getCookie()).rejects.toThrow(/AUCHAN_BROWSER=firefox/);
  });

  it('laisse passer les autres erreurs sans les reecrire', async () => {
    const loader = vi.fn().mockResolvedValue({
      getCookiesPromised: vi.fn().mockRejectedValue(new Error('EPERM: operation not permitted')),
    });
    const p = new ChromeCookieProvider('Default', loader);

    await expect(p.getCookie()).rejects.toThrow('EPERM: operation not permitted');
  });

  it('getCookie() appelle le loader une seule fois si appelé 2× (cache)', async () => {
    const { loader } = makeLoader(FULL_COOKIES);
    const p = new ChromeCookieProvider('Default', loader);
    await p.getCookie();
    await p.getCookie();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('invalidate() vide le cache : le loader est rappelé après', async () => {
    const { loader } = makeLoader(FULL_COOKIES);
    const p = new ChromeCookieProvider('Default', loader);
    await p.getCookie();
    p.invalidate();
    await p.getCookie();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('throw si datadome est absent', async () => {
    const { loader } = makeLoader({ 'lark-session': 's', 'lark-consentId': 'c' });
    const p = new ChromeCookieProvider('Default', loader);
    await expect(p.getCookie()).rejects.toThrow('datadome');
  });

  it('throw avec tous les cookies manquants listés', async () => {
    const { loader } = makeLoader({});
    const p = new ChromeCookieProvider('Default', loader);
    await expect(p.getCookie()).rejects.toThrow(
      'Missing required cookies: lark-session, datadome, lark-consentId',
    );
  });
});

// ─── createCookieProvider ─────────────────────────────────────────────────────

describe('createCookieProvider', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.AUCHAN_COOKIE; });
  afterEach(() => {
    if (saved !== undefined) process.env.AUCHAN_COOKIE = saved;
    else delete process.env.AUCHAN_COOKIE;
  });

  it('retourne EnvCookieProvider si AUCHAN_COOKIE défini', () => {
    process.env.AUCHAN_COOKIE = 'x=y';
    expect(createCookieProvider()).toBeInstanceOf(EnvCookieProvider);
  });

  it('retourne ChromeCookieProvider si AUCHAN_COOKIE absent et AUCHAN_BROWSER non défini', () => {
    delete process.env.AUCHAN_COOKIE;
    delete process.env.AUCHAN_BROWSER;
    expect(createCookieProvider()).toBeInstanceOf(ChromeCookieProvider);
  });
});
