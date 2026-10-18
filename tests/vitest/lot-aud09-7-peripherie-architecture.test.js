// ═══════════════════════════════════════════════════════
// LOT 7 de l'audit AUD-09 (v9.89.0) : périphérie gelée et classée (AUD-09-010), architecture à portée globale surveillée (AUD-09-011).
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
// Les fichiers chargés comme scripts classiques partagent UNE portée globale (odf-loader.js est un module ES : hors sujet).
const SCRIPTS = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && f !== 'odf-loader.js');

describe('AUD-09-011 : aucune déclaration globale en double entre fichiers', () => {
  it('une même fonction ou constante de premier niveau n\'est déclarée que dans un seul fichier', () => {
    const vus = {};
    for (const f of SCRIPTS) {
      for (const l of read('js/' + f).split('\n')) {
        const m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/) || l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
        if (m) (vus[m[1]] = vus[m[1]] || new Set()).add(f);
      }
    }
    const doublons = Object.entries(vus).filter(([, fs_]) => fs_.size > 1).map(([n, fs_]) => n + ' : ' + [...fs_].join(', '));
    expect(doublons).toEqual([]);
  });
  it('escapeRegExp et formatMo n\'existent qu\'une fois, dans schema.js', () => {
    for (const nom of ['escapeRegExp', 'escapeRegExpFr', 'formatMo']) {
      const def = SCRIPTS.filter(f => new RegExp('^function ' + nom + '\\(', 'm').test(read('js/' + f)));
      expect(def, nom).toEqual(nom === 'escapeRegExpFr' ? [] : ['schema.js']);
    }
    expect(read('js/panels.js')).toContain('escapeRegExp(q)');
    expect(read('js/findreplace.js')).toContain('escapeRegExp(query)');
  });
  it('formatMo : format français, un seul comportement partout', () => {
    const s = read('js/schema.js');
    const src = s.slice(s.indexOf('function formatMo'), s.indexOf('\n}', s.indexOf('function formatMo')) + 2);
    const formatMo = new Function(src + '\nreturn formatMo;')();
    expect(formatMo(3 * 1048576)).toBe('3 Mo');
    expect(formatMo(1.5 * 1048576)).toBe('1,5 Mo');
    expect(formatMo(52 * 1048576)).toBe('52 Mo');
    expect(formatMo(10 * 1048576)).toBe('10 Mo');
    expect(formatMo(1000)).toBe('< 0,1 Mo');
    expect(formatMo(0)).toBe('0 Mo');
  });
  it('escapeRegExp échappe les caractères spéciaux', () => {
    const s = read('js/schema.js');
    const src = s.slice(s.indexOf('function escapeRegExp'), s.indexOf('\n', s.indexOf('function escapeRegExp')) + 1);
    const esc = new Function(src + '\nreturn escapeRegExp;')();
    expect(esc('a.b*c?(d)[e]\\')).toBe('a\\.b\\*c\\?\\(d\\)\\[e\\]\\\\');
    expect('1+1=2'.match(new RegExp(esc('1+1')))).not.toBeNull();
  });
  it('plafond de croissance : aucun fichier JS ne dépasse 150 Ko (découpage à décider avant d\'aller plus loin)', () => {
    const gros = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))
      .map(f => [f, fs.statSync(path.join(ROOT, 'js', f)).size]).filter(([, t]) => t > 150000);
    expect(gros).toEqual([]);
  });
  it('la règle « nouveau module = ESM chargé à la demande » est écrite', () => {
    expect(read('CLAUDE.md')).toMatch(/nouveau module[^\n]*ESM[^\n]*à la demande/i);
    expect(read('docs/DECISIONS.md')).toMatch(/Règle pour les nouveaux modules/);
  });
});

describe('AUD-09-010 : périphérie classée et gelée, « Plugins » renommé', () => {
  it('PRODUIT.md classe les fonctions (cœur / soutien / périphérie) et gèle la périphérie', () => {
    const p = read('docs/PRODUIT.md');
    for (const t of ['Cœur', 'Soutien', 'Périphérie', 'gelée']) expect(p).toContain(t);
    for (const f of ['Nuage de mots', 'Lisibilité', 'Dictée', 'Outils d\'analyse', 'Visite complète']) expect(p).toContain(f);
  });
  it('plus de « plugin » dans les libellés visibles ; les fichiers gardent leur nom technique', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/>\s*Plugins/);
    expect(html).not.toContain('Plugins actifs');
    expect(html).toContain('Outils d\'analyse</button>');
    expect(read('js/fulltour.js')).toContain("title:'Outils d\\'analyse'");
    expect(read('js/pluginSystem.js')).toContain("toast('Outil désactivé','error')");
    expect(read('docs/GLOSSAIRE.md')).toContain('Outils d\'analyse');
    expect(fs.existsSync(path.join(ROOT, 'js', 'pluginSystem.js'))).toBe(true);
  });
  it('visite complète : chaque cible existe dans l\'interface (une modification d\'écran ne la casse plus en silence)', () => {
    const tour = read('js/fulltour.js');
    const cibles = new Set();
    for (const m of tour.matchAll(/(?:target|clickFirst)\s*:\s*'([^']+)'/g)) m[1].split(',').map(x => x.trim()).forEach(x => cibles.add(x));
    expect(cibles.size).toBeGreaterThanOrEqual(15);
    const html = read('index.html');
    const code = SCRIPTS.filter(f => f !== 'fulltour.js').map(f => read('js/' + f)).join('\n');
    const absents = [];
    for (const sel of cibles) {
      const id = sel.match(/^#([\w-]+)$/);
      const cls = sel.match(/^\.([\w-]+)$/);
      if (id) { if (!html.includes('id="' + id[1] + '"') && !code.includes(id[1])) absents.push(sel); }
      else if (cls) { if (!html.includes(cls[1]) && !code.includes(cls[1])) absents.push(sel); }
      // sélecteurs composés (ex. « #a button »), attributs : jetons « #id » et « .classe » vérifiés un à un
      else for (const t of sel.matchAll(/#([\w-]+)/g)) if (!html.includes('id="' + t[1] + '"') && !code.includes(t[1])) absents.push(sel + ' (' + t[1] + ')');
    }
    expect(absents).toEqual([]);
  });
  it('les sous-onglets visés par la visite existent', () => {
    const tour = read('js/fulltour.js'), html = read('index.html');
    for (const m of tour.matchAll(/subtab\s*:\s*'([^']+)'/g)) expect(html, m[1]).toContain('data-subtab="' + m[1] + '"');
  });
});

describe('AUD-09-011 : Trusted Types et gros fichiers consignés au registre des risques', () => {
  it('RISQUES.md garde la trace des deux points laissés ouverts', () => {
    const r = read('docs/RISQUES.md');
    expect(r).toMatch(/Trusted Types[^\n]*innerHTML/);
    expect(r).toMatch(/graphicnovel\.js[^\n]*router\.js[^\n]*library\.js[^\n]*150 Ko/);
  });
});
