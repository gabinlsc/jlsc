#!/usr/bin/env node
/**
 * BUILD DU SITE — génère dist/ à partir de data/*.json et des gabarits.
 *
 *   node build.js            build de production
 *   node build.js --watch    reconstruit à chaque modification
 *   node build.js --serve    lance aussi le serveur local (scripts/serve.js)
 *
 * Étapes : validation des données → polices → CSS (Tailwind CLI) → JS →
 * images (sharp : AVIF/WebP/JPEG, images de partage) → pages HTML →
 * sitemap.xml, robots.txt → rapport des contenus à remplacer.
 * Tous les fichiers de /assets/ sont « fingerprintés » (hash dans le nom)
 * pour être mis en cache un an par Nginx.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RACINE = __dirname;
const DIST = path.join(RACINE, 'dist');
const CACHE = path.join(RACINE, '.cache');
const args = new Set(process.argv.slice(2));

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

const lireJSON = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(RACINE, f), 'utf8'));
  } catch (e) {
    throw new Error(`Impossible de lire ${f} : ${e.message}\n→ Vérifiez la syntaxe JSON (virgules, guillemets) avec un validateur.`);
  }
};
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const ecrire = (rel, contenu) => {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenu);
};
/** Écrit un fichier dans /assets/ avec un nom fingerprinté et renvoie son URL publique. */
const emettre = (dossier, nom, contenu) => {
  const ext = path.extname(nom);
  const fichier = `${path.basename(nom, ext)}.${hash(contenu)}${ext}`;
  ecrire(path.join('assets', dossier, fichier), contenu);
  return `/assets/${dossier}/${fichier}`;
};
/** Allège le HTML sans toucher au contenu (les commentaires de suivi sont conservés). */
const alleger = (html) => html.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
const purger = (mod) => { delete require.cache[require.resolve(mod)]; return require(mod); };

/* ------------------------------------------------------------------ */
/* Validation des données                                              */
/* ------------------------------------------------------------------ */

function valider({ books, territoires, events }) {
  const erreurs = [];
  const slugOk = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const tSlugs = new Set();
  for (const t of territoires) {
    if (!t.slug || !slugOk.test(t.slug)) erreurs.push(`territoires.json : slug invalide « ${t.slug} » (minuscules, chiffres, tirets).`);
    if (tSlugs.has(t.slug)) erreurs.push(`territoires.json : slug en double « ${t.slug} ».`);
    tSlugs.add(t.slug);
    if (!t.name) erreurs.push(`territoires.json : « ${t.slug} » n'a pas de nom (name).`);
    if ((t.lon === null) !== (t.lat === null) || (t.lon !== null && (typeof t.lon !== 'number' || typeof t.lat !== 'number'))) {
      erreurs.push(`territoires.json : « ${t.slug} » doit avoir lon ET lat numériques (ou null tous les deux).`);
    }
    if (!Array.isArray(t.presentation)) erreurs.push(`territoires.json : « ${t.slug} » : presentation doit être une liste de paragraphes.`);
  }
  const bSlugs = new Set();
  for (const b of books) {
    if (!b.slug || !slugOk.test(b.slug)) erreurs.push(`books.json : slug invalide « ${b.slug} ».`);
    if (bSlugs.has(b.slug)) erreurs.push(`books.json : slug en double « ${b.slug} ».`);
    bSlugs.add(b.slug);
    for (const champ of ['title', 'year', 'synopsis']) if (!b[champ]) erreurs.push(`books.json : « ${b.slug} » : champ « ${champ} » manquant.`);
    if (!Array.isArray(b.territoires)) erreurs.push(`books.json : « ${b.slug} » : territoires doit être une liste.`);
    else for (const t of b.territoires) if (!tSlugs.has(t)) erreurs.push(`books.json : « ${b.slug} » cite le territoire inconnu « ${t} » (à ajouter dans territoires.json).`);
    if (b.payhipProductId && !/^[A-Za-z0-9]+$/.test(b.payhipProductId)) erreurs.push(`books.json : « ${b.slug} » : payhipProductId invalide (lettres et chiffres uniquement, ex. « AbC12 »).`);
  }
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) erreurs.push(`events.json : date invalide « ${e.date} » (format AAAA-MM-JJ).`);
    if (!e.titre) erreurs.push(`events.json : un événement n'a pas de titre.`);
  }
  if (erreurs.length) throw new Error('Données invalides :\n  - ' + erreurs.join('\n  - '));
}

