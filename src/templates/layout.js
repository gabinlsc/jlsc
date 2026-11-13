/**
 * GABARIT DE PAGE — <head> (SEO, Open Graph, JSON-LD), en-tête, pied de page.
 * Chaque page est rendue par pages.js puis enveloppée par layout().
 */
'use strict';

const { esc, jsonLd } = require('./helpers');
const { dialogBientot } = require('./partials');

/** Petite rose des vents du logo (décorative). */
const LOGO = `<svg class="marque-rose" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-opacity=".35"/><path d="M16 2 19 16 16 30 13 16Z" fill="currentColor"/><path d="M2 16 16 13 30 16 16 19Z" class="marque-rose-est"/></svg>`;

function entete(site, chemin) {
  const liens = site.config.nav
    .map((l) => {
      const actif = chemin === l.href || (l.href !== '/' && chemin.startsWith(l.href));
      return `<li><a href="${l.href}"${actif ? ' aria-current="page"' : ''}>${esc(l.label)}</a></li>`;
    })
    .join('');
  return `<header class="site-entete">
  <div class="conteneur entete-barre">
    <a class="marque" href="/"${chemin === '/' ? ' aria-current="page"' : ''}>
      ${LOGO}
      <span class="marque-texte"><span class="marque-nom">${esc(site.config.siteName)}</span><span class="legende marque-metier">Géographe<span class="hidden sm:inline"> · Bretagne &amp; îles</span></span></span>
    </a>
    <button class="btn-menu" type="button" aria-expanded="false" aria-controls="menu-principal">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span>Menu</span>
    </button>
    <nav class="nav-principale" id="menu-principal" aria-label="Navigation principale">
      <ul>${liens}</ul>
      <div class="outils-affichage" role="group" aria-label="Préférences d'affichage">
        <button type="button" class="btn-outil" data-texte="moins" aria-label="Réduire la taille du texte">A<span aria-hidden="true">−</span></button>
        <button type="button" class="btn-outil" data-texte="plus" aria-label="Agrandir la taille du texte">A<span aria-hidden="true">+</span></button>
        <button type="button" class="btn-outil" data-theme-toggle aria-pressed="false">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor"/></svg>
          <span>Carte de nuit</span>
        </button>
      </div>
    </nav>
  </div>
</header>`;
}

function pied(site) {
  const c = site.config;
  const annee = new Date().getFullYear();
  return `<footer class="site-pied">
  <div class="conteneur pied-grille">
    <div>
      <p class="pied-nom">${esc(c.siteName)}</p>
      <p class="pied-texte">${esc(c.tagline)}. Livres de géographie sur la Bretagne et ses îles, à commander en ligne ou à faire dédicacer lors des rencontres.</p>
    </div>
    <nav aria-label="Plan du site">
      <p class="legende">Le site</p>
      <ul class="pied-liens">
        <li><a href="/">Accueil</a></li>
        ${c.nav.map((l) => `<li><a href="${l.href}">${esc(l.label)}</a></li>`).join('')}
      </ul>
    </nav>
    <div>
      <p class="legende">Écrire à l'auteur</p>
      <p><a href="mailto:${esc(c.author.email)}">${esc(c.author.email)}</a></p>
      <p class="pied-texte">Bibliothèques, associations, établissements scolaires : <a href="/conferences/#inviter">inviter l'auteur</a>.</p>
    </div>
  </div>
  <div class="conteneur pied-bas">
    <p>© ${annee} ${esc(c.siteName)}</p>
    <ul class="pied-legal">
      <li><a href="/mentions-legales/">Mentions légales</a></li>
      <li><a href="/confidentialite/">Confidentialité</a></li>
      <li><a href="/cgv/">Conditions de vente</a></li>
      <li><a href="/plan-du-site/">Plan du site</a></li>
    </ul>
  </div>
</footer>`;
}

/**
 * Enveloppe le contenu d'une page.
 * @param {object} site  { config, assets, ... }
 * @param {object} page  { chemin, titre, description, image, imageAlt, type, jsonld[], scripts[], noindex, contenu }
 */
function layout(site, page) {
  const c = site.config;
  const a = site.assets;
  const url = c.url + page.chemin;
  const titreComplet = page.chemin === '/' ? page.titre : `${page.titre} · ${c.siteName}`;
  const image = c.url + (page.image || a.ogDefaut);
  const besoinPayhip = page.contenu.includes('payhip-buy-button');
  const besoinDialog = page.contenu.includes('data-bientot');
  const scripts = [a.js.app, ...(page.scripts || []).map((s) => a.js[s])];

  let analytics = '';
  if (c.analytics && c.analytics.enabled) {
    analytics = c.analytics.provider === 'umami'
      ? `<script defer src="${esc(c.analytics.src)}" data-website-id="${esc(c.analytics.websiteId)}"></script>`
      : `<script defer src="${esc(c.analytics.src)}" data-domain="${esc(c.analytics.domain)}"></script>`;
  }

  return `<!doctype html>
<html lang="${c.lang}" class="no-js" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titreComplet)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${esc(url)}">
${page.noindex ? '<meta name="robots" content="noindex, follow">' : ''}
<meta name="author" content="${esc(c.author.name)}">
<meta name="theme-color" content="#F5EFE2">
<meta property="og:type" content="${page.type || 'website'}">
<meta property="og:site_name" content="${esc(c.siteName)}">
<meta property="og:locale" content="${c.locale}">
<meta property="og:title" content="${esc(page.titre)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(page.imageAlt || `${c.siteName} — ${c.tagline}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.titre)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${a.fontsPreload.map((f) => `<link rel="preload" href="${f}" as="font" type="font/woff2" crossorigin>`).join('\n')}
<link rel="stylesheet" href="${a.css}">
<script src="${a.js.init}"></script>
${scripts.map((s) => `<script src="${s}" defer></script>`).join('\n')}
${besoinPayhip ? '<script src="https://payhip.com/payhip.js" defer></script>' : ''}
${analytics}
${(page.jsonld || []).map(jsonLd).join('\n')}
</head>
<body class="${page.bodyClass || ''}">
<a class="lien-evitement" href="#contenu">Aller au contenu</a>
${entete(site, page.chemin)}
<main id="contenu" tabindex="-1">
${page.contenu}
</main>
${pied(site)}
${besoinDialog ? dialogBientot(site) : ''}
</body>
</html>`;
}

module.exports = { layout };
