// ═══════════════════════════════════════════════════════
// AUD-08 LOT 5 (v9.84.0) — SORTIE DES FENÊTRES (AUD-08-018) ET MANIFESTE PWA (AUD-08-024)
// (AUD-08-001, premier écran, annulé par le propriétaire le 16/10/2026)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('css/style.css'), html = read('index.html');
const IDS = ['my-profile-overlay', 'manage-profiles-overlay', 'search-overlay', 'gist-history-overlay', 'doc-trash-overlay', 'trash-overlay',
  'export-select-overlay', 'shortcuts-overlay', 'privacy-overlay', 'docx-import-overlay', 'library-system-overlay',
  'conflict-diff-overlay', 'confirm-modal-overlay', 'history-overlay'];

describe('AUD-08-018 — les fenêtres sortent en fondu', () => {
  const bloc = css.slice(css.indexOf('v9.84.0 (AUD-08-018)'));
  it('les 14 fenêtres existent dans index.html et figurent dans les deux règles (fermée / ouverte)', () => {
    for (const id of IDS) {
      expect(html).toContain('id="' + id + '"');
      expect(bloc).toMatch(new RegExp('#' + id + '[,{]'));
      expect(bloc).toContain('#' + id + '.active');
    }
    expect(bloc).toContain('visibility:hidden;opacity:0;pointer-events:none;transition:opacity var(--t-fast) var(--ease),visibility var(--t-fast) step-end;');
    expect(bloc).toContain('visibility:visible;opacity:1;pointer-events:auto;');
  });
  it('fermée, une fenêtre est invisible, inerte et hors de l\'ordre de tabulation (visibility:hidden)', () => {
    const fermee = bloc.match(/\{display:flex;visibility:hidden;opacity:0;pointer-events:none;/);
    expect(fermee).not.toBeNull();
  });
  it('les modes Focus et Lecture gardent leur mécanisme (display:none) et les fenêtres de l\'impression restent masquées', () => {
    expect(css).toContain('#focus-overlay{display:none;');
    expect(css).toContain('#reading-overlay{display:none;');
    expect(css).toContain('[id$="-overlay"]:not(#reading-overlay)');
    expect(bloc).not.toContain('#focus-overlay');
    expect(bloc).not.toContain('#reading-overlay');
  });
  it('prefers-reduced-motion supprime toujours les durées', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*transition-duration:\.01ms!important/);
  });
});

describe('AUD-08-024 — manifeste PWA', () => {
  const m = JSON.parse(read('manifest.json'));
  it('id, langue, catégories', () => {
    expect(m.id).toBe('./'); expect(m.lang).toBe('fr'); expect(m.dir).toBe('ltr');
    expect(m.categories).toEqual(expect.arrayContaining(['productivity', 'books']));
  });
  it('un raccourci « Nouveau projet » avec une icône existante', () => {
    const s = m.shortcuts[0];
    expect(s.name).toBe('Nouveau projet'); expect(s.url).toBe('./?action=nouveau');
    expect(fs.existsSync(path.join(ROOT, s.icons[0].src))).toBe(true);
  });
  it('les champs existants sont conservés (icônes maskable, couleurs, portée)', () => {
    expect(m.start_url).toBe('./'); expect(m.scope).toBe('./'); expect(m.display).toBe('standalone');
    expect(m.icons.some(i => i.purpose === 'maskable')).toBe(true);
  });
  it('le Service Worker retrouve la page en cache même avec ?action=… hors ligne', () => {
    expect(read('sw.js')).toContain("caches.match(event.request, { ignoreSearch: event.request.mode === 'navigate' })");
  });
  function app(search, library) {
    const src = read('js/library.js'), i = src.indexOf('let _shortcutAction'), j = src.indexOf('async function renderLibraryScreen');
    const calls = []; const timers = [];
    const ctx = vm.createContext({ location: { search, pathname: '/' }, history: { replaceState: (...a) => calls.push(a) },
      document: { body: { classList: { contains: c => c === 'library-mode' && library } } }, createNewDocument: () => calls.push('create'),
      setTimeout: f => timers.push(f), URLSearchParams });
    new vm.Script(src.slice(i, j)).runInContext(ctx);
    return { run: () => vm.runInContext('runPendingShortcut()', ctx), calls, timers };
  }
  it('?action=nouveau ouvre « Nouveau projet » une seule fois, sur la bibliothèque, et nettoie l\'adresse', () => {
    const a = app('?action=nouveau', true);
    a.run(); a.run();
    expect(a.timers.length).toBe(1);
    a.timers[0]();
    expect(a.calls).toEqual([[null, '', '/'], 'create']);
  });
  it('sans paramètre, ou hors bibliothèque, rien ne s\'ouvre', () => {
    const a = app('', true); a.run(); expect(a.timers.length).toBe(0);
    const b = app('?action=nouveau', false); b.run(); b.timers[0](); expect(b.calls.includes('create')).toBe(false);
  });
  it('renderLibraryScreen déclenche le raccourci', () => {
    const src = read('js/library.js');
    expect(src).toMatch(/renderLibraryShelf\(sorted\);\s*runPendingShortcut\(\);\s*\}/);
  });
});

// ───────── v9.84.1 — régression : fenêtres fermées (display:flex + visibility:hidden) prises pour des fenêtres ouvertes ─────────
describe('v9.84.1 — la page ne reste plus inerte derrière des fenêtres fermées', () => {
  const src = read('js/notifications.js');
  const i = src.indexOf('function _modalVisible'), body = src.slice(i, src.indexOf('\nfunction _modalApplyInert'));
  const visible = (rects, visibility) => {
    const ctx = vm.createContext({ getComputedStyle: () => ({ visibility }) });
    new vm.Script(body).runInContext(ctx);
    return vm.runInContext('_modalVisible({ getClientRects: () => ' + JSON.stringify(rects) + ' })', ctx);
  };
  it('une fenêtre sans boîte, ou en visibility:hidden, n\'est pas ouverte ; une fenêtre visible l\'est', () => {
    expect(visible([], 'visible')).toBe(false);
    expect(visible([1], 'hidden')).toBe(false);   // le cas de la v9.84.0 : fermée mais encore en display:flex
    expect(visible([1], 'visible')).toBe(true);
  });
  it('un second passage de synchronisation suit la fin du fondu de sortie (la visibilité ne change qu\'à ce moment)', () => {
    expect(src).toContain('_modalSync(); setTimeout(_modalSync, 240);');
    expect(src).toContain("document.addEventListener('transitionend'");
  });
});