/* ------------------------------------------------------------------ */
/* Polices auto-hébergées                                              */
/* ------------------------------------------------------------------ */

const POLICES = [
  { famille: 'Fraunces', fichier: '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2', poids: '100 900', style: 'normal', precharger: true },
  { famille: 'Fraunces', fichier: '@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2', poids: '100 900', style: 'italic' },
  { famille: 'Atkinson Hyperlegible', fichier: '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2', poids: '400', style: 'normal', precharger: true },
  { famille: 'Atkinson Hyperlegible', fichier: '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2', poids: '700', style: 'normal', precharger: true },
  { famille: 'Atkinson Hyperlegible', fichier: '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2', poids: '400', style: 'italic' }
];
const UNICODE_LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

function polices() {
  let css = '';
  const precharges = [];
  for (const p of POLICES) {
    const src = require.resolve(p.fichier);
    const url = emettre('fonts', path.basename(src), fs.readFileSync(src));
    if (p.precharger) precharges.push(url);
    css += `@font-face{font-family:'${p.famille}';font-style:${p.style};font-weight:${p.poids};font-display:swap;src:url(${url}) format('woff2');unicode-range:${UNICODE_LATIN}}`;
  }
  return { css, precharges };
}

/* ------------------------------------------------------------------ */
/* CSS (Tailwind CLI) et JS                                            */
/* ------------------------------------------------------------------ */

function feuilleDeStyle(fontFace) {
  fs.mkdirSync(CACHE, { recursive: true });
  const sortie = path.join(CACHE, 'app.css');
  const bin = path.join(RACINE, 'node_modules', '.bin', process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss');
  if (!fs.existsSync(bin)) throw new Error('Tailwind CSS introuvable.\n→ Lancez : npm ci');
  execFileSync(bin, ['-c', 'tailwind.config.js', '-i', 'src/styles/main.css', '-o', sortie, '--minify'], { cwd: RACINE, stdio: ['ignore', 'ignore', 'pipe'] });
  return emettre('css', 'app.css', fontFace + fs.readFileSync(sortie, 'utf8'));
}

function scripts() {
  const out = {};
  let total = 0;
  for (const nom of ['theme-init', 'app', 'carte', 'catalogue']) {
    const code = fs.readFileSync(path.join(RACINE, 'src/js', `${nom}.js`), 'utf8');
    total += Buffer.byteLength(code);
    out[nom === 'theme-init' ? 'init' : nom] = emettre('js', `${nom}.js`, code);
  }
  if (total > 20 * 1024) console.warn(`⚠  Budget JS dépassé : ${(total / 1024).toFixed(1)} Ko (objectif < 20 Ko).`);
  return { urls: out, total };
}

/* ------------------------------------------------------------------ */
/* Images (sharp)                                                      */
/* ------------------------------------------------------------------ */

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  throw new Error('Le module « sharp » est introuvable.\n→ Lancez : npm ci');
}

