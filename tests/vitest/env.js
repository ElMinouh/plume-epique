// ═══════════════════════════════════════════════════════
// CHARGEUR D'ENVIRONNEMENT — reconstitue exactement ce que faisait
// tests/test-runner.html (mêmes fichiers, même ordre de chargement), mais
// via Node + jsdom + le module vm, pour pouvoir tourner sous Vitest.
//
// Pourquoi un vm.createContext plutôt que jsdom seul : l'app entière est
// écrite en scripts globaux classiques (pas de modules, pas d'export), avec
// un état mutable partagé au niveau global (`let db`, `let cur`, etc.) —
// exactement comme plusieurs <script> dans une page. vm.createContext()
// reproduit ce comportement : chaque fichier chargé via runInContext()
// rejoint le MÊME environnement lexical partagé, comme le ferait une
// vraie balise <script> dans un navigateur. C'est ce qui permet à
// suite.js (le contenu de test porté) de lire/modifier `db`/`cur`
// exactement comme le faisait l'ancien test-runner.js.
// ═══════════════════════════════════════════════════════
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const JS_DIR = path.join(REPO_ROOT, 'js');

const BASE_HTML = `<!DOCTYPE html><html><head></head><body>
  <div id="results"></div>
  <div id="summary"></div>
  <div id="profile-gate" class="hidden"></div>
  <div id="manage-profiles-list" class="hidden"></div>
  <div id="toast" class="hidden"></div>
  <div id="confirm-modal-overlay" class="hidden">
    <strong id="confirm-modal-title"></strong>
    <p id="confirm-modal-message"></p>
    <div id="confirm-modal-input-wrap" class="hidden">
      <label id="confirm-modal-input-label"></label>
      <input id="confirm-modal-input">
    </div>
    <button id="confirm-modal-cancel-btn"></button>
    <button id="confirm-modal-confirm-btn"></button>
  </div>
</body></html>`;

// Même ordre que tests/test-runner.html.
const FILES_BEFORE_ENV = ['schema.js', 'crypto.js', 'diff.js', 'profiles.js', 'library.js'];
const FILES_AFTER_ENV = [
  'readability.js', 'relations.js', 'snapshots.js', 'export-format-utils.js',
  'timeline.js', 'wordcloud.js', 'panels.js', 'notifications.js', 'pluginSystem.js',
  'findreplace.js', 'memory.js', 'database.js', 'editor.js', 'stats.js', 'pwa.js'
];

function readJs(name) { return fs.readFileSync(path.join(JS_DIR, name), 'utf8'); }
function readTestFile(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }

export async function runFullSuite() {
  const dom = new JSDOM(BASE_HTML, { url: 'http://localhost/' });
  const context = dom.window;
  vm.createContext(context);

  // Polyfills : jsdom n'implémente pas (ou incomplètement) ces API — on
  // fournit les vraies implémentations natives de Node à la place.
  // `crypto` est un accesseur (getter) en lecture seule sur window dans
  // jsdom (il fournit getRandomValues, mais pas subtle) : une simple
  // affectation lève une TypeError, il faut redéfinir la propriété.
  Object.defineProperty(context, 'crypto', { value: globalThis.crypto, configurable: true });
  context.Response = globalThis.Response;            // Fetch API (sw.js)
  context.Request = globalThis.Request;
  context.DOMPurify = { sanitize: s => s };           // même stub que test-runner.js

  // jsdom n'implémente pas window.matchMedia (pwa.js s'en sert pour
  // détecter le mode PWA "standalone" au chargement) — stub minimal,
  // toujours "non standalone" en test, ce qui est le comportement correct
  // dans cet environnement.
  context.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });

  // jsdom n'implémente pas correctement contentEditable/isContentEditable
  // (limitation connue du projet jsdom : la propriété ne reflète pas
  // l'attribut, et isContentEditable renvoie toujours undefined) — sans ce
  // correctif, isTypingTarget() (editor.js), qui s'appuie sur
  // el.isContentEditable comme le ferait n'importe quel vrai navigateur,
  // échouerait uniquement à cause de cette limite d'environnement, pas
  // d'un défaut du code applicatif.
  Object.defineProperty(context.HTMLElement.prototype, 'contentEditable', {
    configurable: true,
    get() { const v = this.getAttribute('contenteditable'); return v === null ? 'inherit' : v; },
    set(v) { this.setAttribute('contenteditable', v); }
  });
  Object.defineProperty(context.HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get() {
      let el = this;
      while (el && el.getAttribute) {
        const attr = el.getAttribute('contenteditable');
        if (attr === '' || attr === 'true') return true;
        if (attr === 'false') return false;
        el = el.parentElement;
      }
      return false;
    }
  });

  const run = (code, filename) => vm.runInContext(code, context, { filename });

  for (const f of FILES_BEFORE_ENV) run(readJs(f), f);
  run(readTestFile('harness-before.js'), 'harness-before.js');
  for (const f of FILES_AFTER_ENV) run(readJs(f), f);
  run(fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8'), 'sw.js');
  run(readTestFile('harness-after.js'), 'harness-after.js');

  // La suite portée est un async IIFE (voir suite.js) : on l'exécute et on
  // attend sa résolution avant de lire __results.
  await run(readTestFile('suite.js'), 'suite.js');

  // __results est un tableau de données brutes ({group, label, pass}) —
  // une simple propriété du contexte, donc lisible normalement depuis
  // l'extérieur (contrairement aux `const`/`let` du haut des fichiers,
  // qui restent, eux, invisibles hors du contexte vm).
  return context.__results;
}
