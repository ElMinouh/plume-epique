// ═══════════════════════════════════════════════════════
// AUD-06 LOT 6 (v9.68.0) — VIE PRIVÉE ET CONFORMITÉ (AUD-06-014, 015) ; 008 ANNULÉ par le propriétaire (12/10/2026)
// Consentement refusable aux services externes ; effacement serveur d'un profil supprimé (VRAI Worker, VRAIE base
// SQLite) ; page de confidentialité.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEY = 'cle-de-synchro-de-test';
const tok = seed => crypto.createHash('sha256').update('jeton|' + seed).digest('hex');
const who = id => ({ id, token: tok(id) });
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001', BOB = 'bbbbbbbb-0000-4000-8000-000000000002', EVE = 'eeeeeeee-0000-4000-8000-000000000003';
const entry = (id, name, role = 'user') => ({ id, name, role, wrapPwd: 'w' });

describe('014 — consentement aux services externes', () => {
  const src = read('js/profiles.js');
  const bloc = src.slice(src.indexOf('async function notifyThirdPartyDataUseOnce'), src.indexOf('function showAiPrivacyNotice') > 0 ? src.indexOf('// ── ÉCRAN 0') : undefined);
  function charger(profil, reponseModale) {
    const toasts = [], modales = [], saved = [];
    const ctx = vm.createContext({
      _currentProfile: profil, _currentProfileId: 'p1', Promise, console,
      toast: (m, t) => toasts.push([m, t]),
      showConfirmModal: vi.fn(async opts => { modales.push(opts); return reponseModale; }),
      mutateProfilesIndex: async fn => { const idx = { profiles: [{ id: 'p1', name: 'Alice' }] }; fn(idx); saved.push(idx.profiles[0]); }
    });
    vm.runInContext(bloc + '\nthis.notify = notifyThirdPartyDataUseOnce; this.setChoice = setExternalServicesChoice;', ctx);
    return { ctx, toasts, modales, saved };
  }
  it('aucun choix : écran Accepter / Refuser (même si l\'ancienne notice avait été vue) ; Accepter → permis et mémorisé', async () => {
    const { ctx, modales, saved } = charger({ id: 'p1', seenThirdPartyNoticeV2: true }, true);
    expect(await ctx.notify()).toBe(true);
    expect(modales).toHaveLength(1);
    expect(modales[0]).toMatchObject({ confirmLabel: 'Accepter', cancelLabel: 'Refuser' });
    expect(modales[0].message).toMatch(/dictée vocale/);
    expect(saved[0].externalServices).toBe('yes');
    expect(ctx._currentProfile.externalServices).toBe('yes');
  });
  it('Refuser → rien n\'est permis, le refus est mémorisé, un message explique où changer', async () => {
    const { ctx, toasts, saved } = charger({ id: 'p1' }, false);
    expect(await ctx.notify()).toBe(false);
    expect(saved[0].externalServices).toBe('no');
    expect(toasts.some(t => /aucun texte n'est envoyé/.test(t[0]))).toBe(true);
  });
  it('choix déjà fait : « yes » passe sans rien demander ; « no » refuse sans rien demander, avec le message', async () => {
    const oui = charger({ id: 'p1', externalServices: 'yes' }, false);
    expect(await oui.ctx.notify()).toBe(true);
    expect(oui.modales).toHaveLength(0);
    const non = charger({ id: 'p1', externalServices: 'no' }, true);
    expect(await non.ctx.notify()).toBe(false);
    expect(non.modales).toHaveLength(0);
    expect(non.toasts[0][0]).toMatch(/Mon profil → Services externes/);
  });
  it('réglage de Mon profil : « Me demander » efface le choix', async () => {
    const { ctx, saved } = charger({ id: 'p1', externalServices: 'no' }, true);
    await ctx.setChoice('');
    expect(saved[0].externalServices).toBeUndefined();
    expect(ctx._currentProfile.externalServices).toBeUndefined();
  });
  it('sans profil ouvert : comportement d\'avant (permis), jamais bloquant pour les tests ni l\'usage hors profil', async () => {
    const { ctx } = charger(null, false);
    expect(await ctx.notify()).toBe(true);
  });
  it('TOUS les appelants s\'arrêtent quand l\'envoi est refusé (IA ×5, mémoire, lexique, roman graphique, correcteur, dictée)', () => {
    const attendu = { 'js/ai.js': 5, 'js/memory.js': 1, 'js/panels.js': 1, 'js/graphicnovel.js': 1, 'js/pluginSystem.js': 1, 'js/tts.js': 1 };
    for (const [f, n] of Object.entries(attendu)) {
      const t = read(f);
      const garde = (t.match(/!\(await notifyThirdPartyDataUseOnce\(\)\)/g) || []).length;
      expect(garde, f).toBe(n);
      expect(t, f).not.toMatch(/^\s*await notifyThirdPartyDataUseOnce\(\);/m); // plus d'appel dont on ignore la réponse
    }
  });
  it('le réglage existe dans Mon profil, avec les trois valeurs', () => {
    const html = read('index.html');
    expect(html).toContain('id="mp-external-services"');
    expect(html).toMatch(/<option value="">Me demander/);
    expect(html).toMatch(/<option value="yes">Autorisés/);
    expect(html).toMatch(/<option value="no">Refusés/);
    expect(src).toContain("document.getElementById('mp-external-services')");
  });
  it('la fenêtre de confirmation accepte un libellé « Refuser » et le remet à « Annuler » ensuite', () => {
    const n = read('js/notifications.js');
    expect(n).toContain('cancelLabel');
    expect(n).toContain("textContent = cancelLabel || 'Annuler'");
    expect(n).toContain("cancelBtn.textContent = 'Annuler'");
  });
});

describe('015 — effacement des données d\'un profil supprimé (Worker)', () => {
  function makeServer() {
    const d1 = new FakeD1();
    const env = { SYNC_KEY: KEY, DB: d1 };
    const worker = new Function(read('worker/sync-worker.js').replace('export default', 'return'))();
    let n = 0;
    const call = (key, { method = 'GET', body, base, as } = {}) => worker.fetch(new Request('https://s.test/?key=' + key, {
      method, body, headers: {
        Authorization: 'Bearer ' + KEY, 'CF-Connecting-IP': '10.3.0.' + (++n % 250),
        ...(base !== undefined ? { 'X-Plume-Base-Version': String(base) } : {}),
        ...(as ? { 'X-Plume-Profile-Id': as.id, 'X-Plume-Profile-Token': as.token } : {})
      }
    }), env);
    const editIndex = async (as, mutate) => {
      const g = await call('profiles'); const v = g.headers.get('X-Plume-Version'); const idx = JSON.parse(await g.text());
      mutate(idx); return call('profiles', { method: 'PUT', body: JSON.stringify(idx), base: v, as });
    };
    return { d1, call, editIndex };
  }
  // Administrateur + Bob (avec manuscrits, historique, réglages, image) ; Eve = autre profil, à ne pas toucher.
  async function installation(s) {
    await s.call('profiles', { method: 'PUT', body: JSON.stringify({ profiles: [entry(ADMIN, 'Alice', 'admin')] }), base: 0 });
    await s.call('data_' + ADMIN, { method: 'PUT', body: '"d"', base: 0, as: who(ADMIN) });
    await s.editIndex(who(ADMIN), i => { i.profiles.push(entry(BOB, 'Bob')); i.profiles.push(entry(EVE, 'Eve')); });
    for (const id of [BOB, EVE]) {
      for (const k of ['data_' + id, 'doclist_' + id, 'libsettings_' + id, 'doc_' + id + '_m1', 'doc_' + id + '_m2', 'aichat_' + id + '_m1', 'img_' + id + '_m1_i1']) {
        expect((await s.call(k, { method: 'PUT', body: '"' + k + '"', base: 0, as: who(id) })).status, k).toBe(200);
      }
    }
  }
  const supprimerBob = (s, as = who(ADMIN)) => s.editIndex(as, i => { i.profiles = i.profiles.filter(p => p.id !== BOB); i.deletedProfiles = [{ id: BOB, at: Date.now() }]; });

  it('l\'administrateur efface TOUT le profil supprimé en une opération ; les autres profils ne sont pas touchés', async () => {
    const s = makeServer(); await installation(s);
    expect((await supprimerBob(s)).status).toBe(200);
    const r = await s.call('profile_' + BOB, { method: 'DELETE', as: who(ADMIN) });
    expect(r.status).toBe(200);
    expect((await r.json()).erased).toBe(7);
    const restant = s.d1.db.prepare("SELECT k FROM sync_meta WHERE k LIKE '%" + BOB + "%'").all();
    expect(restant).toEqual([]);
    expect(s.d1.db.prepare('SELECT COUNT(*) AS n FROM sync_chunks WHERE k LIKE ?').get('%' + BOB + '%').n).toBe(0);
    expect(s.d1.db.prepare('SELECT pid FROM profile_auth WHERE pid = ?').get(BOB)).toBeUndefined();
    expect(await (await s.call('doc_' + EVE + '_m1', { as: who(EVE) })).text()).toBe('"doc_' + EVE + '_m1"'); // Eve intacte
    expect(s.d1.db.prepare("SELECT COUNT(*) AS n FROM sync_meta WHERE k LIKE '%" + EVE + "%'").get().n).toBe(7);
  });
  it('refusé : profil NON marqué supprimé, appelant non administrateur, sans jeton, jeton faux, propre profil', async () => {
    const s = makeServer(); await installation(s);
    expect((await s.call('profile_' + BOB, { method: 'DELETE', as: who(ADMIN) })).status).toBe(403); // pas supprimé dans la liste
    await supprimerBob(s);
    for (const as of [undefined, who(EVE), who(BOB), { id: ADMIN, token: tok('faux') }]) {
      expect((await s.call('profile_' + BOB, { method: 'DELETE', as })).status).toBe(403);
    }
    expect((await s.call('profile_' + ADMIN, { method: 'DELETE', as: who(ADMIN) })).status).toBe(403); // l'administrateur n'est pas supprimé
    expect(s.d1.db.prepare("SELECT COUNT(*) AS n FROM sync_meta WHERE k LIKE '%" + BOB + "%'").get().n).toBe(7); // rien n'a été effacé
  });
  it('la clé d\'effacement n\'accepte que DELETE (jamais lire ni écrire)', async () => {
    const s = makeServer(); await installation(s);
    expect((await s.call('profile_' + BOB, { as: who(ADMIN) })).status).toBe(405);
    expect((await s.call('profile_' + BOB, { method: 'PUT', body: '"x"', base: 0, as: who(ADMIN) })).status).toBe(405);
  });
  it('un appareil resté en retard ne fait pas renaître un profil supprimé (écritures refusées, code « profile-deleted »)', async () => {
    const s = makeServer(); await installation(s);
    await supprimerBob(s);
    await s.call('profile_' + BOB, { method: 'DELETE', as: who(ADMIN) });
    for (const as of [who(BOB), undefined]) {
      const r = await s.call('data_' + BOB, { method: 'PUT', body: '"revenu"', base: 0, as });
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe('profile-deleted');
    }
    expect(s.d1.db.prepare("SELECT COUNT(*) AS n FROM sync_meta WHERE k LIKE '%" + BOB + "%'").get().n).toBe(0);
  });
  it('même une simple LECTURE avec un jeton ne re-verrouille pas un profil supprimé (régression constatée au test réel local)', async () => {
    const s = makeServer(); await installation(s);
    await supprimerBob(s);
    await s.call('profile_' + BOB, { method: 'DELETE', as: who(ADMIN) });
    const lecture = await s.call('doclist_' + BOB, { as: who(BOB) });
    expect(lecture.status).toBe(403);
    expect((await lecture.json()).error.code).toBe('profile-deleted');
    expect(s.d1.db.prepare('SELECT pid FROM profile_auth WHERE pid = ?').get(BOB)).toBeUndefined();
    const ecriture = await s.call('data_' + BOB, { method: 'PUT', body: '"revenu"', base: 0, as: who(BOB) });
    expect(ecriture.status).toBe(403);
    expect(s.d1.db.prepare("SELECT COUNT(*) AS n FROM sync_meta WHERE k LIKE '%" + BOB + "%'").get().n).toBe(0);
  });
  it('un profil NON supprimé garde l\'écriture normale (le contrôle ne gêne personne)', async () => {
    const s = makeServer(); await installation(s);
    expect((await s.call('doc_' + EVE + '_m9', { method: 'PUT', body: '"neuf"', base: 0, as: who(EVE) })).status).toBe(200);
  });
});

describe('015 — client : suppression de profil et page de confidentialité', () => {
  const p = read('js/profiles.js');
  it('adminDeleteProfile n\'écrit plus dans les données d\'un autre profil ; il efface via l\'opération dédiée, après la pierre tombale', () => {
    const f = p.slice(p.indexOf('async function adminDeleteProfile'), p.indexOf('// v9.68.0 (audit AUD-06-015) — EFFACEMENT'));
    expect(f).not.toMatch(/persistData\(docDataKey|persistData\('data_'|cleanupDocumentSideData/);
    expect(f.indexOf('deletedProfiles')).toBeLessThan(f.indexOf('eraseProfileOnServer(pid)'));
    expect(f).toMatch(/syncPush\('profiles'/);
    expect(f).toMatch(/données du serveur de synchronisation/);
  });
  it('l\'effacement est repris à la connexion de l\'administrateur s\'il n\'a pas pu aboutir (hors ligne)', () => {
    expect(p).toContain('plume_pending_profile_erase');
    expect(p).toMatch(/retryPendingProfileErases\(\); \/\/ v9\.68\.0/);
  });
  it('page de confidentialité : accessible depuis l\'aide, fermable, texte honnête (ce qui n\'est PAS chiffré, services tiers, durées, droits, usage prévu)', () => {
    const html = read('index.html');
    const page = html.slice(html.indexOf('id="privacy-overlay"'), html.indexOf('AIDE-MÉMOIRE DES RACCOURCIS'));
    expect(html).toContain('id="help-privacy-policy-btn"');
    expect(page).toContain('id="privacy-close-btn"');
    for (const mot of ['personnel et familial', 'Ne sont pas chiffrés', 'titres des manuscrits', 'Google Gemini', 'LanguageTool', 'dictée vocale', '30 jours', '7 jours', 'Vos droits', 'Effacement', 'mineurs', 'Rester connecté']) expect(page, mot).toContain(mot);
    const r = read('js/router.js');
    expect(r).toContain("byId('privacy-overlay', () => closePrivacyPolicy())");
    expect(r).toContain("help-privacy-policy-btn");
  });
  it('la page est aussi accessible depuis la BIBLIOTHÈQUE (menu Aide, bureau et mobile), pas seulement depuis l\'éditeur', () => {
    const html = read('index.html'), lib = read('js/library.js');
    expect(html).toContain('id="library-privacy-policy-btn"');
    expect(html).toContain('id="ltop-privacy-policy"');
    expect(lib).toContain("getElementById('library-privacy-policy-btn').addEventListener('click', openPrivacyPolicy)");
    expect(lib).toContain("getElementById('ltop-privacy-policy').addEventListener('click'");
    expect(lib).toContain("getElementById('privacy-close-btn').addEventListener('click', closePrivacyPolicy)");
  });
  it('un profil supprimé est signalé à l\'appareil concerné (403 « profile-deleted »)', () => {
    expect(read('js/router.js')).toMatch(/profile-deleted'\) onProfileDeleted\(\)/);
  });
});

describe('015 — la fenêtre de confidentialité est une vraie fenêtre (régression 9.68.1 : sans CSS elle restait affichée à la suite de la page)', () => {
  const css = read('css/style.css');
  it('#privacy-overlay est masquée par défaut et affichée par .active, comme les autres fenêtres (position fixe, au-dessus de tout)', () => {
    expect(css).toMatch(/#shortcuts-overlay,#privacy-overlay,[^{]*\{display:none;position:fixed;inset:0;z-index:8500;/);
    expect(css).toMatch(/#shortcuts-overlay\.active,#privacy-overlay\.active,[^{]*\{display:flex;\}/);
  });
  it('chaque fenêtre « overlay » de l\'aide a ses règles CSS (les deux sélecteurs partagent les mêmes lignes)', () => {
    for (const sel of ['#shortcuts-overlay', '#privacy-overlay']) {
      expect(css.split(sel + ',').length - 1 + css.split(sel + '.active').length - 1, sel).toBeGreaterThanOrEqual(4);
    }
  });
  it('la fenêtre porte les attributs d\'une fenêtre modale (rôle, aria-modal, nom) et un bouton Fermer', () => {
    const html = read('index.html');
    expect(html).toMatch(/<div id="privacy-overlay" role="dialog" aria-modal="true" aria-label="Politique de confidentialité">/);
    expect(html).toContain('id="privacy-close-btn"');
  });
});
