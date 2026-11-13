/**
 * VISUELS DE SUBSTITUTION (SVG) — couvertures, portrait, image de partage, favicon.
 * Utilisés tant que les vraies images ne sont pas fournies (voir TODO-CONTENU.md).
 * <!-- À REMPLACER : couvertures et portrait réels -->
 */
'use strict';

const { esc } = require('../templates/helpers');

/** Teintes des couvertures de substitution (objets imprimés : indépendantes du thème). */
const TEINTES = [
  { fond: '#1B2A41', encre: '#F3ECDC', accent: '#C9A266' }, // bleu nuit
  { fond: '#2F5650', encre: '#F3ECDC', accent: '#D8B477' }, // vert-de-gris profond
  { fond: '#3B536B', encre: '#F5EFE2', accent: '#E0C08A' }  // bleu ardoise
];

/** Découpe un texte en lignes d'au plus `max` caractères (coupure aux espaces). */
function decouper(texte, max) {
  const lignes = [];
  let ligne = '';
  for (const mot of String(texte).split(/\s+/)) {
    if ((ligne + ' ' + mot).trim().length > max && ligne) {
      lignes.push(ligne);
      ligne = mot;
    } else {
      ligne = (ligne + ' ' + mot).trim();
    }
  }
  if (ligne) lignes.push(ligne);
  return lignes;
}