/** Exécute une transformation sharp avec cache disque (.cache/images). */
async function viaCache(cle, ext, produire) {
  const dossier = path.join(CACHE, 'images');
  fs.mkdirSync(dossier, { recursive: true });
  const f = path.join(dossier, `${hash(cle)}.${ext}`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const buf = await produire();
  fs.writeFileSync(f, buf);
  return buf;
}

/**
 * Décline une image source en AVIF, WebP et JPEG à plusieurs largeurs.
 * Renvoie la structure utilisée par partials.picture().
 */
async function declinerImage(source, nom, largeurs) {
  const brut = fs.readFileSync(source);
  const meta = await sharp(brut).metadata();
  const ws = largeurs.filter((w) => w <= meta.width);
  if (!ws.length) ws.push(meta.width);
  const formats = { avif: { q: 55 }, webp: { q: 78 }, jpg: { q: 82 } };
  const res = {};
  for (const [fmt, { q }] of Object.entries(formats)) {
    res[fmt] = [];
    for (const w of ws) {
      const buf = await viaCache(`${hash(brut)}-${w}-${fmt}-${q}`, fmt, () => {
        const s = sharp(brut).rotate().resize({ width: w, withoutEnlargement: true });
        if (fmt === 'avif') return s.avif({ quality: q }).toBuffer();
        if (fmt === 'webp') return s.webp({ quality: q }).toBuffer();
        return s.jpeg({ quality: q, mozjpeg: true, progressive: true }).toBuffer();
      });
      res[fmt].push(`${emettre('img', `${nom}-${w}.${fmt}`, buf)} ${w}w`);
    }
  }
  const largeurMax = ws[ws.length - 1];
  return {
    sources: [{ type: 'image/avif', srcset: res.avif.join(', ') }, { type: 'image/webp', srcset: res.webp.join(', ') }],
    srcset: res.jpg.join(', '),
    src: res.jpg[res.jpg.length - 1].split(' ')[0],
    width: largeurMax,
    height: Math.round((meta.height / meta.width) * largeurMax)
  };
}

/** Image de partage 1200×630 (Open Graph / réseaux sociaux). */
async function imagePartage(nom, options, couverture) {
  const { partageSVG } = purger('./src/components/couverture');
  const fond = Buffer.from(partageSVG(options));
  const cle = hash(fond) + (couverture ? hash(couverture) : '');
  const buf = await viaCache(`og-${cle}`, 'jpg', async () => {
    const calques = [];
    if (couverture) {
      const c = await sharp(couverture).resize(300, 450, { fit: 'cover' }).png().toBuffer();
      const ombre = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><filter id="f"><feGaussianBlur stdDeviation="12"/></filter><rect x="30" y="38" width="300" height="450" fill="#1B2A41" opacity=".35" filter="url(#f)"/></svg>');
      calques.push({ input: ombre, left: 80, top: 62 }, { input: c, left: 110, top: 90 });
    }
    return sharp(fond).composite(calques).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  });
  return emettre('og', `${nom}.jpg`, buf);
}

/** Fichier .ico minimal contenant une image PNG 32×32. */
function ico(png) {
  const entete = Buffer.alloc(22);
  entete.writeUInt16LE(0, 0);
  entete.writeUInt16LE(1, 2);
  entete.writeUInt16LE(1, 4);
  entete.writeUInt8(32, 6);
  entete.writeUInt8(32, 7);
  entete.writeUInt16LE(1, 10);
  entete.writeUInt16LE(32, 12);
  entete.writeUInt32LE(png.length, 14);
  entete.writeUInt32LE(22, 18);
  return Buffer.concat([entete, png]);
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

async function build() {
  const debut = Date.now();
  // Rechargement des modules (mode --watch) pour prendre en compte les modifications.
  for (const m of ['./src/templates/helpers', './src/components/fond-de-carte', './src/components/carte', './src/components/couverture', './src/templates/partials', './src/templates/layout', './src/templates/pages']) purger(m);
  const { layout } = require('./src/templates/layout');
  const pages = require('./src/templates/pages');
  const { couvertureSVG, faviconSVG } = require('./src/components/couverture');
  const { carteSVG } = require('./src/components/carte');
  const { priceValue } = require('./src/templates/helpers');

  const config = lireJSON('site.config.json');
  const books = lireJSON('data/books.json');
  const territoires = lireJSON('data/territoires.json');
  const events = lireJSON('data/events.json');
  const auteur = lireJSON('data/auteur.json');
  valider({ books, territoires, events });

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // Assets statiques
  const fontes = polices();
  const css = feuilleDeStyle(fontes.css);
  const js = scripts();

  // Images : portrait et couvertures (réelles si présentes, sinon visuels SVG)
  const portraitSrc = path.join(RACINE, config.author.portrait || '');
  const portrait = config.author.portrait && fs.existsSync(portraitSrc) ? await declinerImage(portraitSrc, 'portrait', [360, 540, 720]) : null;

  // Trait de côte pour le décor de l'image de partage par défaut
  const coteD = (carteSVG({ territoires: [], mode: 'locator', id: 'og' }).match(/class="c-cote" d="([^"]+)"/) || [])[1] || '';
  const ogDefaut = await imagePartage('partage', { titre: config.author.name, sousTitre: 'Géographe — livres sur la Bretagne et ses îles', avecCouverture: false, coteD }, null);

  for (const [i, b] of books.entries()) {
    b._index = i;
    b._prix = priceValue(b.price);
    const src = b.cover ? path.join(RACINE, b.cover) : '';
    b._img = src && fs.existsSync(src) ? await declinerImage(src, `couverture-${b.slug}`, [240, 360, 480, 720]) : null;
    const couv = b._img ? fs.readFileSync(src) : await sharp(Buffer.from(couvertureSVG(b, i, { inline: false }))).png().toBuffer();
    b._og = await imagePartage(`partage-${b.slug}`, { titre: b.title, sousTitre: b.subtitle }, couv);
  }

  // Favicons
  ecrire('favicon.svg', faviconSVG());
  ecrire('favicon.ico', ico(await sharp(Buffer.from(faviconSVG())).resize(32, 32).png().toBuffer()));
  ecrire('apple-touch-icon.png', await sharp(Buffer.from(faviconSVG())).resize(180, 180).flatten({ background: '#1B2A41' }).png().toBuffer());

  // Contexte partagé par toutes les pages
  const compteParTerritoire = {};
  for (const b of books) for (const t of b.territoires) compteParTerritoire[t] = (compteParTerritoire[t] || 0) + 1;
  const site = {
    config, books, territoires, events, auteur, portrait, compteParTerritoire,
    territoiresParSlug: Object.fromEntries(territoires.map((t) => [t.slug, t])),
    assets: { css, js: js.urls, fontsPreload: fontes.precharges, ogDefaut }
  };

  // Pages
  const liste = [
    pages.accueil(site),
    pages.catalogue(site),
    ...books.map((b) => pages.livre(site, b)),
    pages.territoiresIndex(site),
    ...territoires.map((t) => pages.territoire(site, t)),
    pages.auteurPage(site),
    pages.conferences(site),
    pages.contact(site),
    pages.mentionsLegales(site),
    pages.confidentialite(site),
    pages.cgv(site),
    pages.planDuSite(site),
    pages.page404(site)
  ];
  const vus = new Set();
  for (const p of liste) {
    if (vus.has(p.chemin)) throw new Error(`Deux pages ont la même adresse : ${p.chemin}`);
    vus.add(p.chemin);
    const fichier = p.chemin.endsWith('.html') ? p.chemin : path.posix.join(p.chemin, 'index.html');
    ecrire(fichier, alleger(layout(site, p)));
  }

  // sitemap.xml et robots.txt
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const urls = liste.filter((p) => !p.noindex).map((p) => `<url><loc>${config.url}${p.chemin}</loc><lastmod>${aujourdhui}</lastmod></url>`);
  ecrire('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  ecrire('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.url}/sitemap.xml\n`);

  // Rapport
  const html = liste.map((p) => alleger(layout(site, p))).join('');
  const marques = ['À REMPLACER', 'À VÉRIFIER', 'À RELIRE', 'À AFFINER'].map((m) => `${m} ×${(html.match(new RegExp(m, 'g')) || []).length}`);
  const actifs = books.filter((b) => b.payhipProductId).length;
  console.log(`✔ Build terminé en ${((Date.now() - debut) / 1000).toFixed(1)} s — ${liste.length} pages dans dist/`);
  console.log(`  JS : ${(js.total / 1024).toFixed(1)} Ko · Payhip : ${actifs}/${books.length} livre(s) en vente · Images réelles : ${books.filter((b) => b._img).length} couverture(s)${portrait ? ' + portrait' : ''}`);
  console.log(`  Contenus à finaliser (voir TODO-CONTENU.md) : ${marques.join(' · ')}`);
}

/* ------------------------------------------------------------------ */
/* Lancement (+ mode --watch / --serve)                                */
/* ------------------------------------------------------------------ */

function erreur(e) {
  console.error(`\n✘ Échec du build\n${e.message}\n`);
}

if (require.main === module) {
  build()
    .then(() => {
      if (args.has('--serve')) require('./scripts/serve.js');
      if (!args.has('--watch')) return;
      let minuteur = null;
      const relancer = () => {
        clearTimeout(minuteur);
        minuteur = setTimeout(() => build().catch(erreur), 150);
      };
      for (const cible of ['src', 'data', 'assets', 'site.config.json', 'tailwind.config.js']) {
        const p = path.join(RACINE, cible);
        if (fs.existsSync(p)) fs.watch(p, { recursive: fs.statSync(p).isDirectory() }, relancer);
      }
      console.log('👀 Surveillance des modifications (Ctrl+C pour arrêter)…');
    })
    .catch((e) => {
      erreur(e);
      process.exit(1);
    });
}

module.exports = { build };
