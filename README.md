# Jacques Lescoat — site vitrine

Site statique de Jacques Lescoat, géographe et auteur de livres sur la Bretagne et ses îles.
Production : **https://jlescoat.glsc.fr**

HTML généré par `build.js` (Node, sans framework), Tailwind CSS (CLI), JavaScript vanilla (< 15 Ko), polices auto-hébergées, carte SVG inline, aucune requête tierce hors Payhip.

## Installation

```bash
npm ci
```

```bash
npm run dev       # build + surveillance + aperçu sur http://localhost:8080
```

```bash
npm run build     # génère dist/
```

```bash
npm run preview   # build puis aperçu de dist/
```

```bash
npm run check     # vérifie tous les liens internes de dist/
```

Node ≥ 18 requis. Le build valide les données et affiche une erreur claire en cas de problème (JSON invalide, territoire inconnu…).

## Arborescence

```
site.config.json          nom, e-mail, formulaires, mentions légales, livraison, analytics
data/books.json           livres (1 objet = 1 livre)
data/territoires.json     îles et zones (longitude/latitude → position sur la carte)
data/events.json          conférences et dédicaces
data/auteur.json          biographie
assets/                   images réelles (couvertures, portrait) — voir assets/README.md
src/templates/            gabarits HTML (layout, composants, pages)
src/components/           carte SVG, fond de carte, visuels de substitution
src/styles/main.css       styles (Tailwind + direction artistique)
src/js/                   scripts navigateur
build.js                  générateur → dist/
deploy.sh                 déploiement, à lancer sur le serveur (curl … | sudo bash)
TODO-CONTENU.md           contenus à fournir ou vérifier
```

## Ajouter un livre

1. Ajouter un objet dans `data/books.json` (copier un livre existant). `slug` : minuscules et tirets, il devient l'adresse `/livres/<slug>/`.
2. `territoires` : slugs existants de `data/territoires.json`. `themes` : libres (alimentent le filtre du catalogue).
3. Déposer la couverture à l'emplacement indiqué par `cover` (ex. `assets/covers/<slug>.jpg`, 1200 px de large conseillés). Sans fichier, une couverture provisoire est dessinée.
4. Retirer `"exemple": true` ; mettre `"featured": true` sur le livre à la une.
5. `npm run build` pour vérifier, puis pousser sur GitHub et relancer la commande de déploiement sur le serveur.

Champs : `slug, title, subtitle, year, pages, isbn, price ("18,00 €"), format, territoires[], themes[], cover, synopsis, extract, tableOfContents[], payhipProductId, payhipUrl, exemple, featured`.

## Ajouter un territoire

Ajouter un objet dans `data/territoires.json` : `slug`, `name`, `breton`, `type` (`île`, `archipel`, `zone`, `région`), `departement`, `lon`/`lat` (degrés décimaux, ex. `-3.46` / `47.64`, relevés sur openstreetmap.org), `label.pos` (`left`, `right`, `above`, `below` : position du nom sur la carte), `intro`, `presentation` (liste de paragraphes). Le point apparaît automatiquement sur la carte et la page `/territoires/<slug>/` est créée. `lon`/`lat` à `null` : page sans point sur la carte.

## Événements

`data/events.json` : `[{ "date": "2027-03-14", "heure": "18:00", "titre": "…", "type": "Conférence", "lieu": "Médiathèque", "ville": "Lorient", "description": "…", "url": "https://…" }]`. Liste vide = message sobre. Les dates passées basculent dans « Rendez-vous passés ».

## Brancher Payhip

1. Créer le produit sur payhip.com (livre papier : produit **physique**, régler les frais de port — minimum légal pour les livres, voir CGV).
2. Copier l'ID du produit (la fin de l'adresse `payhip.com/b/AbC12` → `AbC12`).
3. Le coller dans `payhipProductId` du livre dans `data/books.json` (et le prix dans `price`).
4. `npm run build` pour vérifier
5. Pousser sur GitHub puis relancer la commande de déploiement sur le serveur — le bouton « Acheter » ouvre alors le paiement Payhip ; sans ID, il ouvre la modale « Bientôt disponible ».

## Déploiement

Tout se fait **sur le serveur**, avec une seule commande (aucun fichier à copier ni à remplir) :

```bash
curl -fsSL https://raw.githubusercontent.com/gabinlsc/jlsc/main/deploy.sh | sudo EMAIL=ton@email.fr bash
```

1. Prérequis DNS : chez le gestionnaire de `glsc.fr`, enregistrement **A** `jlescoat` → IP du VPS.
2. La même commande sert pour l'installation et pour chaque mise à jour : elle installe ce qui manque (Nginx, Certbot, Node dans `/opt/jlescoat/node`), récupère le code, construit le site, met en place HTTPS et met en ligne sans coupure. Elle ne touche à aucun autre site du serveur.
3. Si le healthcheck échoue, la version précédente est remise en ligne automatiquement.
4. Retour arrière : `… | sudo bash -s -- rollback` · état : `… | sudo bash -s -- status` · simulation : `… | sudo bash -s -- --dry-run`.
5. Dépôt privé : ajouter `GITHUB_TOKEN=<jeton en lecture>` après `sudo` (dans `curl`, ajouter aussi `-H "Authorization: token <jeton>"`).
6. Autres réglages possibles : `BRANCH`, `DOMAIN`, `WEB_ROOT`, `KEEP_RELEASES` (voir l'en-tête de `deploy.sh`).

### Vérifications après déploiement

```bash
curl -I https://jlescoat.glsc.fr/
```

```bash
curl -I http://jlescoat.glsc.fr/
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://jlescoat.glsc.fr/404.html
```

```bash
echo | openssl s_client -connect jlescoat.glsc.fr:443 -servername jlescoat.glsc.fr 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Test complet du certificat : https://www.ssllabs.com/ssltest/analyze.html?d=jlescoat.glsc.fr (objectif A ou A+). En-têtes : https://securityheaders.com/?q=jlescoat.glsc.fr


## Choix techniques

- **Accessibilité** : corps 18 px, police Atkinson Hyperlegible (conçue pour la basse vision), boutons A−/A+, focus très visibles, carte entièrement utilisable au clavier avec liste alternative, `prefers-reduced-motion` respecté.
- **Vie privée** : aucun cookie, aucune ressource tierce hors Payhip (chargé uniquement sur les pages ayant un bouton actif). Préférences d'affichage en stockage local.
- **Cache** : fichiers de `/assets/` fingerprintés (cache 1 an `immutable`), HTML revalidé à chaque visite.
- **Payhip** : `payhip.js` dépose ses propres cookies tiers (Cloudflare). Sur les pages concernées, Lighthouse « Bonnes pratiques » passe de 100 à environ 79 ; ce point dépend de Payhip.