/** Hash numérique simple d'une chaîne (pour varier les motifs d'une couverture à l'autre). */
function hashNum(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Contour d'île irrégulier centré (cx, cy) — motif décoratif des couvertures. */
function contourIle(cx, cy, r, graine, echelle = 1) {
  let s = graine;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    const f = (0.7 + rnd() * 0.45) * echelle;
    pts.push([cx + Math.cos(t) * r * 1.5 * f, cy + Math.sin(t) * r * f]);
  }
  const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M${m(pts[9], pts[0]).map((n) => n.toFixed(1))}`;
  for (let i = 0; i < 10; i++) d += `Q${pts[i].map((n) => n.toFixed(1))} ${m(pts[i], pts[(i + 1) % 10]).map((n) => n.toFixed(1))}`;
  return d + 'Z';
}

/**
 * Couverture de substitution 400×600.
 * @param {object} livre   entrée de books.json
 * @param {number} index   position du livre (choix de la teinte)
 * @param {object} [o]     { inline: true } → SVG pour insertion HTML (polices du site) ;
 *                         { inline: false } → SVG autonome (rendu raster par sharp).
 */
function couvertureSVG(livre, index, o = { inline: true }) {
  const t = TEINTES[index % TEINTES.length];
  const g = hashNum(livre.slug);
  const titre = decouper(livre.title, 16).slice(0, 4);
  const police = o.inline ? "font-family:var(--font-display)" : "font-family:'DejaVu Serif',Georgia,serif";
  const policeTexte = o.inline ? "font-family:var(--font-sans)" : "font-family:'DejaVu Sans',Arial,sans-serif";
  const y0 = 196 - (titre.length - 1) * 22;
  const lignesTitre = titre
    .map((l, i) => `<text x="200" y="${y0 + i * 46}" text-anchor="middle" fill="${t.encre}" style="${police};font-size:38px;font-weight:600">${esc(l)}</text>`)
    .join('');
  let graticule = '';
  for (let x = 40; x < 400; x += 64) graticule += `M${x},300V560`;
  for (let y = 316; y < 560; y += 64) graticule += `M24,${y}H376`;
  const cx = 200 + ((g % 60) - 30), cy = 430;
  const iso = [1.55, 1.3, 1.12].map((e, i) => `<path d="${contourIle(cx, cy, 52, g % 997 + 7, e)}" fill="none" stroke="${t.accent}" stroke-opacity="${0.25 + i * 0.15}" stroke-width="1.2"/>`).join('');
  const attrs = o.inline
    ? `role="img" aria-label="Couverture du livre « ${esc(livre.title)} » (visuel provisoire)"`
    : 'xmlns="http://www.w3.org/2000/svg"';
  return `<svg ${attrs} viewBox="0 0 400 600" width="400" height="600" class="couverture-svg">`
    + `<rect width="400" height="600" fill="${t.fond}"/>`
    + `<rect x="14" y="14" width="372" height="572" fill="none" stroke="${t.encre}" stroke-opacity=".55"/>`
    + `<rect x="20" y="20" width="360" height="560" fill="none" stroke="${t.encre}" stroke-opacity=".3"/>`
    + `<text x="200" y="66" text-anchor="middle" fill="${t.accent}" style="${policeTexte};font-size:14px;letter-spacing:4px">JACQUES LESCOAT</text>`
    + `<path d="M150,86H250" stroke="${t.accent}" stroke-opacity=".6"/>`
    + lignesTitre
    + `<path d="${graticule}" stroke="${t.encre}" stroke-opacity=".12" fill="none"/>`
    + iso
    + `<path d="${contourIle(cx, cy, 52, g % 997 + 7)}" fill="${t.encre}" fill-opacity=".92"/>`
    + `<text x="200" y="560" text-anchor="middle" fill="${t.encre}" fill-opacity=".7" style="${policeTexte};font-size:12px;letter-spacing:3px">GÉOGRAPHIE · BRETAGNE</text>`
    + `</svg>`;
}

/** Portrait de substitution : médaillon ovale à courbes de niveau (pas de silhouette inventée). */
function portraitSVG() {
  const courbes = [1, 0.82, 0.64, 0.46, 0.3]
    .map((e, i) => `<path d="${contourIle(200, 250, 92, 41, e)}" class="p-courbe" style="opacity:${0.35 + i * 0.13}"/>`)
    .join('');
  return `<svg role="img" aria-label="Emplacement du portrait de Jacques Lescoat (photo à venir)" viewBox="0 0 400 500" width="400" height="500" class="portrait-svg">
<!-- À REMPLACER : portrait de l'auteur (assets/portrait.jpg) -->
<rect width="400" height="500" class="p-fond"/>
<ellipse cx="200" cy="250" rx="168" ry="218" class="p-cadre"/>
<ellipse cx="200" cy="250" rx="158" ry="208" class="p-cadre p-cadre--fin"/>
${courbes}
<circle cx="214" cy="244" r="5" class="p-point"/>
<text x="200" y="448" text-anchor="middle" class="p-legende">PORTRAIT À VENIR</text>
</svg>`;
}

/**
 * Image de partage Open Graph 1200×630 (SVG rendu en JPEG par sharp).
 * La couverture est composée par-dessus, à gauche, par build.js.
 */
function partageSVG({ titre, sousTitre, surtitre = 'JACQUES LESCOAT · GÉOGRAPHE', avecCouverture = true, coteD = '' }) {
  const x = avecCouverture ? 470 : 90;
  const lignes = decouper(titre, avecCouverture ? 22 : 30).slice(0, 3);
  const sous = decouper(sousTitre || '', avecCouverture ? 44 : 60).slice(0, 3);
  const yT = 250 - (lignes.length - 1) * 30;
  const serif = "font-family:'DejaVu Serif',Georgia,serif";
  const sans = "font-family:'DejaVu Sans',Arial,sans-serif";
  let grille = '';
  for (let gx = 60; gx < 1200; gx += 90) grille += `M${gx},0V630`;
  for (let gy = 45; gy < 630; gy += 90) grille += `M0,${gy}H1200`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#F5EFE2"/>
<path d="${grille}" stroke="#3F5A73" stroke-opacity=".09" fill="none"/>
${coteD ? `<g transform="translate(560 120) scale(.62)" opacity=".16"><path d="${coteD}" fill="none" stroke="#1B2A41" stroke-width="3"/></g>` : ''}
<rect x="18" y="18" width="1164" height="594" fill="none" stroke="#1B2A41" stroke-width="2"/>
<rect x="28" y="28" width="1144" height="574" fill="none" stroke="#1B2A41" stroke-opacity=".4"/>
<text x="${x}" y="150" fill="#7A5A28" style="${sans};font-size:24px;letter-spacing:5px">${esc(surtitre)}</text>
${lignes.map((l, i) => `<text x="${x}" y="${yT + i * 64}" fill="#1B2A41" style="${serif};font-size:56px;font-weight:bold">${esc(l)}</text>`).join('')}
${sous.map((l, i) => `<text x="${x}" y="${yT + lignes.length * 64 + 24 + i * 38}" fill="#3F5A73" style="${serif};font-size:28px">${esc(l)}</text>`).join('')}
<text x="${x}" y="560" fill="#1B2A41" fill-opacity=".75" style="${sans};font-size:22px;letter-spacing:2px">jlescoat.glsc.fr</text>
</svg>`;
}

/** Favicon : rose des vents minimaliste. */
function faviconSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1B2A41"/><path d="M32 6 38 32 32 58 26 32Z" fill="#F3ECDC"/><path d="M6 32 32 26 58 32 32 38Z" fill="#C9A266"/><circle cx="32" cy="32" r="4" fill="#1B2A41" stroke="#F3ECDC" stroke-width="2"/></svg>`;
}

module.exports = { couvertureSVG, portraitSVG, partageSVG, faviconSVG, decouper };
