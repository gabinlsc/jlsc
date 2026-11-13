/**
 * COMPOSANT CARTE — génère la carte SVG inline de la Bretagne et de ses îles.
 *
 * - Projection équirectangulaire corrigée par cos(48°) : suffisante à cette
 *   échelle et sans dépendance externe (aucune tuile, aucune requête tierce).
 * - Deux modes :
 *   • 'interactive' : chaque territoire est un lien SVG focusable (clavier),
 *     avec infobulle (gérée par src/js/carte.js) et zoom par boutons.
 *   • 'locator' : petite carte de situation, décorative (aria-hidden), qui
 *     met en valeur un seul territoire.
 * <!-- À AFFINER : fond de carte --> (voir fond-de-carte.js)
 */
'use strict';

const { esc, plural } = require('../templates/helpers');
const { EMPRISE, COTE, FERMETURE_TERRE, ILES, VILLES, MERS } = require('./fond-de-carte');

const COS = Math.cos((48 * Math.PI) / 180);
const K = EMPRISE.largeur / ((EMPRISE.est - EMPRISE.ouest) * COS);
const W = EMPRISE.largeur;
const H = Math.round((EMPRISE.nord - EMPRISE.sud) * K);
const PX_PAR_KM = K / 111.32;

/** Projette [lon, lat] en coordonnées SVG arrondies au dixième. */
function projeter(lon, lat) {
  const x = (lon - EMPRISE.ouest) * COS * K;
  const y = (EMPRISE.nord - lat) * K;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

const r1 = (n) => Math.round(n * 10) / 10;

/** Courbe lissée (Catmull-Rom → Bézier cubique) passant par tous les points. */
function courbe(points, fermee = false) {
  const p = points;
  const n = p.length;
  const at = (i) => (fermee ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${p[0][0]},${p[0][1]}`;
  const fin = fermee ? n : n - 1;
  for (let i = 0; i < fin; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [r1(p1[0] + (p2[0] - p0[0]) / 6), r1(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [r1(p2[0] - (p3[0] - p1[0]) / 6), r1(p2[1] - (p3[1] - p1[1]) / 6)];
    d += `C${c1} ${c2} ${p2}`;
  }
  return fermee ? d + 'Z' : d;
}

/** Générateur pseudo-aléatoire déterministe (même dessin à chaque build). */
function aleatoire(graine) {
  let s = graine * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** Dessine une île en « galet » irrégulier autour d'une ellipse. */
function ile([lon, lat, demiLong, demiLarg, rotation, graine]) {
  const [cx, cy] = projeter(lon, lat);
  const rnd = aleatoire(graine);
  const a = (-rotation * Math.PI) / 180;
  const rx = Math.max(demiLong * PX_PAR_KM, 1.6);
  const ry = Math.max(demiLarg * PX_PAR_KM, 1.2);
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const f = 0.8 + rnd() * 0.32;
    const ex = Math.cos(t) * rx * f;
    const ey = Math.sin(t) * ry * f;
    pts.push([r1(cx + ex * Math.cos(a) - ey * Math.sin(a)), r1(cy + ex * Math.sin(a) + ey * Math.cos(a))]);
  }
  return courbe(pts, true);
}

/** Position du libellé autour d'un point selon 'left' | 'right' | 'above' | 'below'. */
function libelle(x, y, pos = 'right', ecart = 12) {
  switch (pos) {
    case 'left': return { x: x - ecart, y: y + 5, anchor: 'end' };
    case 'above': return { x, y: y - ecart, anchor: 'middle' };
    case 'below': return { x, y: y + ecart + 10, anchor: 'middle' };
    default: return { x: x + ecart, y: y + 5, anchor: 'start' };
  }
}

/** Cadre d'atlas : graduations alternées tous les 0,25°. */
function cadre() {
  const e = 7;
  let s = `<rect class="c-cadre" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}"/>`;
  s += `<rect class="c-cadre" x="${e}" y="${e}" width="${W - 2 * e}" height="${H - 2 * e}"/>`;
  let alt = 0;
  for (let lon = -5.75; lon < EMPRISE.est; lon += 0.25) {
    const x0 = Math.max(e, projeter(lon, 0)[0]);
    const x1 = Math.min(W - e, projeter(lon + 0.25, 0)[0]);
    if (alt++ % 2 === 0 && x1 > x0) {
      s += `<rect class="c-grad" x="${x0}" y="0" width="${r1(x1 - x0)}" height="${e}"/><rect class="c-grad" x="${x0}" y="${H - e}" width="${r1(x1 - x0)}" height="${e}"/>`;
    }
  }
  alt = 0;
  for (let lat = 49; lat > EMPRISE.sud; lat -= 0.25) {
    const y0 = Math.max(e, projeter(0, lat)[1]);
    const y1 = Math.min(H - e, projeter(0, lat - 0.25)[1]);
    if (alt++ % 2 === 0 && y1 > y0) {
      s += `<rect class="c-grad" x="0" y="${y0}" width="${e}" height="${r1(y1 - y0)}"/><rect class="c-grad" x="${W - e}" y="${y0}" width="${e}" height="${r1(y1 - y0)}"/>`;
    }
  }
  return s;
}

/** Méridiens et parallèles tous les 0,5°, libellés aux degrés entiers. */
function graticule() {
  let lignes = '';
  let textes = '';
  for (let lon = -5.5; lon <= -1.5; lon += 0.5) {
    const [x] = projeter(lon, 0);
    lignes += `M${x},0V${H}`;
    if (Number.isInteger(lon)) textes += `<text class="c-grad-txt" x="${x + 4}" y="${H - 14}">${Math.abs(lon)}° O</text>`;
  }
  for (let lat = 47; lat <= 48.5; lat += 0.5) {
    const [, y] = projeter(0, lat);
    lignes += `M0,${y}H${W}`;
    if (Number.isInteger(lat)) textes += `<text class="c-grad-txt" x="${W - 14}" y="${y - 4}" text-anchor="end">${lat}° N</text>`;
  }
  return `<path class="c-graticule" d="${lignes}"/>${textes}`;
}

/** Rose des vents simplifiée (4 branches principales + 4 secondaires). */
function roseDesVents(cx, cy, r) {
  const branche = (angle, long, large) => {
    const a = (angle * Math.PI) / 180;
    const p = (d, da) => [r1(cx + Math.sin(a + da) * d), r1(cy - Math.cos(a + da) * d)];
    const pointe = p(long, 0);
    const g = p(large, -Math.PI / 4);
    const dr = p(large, Math.PI / 4);
    return `<path class="c-rose-a" d="M${cx},${cy}L${pointe}L${g}Z"/><path class="c-rose-b" d="M${cx},${cy}L${pointe}L${dr}Z"/>`;
  };
  let s = `<g class="c-rose" aria-hidden="true"><circle class="c-rose-cercle" cx="${cx}" cy="${cy}" r="${r * 0.72}"/>`;
  for (const a of [45, 135, 225, 315]) s += branche(a, r * 0.62, r * 0.14);
  for (const a of [0, 90, 180, 270]) s += branche(a, r, r * 0.2);
  s += `<text class="c-rose-n" x="${cx}" y="${cy - r - 6}" text-anchor="middle">N</text></g>`;
  return s;
}

/** Cartouche de titre avec échelle graphique (50 km). */
function cartouche(titre, sousTitre) {
  const x = 30, y = H - 130, w = 300, h = 98;
  const km50 = r1(50 * PX_PAR_KM);
  const ex = x + 22, ey = y + 74;
  return `<g class="c-cartouche">
<rect class="c-cart-fond" x="${x}" y="${y}" width="${w}" height="${h}"/>
<rect class="c-cart-cadre" x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}"/>
<text class="c-cart-titre" x="${x + 22}" y="${y + 32}">${esc(titre)}</text>
<text class="c-cart-sous" x="${x + 22}" y="${y + 52}">${esc(sousTitre)}</text>
<rect class="c-echelle-a" x="${ex}" y="${ey}" width="${r1(km50 / 2)}" height="5"/>
<rect class="c-echelle-b" x="${r1(ex + km50 / 2)}" y="${ey}" width="${r1(km50 / 2)}" height="5"/>
<text class="c-echelle-txt" x="${ex}" y="${ey + 18}" text-anchor="middle">0</text>
<text class="c-echelle-txt" x="${r1(ex + km50 / 2)}" y="${ey + 18}" text-anchor="middle">25</text>
<text class="c-echelle-txt" x="${r1(ex + km50)}" y="${ey + 18}" text-anchor="middle">50 km</text>
</g>`;
}

/**
 * Génère le SVG complet.
 * @param {object} o
 * @param {Array} o.territoires   données de data/territoires.json
 * @param {Object} o.compte       { slug: nombre de livres }
 * @param {'interactive'|'locator'} o.mode
 * @param {string} [o.highlight]  slug à mettre en valeur (mode locator)
 * @param {string} o.id           préfixe d'identifiants (unique par page)
 * @param {string} [o.titre]      titre du cartouche
 */
function carteSVG({ territoires, compte = {}, mode = 'interactive', highlight = '', id = 'carte', titre = 'Les îles de Bretagne' }) {
  const interactive = mode === 'interactive';
  const cote = COTE.map(([lon, lat]) => projeter(lon, lat));
  const fermeture = FERMETURE_TERRE.map(([lon, lat]) => projeter(lon, lat));
  const dCote = courbe(cote);
  const dTerre = `${dCote}L${fermeture.map((p) => p.join(',')).join('L')}Z`;
  const dIles = ILES.map(ile).join('');

  // Villes de repère
  const villes = VILLES.map(([nom, lon, lat, pos]) => {
    const [x, y] = projeter(lon, lat);
    const l = libelle(x, y, pos, 8);
    return `<circle class="c-ville" cx="${x}" cy="${y}" r="3"/><text class="c-ville-nom" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${esc(nom)}</text>`;
  }).join('');

  const mers = MERS.map(([nom, lon, lat, rot]) => {
    const [x, y] = projeter(lon, lat);
    return `<text class="c-mer" x="${x}" y="${y}" text-anchor="middle" transform="rotate(${rot} ${x} ${y})">${esc(nom)}</text>`;
  }).join('');

  // Territoires
  const lieux = territoires
    .filter((t) => typeof t.lon === 'number' && typeof t.lat === 'number')
    .map((t) => {
      const [x, y] = projeter(t.lon, t.lat);
      const n = compte[t.slug] || 0;
      const zone = t.type === 'zone';
      const l = libelle(x, y, (t.label && t.label.pos) || 'right', zone ? 30 : 12);
      const actif = highlight === t.slug;
      const classes = ['lieu', zone ? 'lieu--zone' : 'lieu--ile', n ? 'lieu--livres' : '', actif ? 'lieu--actif' : ''].filter(Boolean).join(' ');
      const forme = zone
        ? `<circle class="lieu-cercle" cx="${x}" cy="${y}" r="24"/>`
        : `<circle class="lieu-halo" cx="${x}" cy="${y}" r="11"/><circle class="lieu-point" cx="${x}" cy="${y}" r="5.5"/>`;
      const nom = `<text class="lieu-nom" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${esc(t.name)}</text>`;
      if (!interactive) {
        if (!actif) return zone ? '' : `<circle class="lieu-mini" cx="${x}" cy="${y}" r="3.5"/>`;
        return `<g class="${classes}">${forme}${nom}</g>`;
      }
      const info = n ? plural(n, 'livre') : 'Présentation du territoire';
      return `<a class="${classes}" href="/territoires/${esc(t.slug)}/" data-nom="${esc(t.name)}" data-info="${esc(info)}" data-x="${x}" data-y="${y}" aria-label="${esc(`${t.name} — ${t.type}, ${info}`)}">`
        + `<circle class="lieu-cible" cx="${x}" cy="${y}" r="${zone ? 26 : 16}"/>${forme}${nom}</a>`;
    })
    .join('');

  const attrsSvg = interactive
    ? `role="group" aria-labelledby="${id}-titre" aria-describedby="${id}-desc"`
    : 'aria-hidden="true" focusable="false"';

  // Le tracé progressif des côtes est porté par la classe .c-cote (pathLength="1").
  return `<svg class="carte-svg carte-svg--${mode}" id="${id}-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${attrsSvg} xmlns="http://www.w3.org/2000/svg">
<!-- À AFFINER : fond de carte -->
${interactive ? `<title id="${id}-titre">Carte des îles et territoires de Bretagne</title><desc id="${id}-desc">Carte stylisée de la Bretagne. Chaque île ou territoire est un lien vers sa page et les livres qui lui sont consacrés. La liste des mêmes liens figure sous la carte.</desc>` : ''}
<defs>
<pattern id="${id}-houle" width="14" height="6" patternUnits="userSpaceOnUse"><path class="c-houle" d="M0,3 Q3.5,0.5 7,3 T14,3"/></pattern>
<path id="${id}-terre" d="${dTerre}"/>
<path id="${id}-iles" d="${dIles}"/>
</defs>
<rect class="c-mer-fond" width="${W}" height="${H}"/>
<rect fill="url(#${id}-houle)" width="${W}" height="${H}" opacity=".5"/>
${graticule()}
<g class="c-isobathes"><use href="#${id}-terre" class="c-iso3"/><use href="#${id}-iles" class="c-iso3"/><use href="#${id}-terre" class="c-iso2"/><use href="#${id}-iles" class="c-iso2"/><use href="#${id}-terre" class="c-iso1"/><use href="#${id}-iles" class="c-iso1"/></g>
<g class="c-terres"><use href="#${id}-terre" class="c-terre"/><use href="#${id}-iles" class="c-ile"/></g>
<path class="c-cote" d="${dCote}" pathLength="1"/>
<use href="#${id}-iles" class="c-cote-ile"/>
<g class="c-decor">${mers}${villes}</g>
${interactive ? roseDesVents(108, 112, 58) : ''}
${interactive ? cartouche(titre, 'Planche I — tracé simplifié') : ''}
<g class="c-lieux">${lieux}</g>
${cadre()}
</svg>`;
}

module.exports = { carteSVG, projeter, VIEWBOX: { W, H } };
