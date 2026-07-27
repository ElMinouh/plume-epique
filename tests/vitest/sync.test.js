// ═══════════════════════════════════════════════════════
// TESTS CIBLÉS — logique de synchro réelle (router.js : syncPush, syncPull,
// persistData, loadData, getKnownRemoteHash), avec un `fetch` mocké.
//
// Pourquoi un fichier et un contexte séparés du reste de la suite (voir
// tests/vitest/env.js) : router.js déclare ses propres `let db`/`cur`, qui
// entreraient en conflit avec ceux simulés dans harness-after.js (voir ce
// fichier et test-runner-env.js), et son `window.onload` démarrerait tout
// seul le système de profils en parallèle des tests s'il était chargé dans
// ce même contexte partagé. Chaque test ci-dessous recharge donc router.js
// dans son propre contexte jsdom tout neuf, avec un `fetch` mocké différent
// par scénario (succès, échec, conflit) — dette technique notée le
// 27/07/2026 (voir CONTEXTE_COMPLET_DU_PROJET.md, section 20).
//
// localStorage vient de jsdom (implémentation réelle, pas un mock) : les
// fonctions testées se comportent donc exactement comme dans un vrai
// navigateur. `idbStore` (router.js) reste `null` dans ces tests — c'est la
// branche localStorage qui est exercée, pas IndexedDB.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const JS_DIR = path.join(REPO_ROOT, 'js');

function readJs(name) { return fs.readFileSync(path.join(JS_DIR, name), 'utf8'); }

// Construit un contexte tout neuf : schema.js (fournit DEFAULT_DB, requis
// par router.js dès son chargement) puis router.js. `fetchImpl` est fourni
// par chaque test, pour simuler un Worker qui répond, qui échoue, ou qui
// renvoie une version différente (conflit).
function makeRouterContext(fetchImpl) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const context = dom.window;
  vm.createContext(context);

  // Mêmes polyfills que tests/vitest/env.js : jsdom ne fournit pas
  // crypto.subtle (utilisé par sha256Hex pour la détection de conflit).
  Object.defineProperty(context, 'crypto', { value: globalThis.crypto, configurable: true });
  context.Response = globalThis.Response;
  context.fetch = fetchImpl;
  // Espion sur toast() : router.js ne l'appelle que si elle existe
  // (`typeof toast === 'function'`) — permet de vérifier l'avertissement
  // affiché à l'utilisateur en cas de conflit, sans dépendre du DOM réel.
  context.toast = vi.fn();

  vm.runInContext(readJs('schema.js'), context, { filename: 'schema.js' });
  vm.runInContext(readJs('router.js'), context, { filename: 'router.js' });
  // router.js assigne window.onload à la fin de son chargement (bootstrap
  // complet de l'app, écran de connexion inclus) : neutralisé tout de suite,
  // avant le moindre `await`, sinon jsdom pourrait déclencher l'évènement
  // 'load' en parallèle des tests (même risque documenté dans
  // harness-before.js pour la suite partagée).
  context.onload = null;

  return context;
}

describe('Synchro réelle (router.js) — fetch mocké', () => {

  it('un envoi réussi met à jour l’empreinte connue et le statut de synchro', async () => {
    const fetchMock = vi.fn(async () => new Response('null', { status: 200 }));
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');

    await ctx.syncPush('doc_1', { titre: 'Chapitre 1' });

    expect(ctx.getLastSyncStatus().ok).toBe(true);
    expect(ctx.getKnownRemoteHash('doc_1')).toBeTruthy();
  });

  it('un envoi échoué (Worker injoignable) ne casse rien et ne met pas à jour l’empreinte', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('network error'); });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');

    // Ne doit jamais rejeter : syncPush() capture l'échec en interne (voir
    // le commentaire "hors-ligne ou Worker injoignable" dans router.js).
    await expect(ctx.syncPush('doc_1', { titre: 'Chapitre 1' })).resolves.toBeUndefined();

    expect(ctx.getLastSyncStatus().ok).toBe(false);
    expect(ctx.getKnownRemoteHash('doc_1')).toBeNull();
  });

  it('un conflit détecté (version distante différente) sauvegarde l’ancienne version et prévient l’utilisateur', async () => {
    const fetchMock = vi.fn(async (url, opts) => {
      if (opts && opts.method === 'PUT') return new Response('ok', { status: 200 });
      // Requête de vérification de conflit (GET implicite, voir syncPush) :
      // renvoie un contenu différent de l'empreinte connue ET de ce qu'on
      // s'apprête à écrire, pour forcer la détection.
      return new Response(JSON.stringify({ titre: 'Modifié depuis un autre appareil' }), { status: 200 });
    });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');
    // Empreinte connue arbitraire, simulant un envoi précédent réussi.
    ctx.setKnownRemoteHash('doc_2', 'empreinte-connue-perimee');

    await ctx.syncPush('doc_2', { titre: 'Nouveau contenu local' });

    // Vérification (GET) puis envoi (PUT) : les deux appels ont bien eu lieu.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // La version distante écrasée doit être sauvegardée localement (jamais
    // perdue), sous une clé 'plume_conflict_doc_2_<timestamp>'.
    const backupKeys = Object.keys(ctx.localStorage).filter(k => k.startsWith('plume_conflict_doc_2_'));
    expect(backupKeys.length).toBe(1);
    expect(JSON.parse(ctx.localStorage.getItem(backupKeys[0]))).toEqual({ titre: 'Modifié depuis un autre appareil' });
    // L'utilisateur est prévenu (voir toast(..., 'error') dans syncPush).
    expect(ctx.toast).toHaveBeenCalledWith(expect.stringContaining('autre appareil'), 'error');
  });

  it('persistData/loadData (sans IndexedDB) : ce qui est écrit est relu à l’identique', async () => {
    // Pas de clé de synchro configurée : syncPush() sort immédiatement (voir
    // `if (!syncKey) return;`) — fetch ne doit donc jamais être appelé ici.
    const fetchMock = vi.fn(() => { throw new Error('fetch ne devrait pas être appelé sans clé de synchro'); });
    const ctx = makeRouterContext(fetchMock);

    await ctx.persistData('doc_3', { titre: 'Test local' });
    const relu = await ctx.loadData('doc_3');

    expect(relu).toEqual({ titre: 'Test local' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
