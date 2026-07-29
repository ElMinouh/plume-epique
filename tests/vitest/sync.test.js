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

  // v8.1.0 — l'arbitrage des conflits a changé de camp : au lieu d'une
  // vérification préalable côté client (qui ne savait pas distinguer une
  // version plus récente d'une réponse périmée — cause de l'incident du
  // 27/07/2026), c'est le serveur qui refuse désormais toute écriture ne se
  // basant pas sur la version courante (409). Le client relit alors, sauvegarde
  // la version qu'il s'apprête à remplacer, et prévient l'utilisateur.
  // v9.3.0 — Ce test documentait l'ANCIEN comportement : après un refus, le
  // client relisait puis FORÇAIT quand même sa version locale (`puts` valait
  // 2). C'est exactement le défaut qui faisait qu'un appareil resté en
  // arrière écrasait le travail fait ailleurs (incident du 29/07/2026) — voir
  // tests/vitest/sync-conflict-arbitration.test.js pour le scénario complet.
  //
  // Le nouveau comportement distingue trois cas selon une empreinte de la
  // base commune (classifySyncDivergence() dans router.js). Ici, aucune
  // synchronisation n'a encore eu lieu pour cette clé dans ce test : la base
  // commune est inconnue, donc — par prudence — traité comme un VRAI conflit
  // à arbitrer, plutôt que de risquer d'écraser le travail de quelqu'un.
  it('un refus du serveur (409) sans base commune connue est traité comme un vrai conflit : mis en pause, sauvegardé, sans rien écraser', async () => {
    let puts = 0;
    const fetchMock = vi.fn(async (url, opts) => {
      if (opts && opts.method === 'PUT') {
        puts++;
        // Le serveur détient une version différente de celle annoncée.
        return new Response(JSON.stringify({ error: { message: 'périmé' }, serverVersion: 7 }), {
          status: 409, headers: { 'Content-Type': 'application/json', 'X-Plume-Version': '7' }
        });
      }
      // Relecture consécutive au refus.
      return new Response(JSON.stringify({ titre: 'Modifié depuis un autre appareil' }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'X-Plume-Version': '7' }
      });
    });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');

    await ctx.syncPush('doc_2', { titre: 'Nouveau contenu local' });

    // Un seul envoi (celui refusé) : plus de second envoi qui forcerait la
    // version locale — c'est précisément ce qui empêche l'écrasement.
    expect(puts).toBe(1);
    // La version distante est tout de même sauvegardée localement (jamais
    // perdue), sous une clé 'plume_conflict_doc_2_<timestamp>'.
    const backupKeys = Object.keys(ctx.localStorage).filter(k => k.startsWith('plume_conflict_doc_2_'));
    expect(backupKeys.length).toBe(1);
    expect(JSON.parse(ctx.localStorage.getItem(backupKeys[0]))).toEqual({ titre: 'Modifié depuis un autre appareil' });
    // L'utilisateur est prévenu qu'un arbitrage est nécessaire...
    expect(ctx.toast).toHaveBeenCalledWith(expect.stringContaining('deux appareils'), 'error');
    // ...et la synchronisation de CETTE clé est mise en pause dans l'attente
    // de sa décision (les autres clés continuent de se synchroniser).
    expect(ctx.isConflictPaused('doc_2')).toBe(true);
    // Le numéro de version du serveur est mémorisé même sans rien renvoyer :
    // on sait désormais où il en est, pour le prochain arbitrage.
    expect(ctx.getSyncVersion('doc_2')).toBe(7);
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

  it('un envoi échoué ajoute la clé à la file d’attente persistée (survit à un rechargement)', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('network error'); });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');

    await ctx.syncPush('doc_4', { titre: 'Chapitre en échec' });

    expect(ctx.getPendingSyncKeys()).toEqual(['doc_4']);
  });

  it('la file d’attente retente les clés en échec et les retire une fois réussies', async () => {
    // La 1ʳᵉ tentative échoue (mémorisée dans la file), la 2ᵉ (simulant le
    // passage du délai de backoff) réussit.
    let shouldFail = true;
    const fetchMock = vi.fn(async () => {
      if (shouldFail) throw new TypeError('network error');
      return new Response('null', { status: 200 });
    });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');
    // Contenu local déjà écrit (comme le ferait persistData), pour que
    // retryPendingSyncs() ait bien quelque chose à relire et à repousser.
    ctx.localStorage.setItem('plume_doc_5', JSON.stringify({ titre: 'Contenu local' }));
    await ctx.syncPush('doc_5', { titre: 'Contenu local' }); // échoue, ajoute à la file
    expect(ctx.getPendingSyncKeys()).toEqual(['doc_5']);

    shouldFail = false;
    await ctx.retryPendingSyncs(); // simule le déclenchement du minuteur de backoff

    expect(ctx.getPendingSyncKeys()).toEqual([]);
    expect(ctx.getKnownRemoteHash('doc_5')).toBeTruthy();
  });

  it('la file d’attente oublie une clé dont le contenu local a été supprimé entre-temps', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('network error'); });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');
    ctx.localStorage.setItem('plume_doc_6', JSON.stringify({ titre: 'Sera supprimé' }));
    await ctx.syncPush('doc_6', { titre: 'Sera supprimé' }); // échoue, ajoute à la file
    expect(ctx.getPendingSyncKeys()).toEqual(['doc_6']);

    ctx.localStorage.removeItem('plume_doc_6'); // suppression locale entre-temps
    await ctx.retryPendingSyncs();

    expect(ctx.getPendingSyncKeys()).toEqual([]);
  });

});
