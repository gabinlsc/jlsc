/**
 * Petites fonctions utilitaires partagées par tous les gabarits.
 */
'use strict';

/** Échappe une chaîne pour l'insérer dans du HTML (texte ou attribut). */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Échappe le texte mais conserve les commentaires HTML de suivi éditorial
 * (<!-- À VÉRIFIER -->, <!-- À RELIRE -->, <!-- À REMPLACER -->) présents dans les données.
 */
function escKeepComments(value) {
  return String(value ?? '')
    .split(/(<!--[\s\S]*?-->)/)
    .map((part) => (part.startsWith('<!--') ? part : esc(part)))
    .join('');
}

/** Supprime les commentaires HTML (pour les meta, JSON-LD, attributs). */
function stripComments(value) {
  return String(value ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
}

/** Tronque proprement un texte à n caractères (pour les meta description). */
function truncate(text, n = 158) {
  const t = stripComments(text);
  if (t.length <= n) return t;
  return t.slice(0, t.lastIndexOf(' ', n - 1)).replace(/[,;:.\s—-]+$/, '') + '…';
}

/** Concatène des classes CSS en ignorant les valeurs vides. */
function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

/** Convertit un prix « 18,00 € » en nombre (18). Renvoie 0 si absent. */
function priceValue(price) {
  const n = parseFloat(String(price || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Affiche le prix ou un libellé neutre si le prix n'est pas encore fixé. */
function priceLabel(price) {
  return priceValue(price) > 0 ? String(price) : 'Prix à venir';
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « 2026-12-05 » → « samedi 5 décembre 2026 ». */
function formatDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${JOURS[date.getUTCDay()]} ${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`;
}

/** Pluriel simple : plural(2, 'livre') → « 2 livres ». */
function plural(n, singular, pluralForm) {
  return `${n} ${n > 1 ? pluralForm || singular + 's' : singular}`;
}

/** Sérialise un objet JSON-LD en échappant les séquences dangereuses. */
function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

module.exports = { esc, escKeepComments, stripComments, truncate, cx, priceValue, priceLabel, formatDate, plural, jsonLd };
