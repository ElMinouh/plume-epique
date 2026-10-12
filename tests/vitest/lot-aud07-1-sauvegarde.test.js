// AUD-07 LOT 1 (v9.70.0) — sauvegarde chiffrée de la base de synchro (AUD-07-017)
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chiffrerSauvegarde, dechiffrerSauvegarde, elaguer } = require('../../scripts/sauvegarder-d1.cjs');

describe('017 — sauvegarde chiffrée', () => {
  const clair = Buffer.from('CREATE TABLE sync_meta (k TEXT);\nINSERT INTO sync_meta VALUES (\'doc_x\');\n'.repeat(20));
  it("l'aller-retour restitue exactement le contenu, et le fichier ne contient rien de lisible", () => {
    const enc = chiffrerSauvegarde(clair, 'phrase-de-test');
    expect(enc.includes('CREATE TABLE')).toBe(false);
    expect(dechiffrerSauvegarde(enc, 'phrase-de-test').equals(clair)).toBe(true);
  });
  it('deux chiffrements du même contenu diffèrent (sel et vecteur aléatoires)', () => {
    expect(chiffrerSauvegarde(clair, 'p').equals(chiffrerSauvegarde(clair, 'p'))).toBe(false);
  });
  it('refuse une mauvaise phrase, un fichier altéré et un fichier étranger', () => {
    const enc = chiffrerSauvegarde(clair, 'bonne');
    expect(() => dechiffrerSauvegarde(enc, 'mauvaise')).toThrow(/incorrecte|altéré/);
    const abime = Buffer.from(enc); abime[abime.length - 5] ^= 0xff;
    expect(() => dechiffrerSauvegarde(abime, 'bonne')).toThrow(/incorrecte|altéré/);
    expect(() => dechiffrerSauvegarde(Buffer.from('rien à voir avec une sauvegarde de Plume, vraiment pas du tout'), 'bonne')).toThrow(/non reconnu/);
  });
  it('ne garde que les 8 sauvegardes les plus récentes', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-bk-'));
    for (let j = 1; j <= 11; j++) fs.writeFileSync(path.join(d, 'plume-sync-2026-10-' + String(j).padStart(2, '0') + '.sql.enc'), 'x');
    fs.writeFileSync(path.join(d, 'autre.txt'), 'y');
    const sup = elaguer(d);
    expect(sup).toHaveLength(3);
    expect(sup[0]).toBe('plume-sync-2026-10-01.sql.enc');
    expect(fs.readdirSync(d)).toHaveLength(9); // 8 sauvegardes + le fichier étranger, jamais touché
    fs.rmSync(d, { recursive: true, force: true });
  });
});
