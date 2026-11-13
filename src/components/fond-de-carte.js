/**
 * FOND DE CARTE — Bretagne stylisée.
 * <!-- À AFFINER : fond de carte -->
 *
 * Le trait de côte ci-dessous est un tracé SIMPLIFIÉ, saisi à la main en
 * longitude/latitude (degrés décimaux, WGS84) à partir de repères connus
 * (caps, baies, ports). Il suffit pour une carte de navigation du site, pas
 * pour un usage cartographique. Pour un tracé définitif, voir TODO-CONTENU.md
 * (OpenStreetMap / IGN Admin Express / Natural Earth, avec attributions).
 *
 * Tous les points sont projetés au moment du build par src/components/carte.js.
 */
'use strict';

/** Emprise de la carte (degrés) et taille du viewBox SVG. */
const EMPRISE = { ouest: -5.65, est: -1.3, nord: 49.0, sud: 46.85, largeur: 1000 };

/**
 * Trait de côte continental, d'est en ouest par le nord, puis vers l'est par le sud.
 * Chaque point : [longitude, latitude].
 */
const COTE = [
  [-1.62, 49.06], [-1.6, 48.96], [-1.57, 48.84], [-1.52, 48.74], [-1.4, 48.67], [-1.51, 48.62],
  [-1.7, 48.61], [-1.85, 48.65], [-1.84, 48.71], [-1.95, 48.66], [-2.02, 48.65], [-2.06, 48.62],
  [-2.13, 48.64], [-2.23, 48.63], [-2.32, 48.68], [-2.4, 48.64], [-2.46, 48.63], [-2.56, 48.58],
  [-2.7, 48.52], [-2.78, 48.57], [-2.83, 48.63], [-2.95, 48.72], [-3.03, 48.78], [-3.02, 48.83],
  [-3.14, 48.85], [-3.22, 48.84], [-3.35, 48.83], [-3.44, 48.82], [-3.52, 48.83], [-3.57, 48.78],
  [-3.55, 48.72], [-3.65, 48.68], [-3.78, 48.66], [-3.85, 48.63], [-3.92, 48.68], [-3.98, 48.72],
  [-4.08, 48.69], [-4.17, 48.67], [-4.33, 48.68], [-4.45, 48.63], [-4.56, 48.61], [-4.71, 48.56],
  [-4.77, 48.5], [-4.76, 48.43], [-4.78, 48.36], [-4.77, 48.33], [-4.62, 48.34], [-4.55, 48.36],
  [-4.48, 48.38], [-4.36, 48.4], [-4.3, 48.35], [-4.25, 48.3], [-4.33, 48.28], [-4.45, 48.31],
  [-4.53, 48.33], [-4.57, 48.29], [-4.62, 48.28], [-4.63, 48.24], [-4.56, 48.21], [-4.55, 48.17],
  [-4.5, 48.22], [-4.43, 48.25], [-4.32, 48.2], [-4.33, 48.1], [-4.45, 48.09], [-4.58, 48.07],
  [-4.68, 48.05], [-4.74, 48.04], [-4.66, 48.02], [-4.53, 48.01], [-4.4, 47.9], [-4.37, 47.8],
  [-4.22, 47.8], [-4.13, 47.86], [-4.0, 47.88], [-3.92, 47.86], [-3.85, 47.8], [-3.72, 47.79],
  [-3.55, 47.76], [-3.42, 47.73], [-3.36, 47.74], [-3.36, 47.69], [-3.22, 47.65], [-3.15, 47.6],
  [-3.14, 47.53], [-3.12, 47.48], [-3.09, 47.51], [-3.1, 47.57], [-3.03, 47.58], [-2.95, 47.56],
  [-2.98, 47.62], [-2.93, 47.66], [-2.76, 47.66], [-2.68, 47.61], [-2.76, 47.56], [-2.91, 47.55],
  [-2.89, 47.5], [-2.75, 47.49], [-2.6, 47.51], [-2.5, 47.5], [-2.48, 47.42], [-2.55, 47.38],
  [-2.5, 47.3], [-2.39, 47.27], [-2.25, 47.25], [-2.2, 47.27], [-2.1, 47.29], [-1.95, 47.28],
  [-1.85, 47.24], [-1.95, 47.24], [-2.05, 47.26], [-2.17, 47.23], [-2.17, 47.13], [-2.1, 47.1],
  [-2.03, 47.06], [-1.98, 46.98], [-2.05, 46.93], [-2.12, 46.84]
];

/** Points ajoutés hors champ pour fermer la surface « terre » (non tracés). */
const FERMETURE_TERRE = [[-1.1, 46.8], [-1.1, 49.1], [-1.62, 49.1]];

/**
 * Îles dessinées comme des « galets » irréguliers.
 * [longitude, latitude, demi-longueur km, demi-largeur km, rotation °, graine]
 * Les petites îles sans fiche territoire servent seulement de décor.
 */
const ILES = [
  [-5.09, 48.46, 3.6, 2.0, 20, 1],   // Ouessant
  [-4.96, 48.4, 0.9, 0.6, 10, 2],     // Molène
  [-4.92, 48.42, 0.5, 0.3, 30, 3],    // îlots de l'archipel de Molène
  [-4.99, 48.38, 0.4, 0.3, 0, 4],
  [-4.85, 48.04, 1.2, 0.35, -15, 5],  // Sein
  [-3.99, 47.72, 0.6, 0.4, 0, 6],     // Glénan
  [-4.02, 47.71, 0.35, 0.25, 0, 7],
  [-3.96, 47.71, 0.3, 0.25, 0, 8],
  [-3.46, 47.64, 4.0, 1.6, -22, 9],   // Groix
  [-3.18, 47.33, 8.5, 3.6, -38, 10],  // Belle-Île
  [-2.96, 47.39, 2.4, 0.8, -45, 11],  // Houat
  [-2.88, 47.34, 1.3, 0.6, -35, 12],  // Hoëdic
  [-2.85, 47.6, 2.0, 0.7, -70, 13],   // Île-aux-Moines
  [-2.8, 47.595, 1.6, 0.8, 25, 14],   // Île d'Arz
  [-3.0, 48.85, 1.2, 1.7, 0, 15],     // Bréhat
  [-4.02, 48.75, 2.0, 0.8, 0, 16],    // Batz
  [-3.49, 48.88, 0.4, 0.3, 0, 17],    // Sept-Îles
  [-3.45, 48.875, 0.3, 0.2, 0, 18],
  [-2.25, 46.99, 7.0, 1.6, -60, 19]   // Noirmoutier (repère, hors Bretagne)
];

/** Villes de repère (non interactives). [nom, longitude, latitude, position du nom] */
const VILLES = [
  ['Brest', -4.48, 48.39, 'right'],
  ['Quimper', -4.1, 47.99, 'right'],
  ['Lorient', -3.37, 47.75, 'above'],
  ['Saint-Brieuc', -2.76, 48.51, 'below'],
  ['Saint-Malo', -2.01, 48.65, 'right'],
  ['Rennes', -1.68, 48.11, 'right'],
  ['Nantes', -1.55, 47.22, 'right']
];

/** Noms des mers (texte en italique sur la carte). [texte, longitude, latitude, rotation] */
const MERS = [
  ['Manche', -2.45, 48.9, 0],
  ['Océan Atlantique', -4.6, 47.42, -14]
];

module.exports = { EMPRISE, COTE, FERMETURE_TERRE, ILES, VILLES, MERS };
