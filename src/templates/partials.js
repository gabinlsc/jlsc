/**
 * COMPOSANTS RÉUTILISABLES — couverture, bouton Acheter, carte de livre,
 * fil d'Ariane, titres de section, formulaires, modale « Bientôt disponible ».
 */
'use strict';

const { esc, escKeepComments, priceLabel, plural } = require('./helpers');
const { couvertureSVG, portraitSVG } = require('../components/couverture');

/** <picture> AVIF/WebP/JPEG à partir d'une image traitée par build.js. */
function picture(img, { alt, sizes, eager = false, classe = '' }) {
  const sources = img.sources.map((s) => `<source type="${s.type}" srcset="${s.srcset}" sizes="${sizes}">`).join('');
  return `<picture class="${classe}">${sources}<img src="${img.src}" srcset="${img.srcset}" sizes="${sizes}" width="${img.width}" height="${img.height}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}

/** Couverture d'un livre : image réelle si fournie, sinon visuel SVG de substitution. */
function couverture(livre, { sizes = '(min-width: 768px) 280px, 45vw', eager = false } = {}) {
  if (livre._img) {
    return `<div class="couverture">${picture(livre._img, { alt: `Couverture du livre « ${livre.title} »`, sizes, eager })}</div>`;
  }
  return `<div class="couverture couverture--provisoire"><!-- À REMPLACER : couverture ${esc(livre.cover)} -->${couvertureSVG(livre, livre._index)}</div>`;
}

/** Portrait de l'auteur (photo réelle ou médaillon de substitution). */
function portrait(site, { eager = false } = {}) {
  if (site.portrait) {
    return `<div class="portrait">${picture(site.portrait, { alt: `Portrait de ${site.config.author.name}`, sizes: '(min-width: 768px) 360px, 70vw', eager })}</div>`;
  }
  return `<div class="portrait portrait--provisoire">${portraitSVG()}</div>`;
}

/**
 * Bouton « Acheter ».
 * - payhipProductId renseigné → bouton officiel Payhip (overlay), lien direct en secours.
 * - sinon → lien vers le formulaire « être prévenu » (sans JS), amélioré en modale (avec JS).
 */
function boutonAcheter(livre, { classe = '', libelle = 'Acheter' } = {}) {
  const label = `${libelle}<span class="sr-only"> « ${esc(livre.title)} »</span>`;
  if (livre.payhipProductId) {
    const href = livre.payhipUrl || `https://payhip.com/b/${encodeURIComponent(livre.payhipProductId)}`;
    return `<a class="btn btn-acheter payhip-buy-button ${classe}" href="${esc(href)}" data-theme="none" data-product="${esc(livre.payhipProductId)}" rel="noopener">${ICONE_PANIER}${label}</a>`;
  }
  return `<a class="btn btn-acheter ${classe}" href="/contact/?livre=${esc(encodeURIComponent(livre.title))}#formulaire" data-bientot data-livre="${esc(livre.title)}" aria-haspopup="dialog">${ICONE_PANIER}${label}</a>`;
}

const ICONE_PANIER = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 7h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8Z M9 7V6a3 3 0 0 1 6 0v1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

/** Pastille « Livre d'exemple » tant que les données de démonstration sont en place. */
function badgeExemple(livre) {
  return livre.exemple ? `<span class="badge badge-exemple" title="Données de démonstration à remplacer">Livre d'exemple</span>` : '';
}

/** Carte d'un livre (catalogue, accueil, livres similaires). */
function carteLivre(livre, territoiresParSlug, { titreNiveau = 'h3' } = {}) {
  const terr = livre.territoires.map((s) => territoiresParSlug[s]).filter(Boolean);
  const H = titreNiveau;
  return `<article class="livre-carte reveal" data-territoires="${esc(livre.territoires.join(' '))}" data-themes="${esc((livre.themes || []).join('|'))}" data-annee="${livre.year}" data-titre="${esc(livre.title)}" data-prix="${esc(livre._prix)}">
  <a class="livre-carte-lien" href="/livres/${esc(livre.slug)}/" tabindex="-1" aria-hidden="true">${couverture(livre)}</a>
  <div class="livre-carte-corps">
    ${badgeExemple(livre)}
    <${H} class="livre-carte-titre"><a href="/livres/${esc(livre.slug)}/">${esc(livre.title)}</a></${H}>
    ${livre.subtitle ? `<p class="livre-carte-sous">${esc(livre.subtitle)}</p>` : ''}
    <p class="legende livre-carte-meta">${esc(livre.year)} · ${esc(terr.map((t) => t.name).slice(0, 3).join(', '))}${terr.length > 3 ? '…' : ''}</p>
    <div class="livre-carte-achat">
      <span class="prix">${esc(priceLabel(livre.price))}</span>
      ${boutonAcheter(livre, { classe: 'btn-petit' })}
    </div>
  </div>
</article>`;
}

