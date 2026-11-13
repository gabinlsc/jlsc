#!/usr/bin/env node
/**
 * Vérifie les liens internes de dist/ : chaque href/src local doit pointer
 * vers un fichier existant, chaque ancre #id vers un id présent dans la page.
 *   npm run build && npm run check
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const pages = [];
(function parcourir(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) parcourir(p);
    else if (f.endsWith('.html')) pages.push(p);
  }
})(DIST);

const cible = (url) => {
  const f = path.join(DIST, decodeURIComponent(url));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) return path.join(f, 'index.html');
  return f;
};
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

let erreurs = 0;
let total = 0;
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const rel = '/' + path.relative(DIST, page);
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:|tel:)/.test(url)) continue;
    total++;
    const [chemin, ancre] = url.split('#');
    const sansRequete = chemin.split('?')[0];
    const fichier = sansRequete ? cible(sansRequete) : page;
    if (!fs.existsSync(fichier)) { console.error(`✘ ${rel} → ${url} (introuvable)`); erreurs++; continue; }
    if (ancre && fichier.endsWith('.html') && !ids(fs.readFileSync(fichier, 'utf8')).has(ancre)) {
      console.error(`✘ ${rel} → ${url} (ancre #${ancre} absente)`); erreurs++;
    }
  }
  for (const [, srcset] of html.matchAll(/srcset="([^"]+)"/g)) {
    for (const u of srcset.split(',').map((s) => s.trim().split(' ')[0])) {
      total++;
      if (!fs.existsSync(cible(u))) { console.error(`✘ ${rel} → ${u} (srcset introuvable)`); erreurs++; }
    }
  }
}
console.log(`${erreurs ? '✘' : '✔'} ${total} liens internes vérifiés dans ${pages.length} pages, ${erreurs} erreur(s).`);
process.exit(erreurs ? 1 : 0);
