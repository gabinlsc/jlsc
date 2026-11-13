# Contenus à fournir, remplacer ou vérifier

Le site est publiable en l'état, mais plusieurs contenus sont provisoires.
Dans le HTML généré, ils sont repérés par des commentaires :
`<!-- À REMPLACER -->`, `<!-- À VÉRIFIER -->`, `<!-- À RELIRE -->`, `<!-- À AFFINER : fond de carte -->`.
`npm run build` affiche le nombre de marques restantes.

## 1. Livres — `data/books.json`

Les 3 livres actuels sont des **exemples** (pastille « Livre d'exemple » visible sur le site).

- [ ] Remplacer par les vrais livres : titre, sous-titre, année, nombre de pages, ISBN, format, prix TTC.
- [ ] Synopsis, extrait, sommaire de chaque livre.
- [ ] Territoires et thèmes associés à chaque livre.
- [ ] Couvertures : `assets/covers/<slug>.jpg` (1200 × 1800 px) — voir `assets/README.md`.
- [ ] Retirer `"exemple": true`, choisir le livre à la une (`"featured": true`).
- [ ] Une fois Payhip prêt : `payhipProductId` de chaque livre (voir README).

## 2. Auteur — `data/auteur.json`, `site.config.json`

- [ ] **Biographie** : la trame actuelle est provisoire (`À RELIRE`, bandeau « Texte provisoire » visible). Fournir le texte validé, puis passer `"provisoire": false`.
- [ ] Parcours (dates, établissements, fonctions) et thèmes de recherche.
- [ ] **Portrait** : `assets/portrait.jpg`.
- [ ] Adresse e-mail de contact (`author.email`, actuellement `contact@jlescoat.glsc.fr`) : vérifier qu'elle existe et reçoit le courrier.
- [ ] Liens éventuels (`author.sameAs` : page éditeur, Wikipédia, BnF/IdRef…).

## 3. Territoires — `data/territoires.json`

- [ ] Relire chaque présentation : textes volontairement généraux (`À VÉRIFIER`), à compléter par l'auteur (relief, habitat, liaisons, activités).
- [ ] Vérifier les noms bretons.
- [ ] Ajouter ou retirer des territoires selon les livres.

## 4. Événements — `data/events.json`

- [ ] Ajouter les conférences et dédicaces à venir (liste vide = message « aucune date programmée »).

## 5. Mentions légales, confidentialité, CGV — `site.config.json` (section `legal`)

- [ ] **Statut** de l'auteur : `particulier`, `micro-entreprise` ou `association` (les pages s'adaptent).
- [ ] Adresse postale, SIRET (ou RNA pour une association), mention TVA.
- [ ] **Hébergeur** : nom, adresse et téléphone du fournisseur du VPS (obligation LCEN).
- [ ] **Médiateur de la consommation** (obligatoire pour un vendeur professionnel) : nom et site.
- [ ] Délai d'expédition et zones de livraison (CGV §6), cohérents avec les réglages Payhip.
- [ ] Frais de port des livres : montant minimal légal en vigueur (loi n° 2021-1901 dite « Darcos » et arrêté d'application) — à appliquer dans Payhip.
- [ ] Faire relire les CGV par un professionnel du droit.
- [ ] Durée de conservation des journaux Nginx (politique de confidentialité) : vérifier la rotation `logrotate` du serveur.

## 6. Payhip

- [ ] Créer le compte et les produits **physiques** (livres papier) : frais de port, zones de livraison, champ « note de commande » pour les dédicaces.
- [ ] Vérifier l'affichage de l'overlay de paiement sur le site après branchement (téléphone et ordinateur).

## 7. Formulaires — `site.config.json` (section `forms`)

- [ ] Par défaut, les formulaires ouvrent la messagerie du visiteur (`mailto:`). Pour un envoi direct sans messagerie, créer un formulaire chez un service (ex. Formspree, Basin) et coller son URL dans `contactAction` / `notifyAction`, puis relancer le déploiement (la CSP est mise à jour automatiquement) et nommer ce service dans la politique de confidentialité.

## 8. Fond de carte — `src/components/fond-de-carte.js`

Le trait de côte actuel est un **tracé stylisé saisi à la main** (`À AFFINER : fond de carte`), suffisant pour la navigation du site mais pas exact. Pour un tracé définitif, générer un SVG simplifié à partir de données libres :

| Source | Données | Licence / attribution requise |
|---|---|---|
| **OpenStreetMap** — [osmdata.openstreetmap.de](https://osmdata.openstreetmap.de/data/coastlines.html) (coastlines) | trait de côte détaillé, îles | ODbL — « © les contributeurs d'OpenStreetMap » |
| **IGN** — [BD TOPO / Admin Express](https://geoservices.ign.fr/) | limites communales et départementales, côtes | Licence Ouverte Etalab 2.0 — « Source : IGN » |
| **Natural Earth** — [naturalearthdata.com](https://www.naturalearthdata.com/) (1:10m coastline) | côtes très simplifiées | domaine public — mention appréciée, non obligatoire |
| **SHOM** — [data.shom.fr](https://data.shom.fr/) | isobathes réelles (bathymétrie) | Licence Ouverte Etalab 2.0 ou licence SHOM selon le jeu |

Méthode conseillée : découper l'emprise (5,65° O – 1,3° O, 46,85° N – 49° N) avec [mapshaper.org](https://mapshaper.org/), simplifier (≈ 1 à 2 %), exporter en SVG ou en GeoJSON, puis remplacer `COTE` et `ILES` (mêmes coordonnées longitude/latitude). Ajouter l'attribution correspondante dans la page Mentions légales (paragraphe « Fond de carte »).

## 9. Après mise en ligne

- [ ] Image de partage : tester un lien dans Facebook ([débogueur de partage](https://developers.facebook.com/tools/debug/)) et WhatsApp.
- [ ] Déclarer le site dans Google Search Console et soumettre `https://jlescoat.glsc.fr/sitemap.xml`.
- [ ] (Facultatif) Activer une mesure d'audience sans cookie (Plausible ou Umami) dans `site.config.json`, puis relancer le déploiement.