/** Fil d'Ariane (HTML + données structurées). */
function filAriane(site, items) {
  const html = `<nav class="fil-ariane" aria-label="Fil d'Ariane"><ol>${items
    .map((it, i) => (i === items.length - 1 ? `<li><span aria-current="page">${esc(it.nom)}</span></li>` : `<li><a href="${it.href}">${esc(it.nom)}</a></li>`))
    .join('')}</ol></nav>`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.nom, item: site.config.url + it.href }))
  };
  return { html, ld };
}

/** En-tête de section façon atlas : numéro de figure + titre + chapeau. */
function enteteSection({ fig, titre, chapo = '', id = '', niveau = 'h2' }) {
  return `<header class="section-entete">
  ${fig ? `<p class="legende fig">${esc(fig)}</p>` : ''}
  <${niveau} class="titre-section"${id ? ` id="${id}"` : ''}>${esc(titre)}</${niveau}>
  ${chapo ? `<p class="chapo">${chapo}</p>` : ''}
</header>`;
}

/** Filet décoratif (ligne + losange), purement visuel. */
const FILET = '<div class="filet" aria-hidden="true"><span></span></div>';

/** Mention RGPD commune aux formulaires. */
function mentionRGPD() {
  return `<p class="mention-rgpd">Vos données servent uniquement à vous répondre. Elles ne sont ni revendues ni utilisées à des fins publicitaires. <a href="/confidentialite/">En savoir plus</a>.</p>`;
}

/** Champ anti-spam invisible (« pot de miel ») : les robots le remplissent, les humains ne le voient pas. */
const POT_DE_MIEL = `<div class="pot-de-miel" aria-hidden="true"><label for="_gotcha-{id}">Ne pas remplir ce champ</label><input type="text" id="_gotcha-{id}" name="_gotcha" tabindex="-1" autocomplete="off"></div>`;

/** Calcule l'attribut action d'un formulaire à partir de site.config.json. */
function actionFormulaire(site, cle, sujet) {
  const action = site.config.forms[cle] || 'mailto:';
  if (action.startsWith('mailto:')) {
    return { action: `mailto:${site.config.author.email}?subject=${encodeURIComponent(sujet)}`, extra: 'enctype="text/plain"', mailto: true };
  }
  return { action, extra: '', mailto: false };
}

/** Modale « Bientôt disponible » (élément <dialog> natif, accessible). */
function dialogBientot(site) {
  const f = actionFormulaire(site, 'notifyAction', 'Être prévenu de la disponibilité d\'un livre');
  return `<dialog class="dialog" id="dialog-bientot" aria-labelledby="dialog-bientot-titre">
  <form class="formulaire" method="post" action="${esc(f.action)}" ${f.extra} data-formulaire="prevenir" data-mailto="${f.mailto}">
    <p class="legende">Commande en ligne</p>
    <h2 id="dialog-bientot-titre" class="dialog-titre">Bientôt disponible à l'achat</h2>
    <p>Le livre <strong data-livre-titre>…</strong> sera très prochainement disponible en ligne. Laissez votre e-mail pour être prévenu.</p>
    <input type="hidden" name="livre" value="">
    <div class="champ">
      <label for="prevenir-email">Votre adresse e-mail <span class="requis">(obligatoire)</span></label>
      <input id="prevenir-email" name="email" type="email" autocomplete="email" required>
    </div>
    ${POT_DE_MIEL.replace(/\{id\}/g, 'dialog')}
    <div class="champ champ-case">
      <input id="prevenir-accord" name="accord" type="checkbox" required>
      <label for="prevenir-accord">J'accepte d'être contacté par e-mail au sujet de ce livre.</label>
    </div>
    ${mentionRGPD()}
    <p class="formulaire-statut" role="status" aria-live="polite"></p>
    <div class="dialog-actions">
      <button type="submit" class="btn btn-primaire">Me prévenir</button>
      <button type="button" class="btn btn-secondaire" data-fermer>Fermer</button>
    </div>
  </form>
</dialog>`;
}

/** Liste des livres sous forme de grille. */
function grilleLivres(livres, territoiresParSlug, opts) {
  return `<div class="grille-livres">${livres.map((l) => carteLivre(l, territoiresParSlug, opts)).join('')}</div>`;
}

/** Texte « N livres » pour un territoire. */
function compteLivres(n) {
  return n ? plural(n, 'livre') : 'Aucun livre pour l\'instant';
}

module.exports = {
  picture, couverture, portrait, boutonAcheter, badgeExemple, carteLivre, grilleLivres, filAriane,
  enteteSection, FILET, mentionRGPD, POT_DE_MIEL, actionFormulaire, dialogBientot, compteLivres, escKeepComments
};
