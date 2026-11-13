/**
 * PAGES DU SITE — chaque fonction renvoie un objet page consommé par layout().
 * { chemin, titre, description, contenu, jsonld[], scripts[], image, imageAlt, type, noindex }
 */
'use strict';

const { esc, escKeepComments, stripComments, truncate, priceLabel, priceValue, formatDate, plural } = require('./helpers');
const P = require('./partials');
const { carteSVG } = require('../components/carte');

/* ------------------------------------------------------------------ */
/* Briques communes                                                    */
/* ------------------------------------------------------------------ */

function personneLD(site) {
  const c = site.config;
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${c.url}/#auteur`,
    name: c.author.name,
    jobTitle: c.author.jobTitle,
    url: `${c.url}/auteur/`,
    image: c.url + (site.portrait ? site.portrait.src : site.assets.ogDefaut),
    knowsAbout: ['Géographie', 'Bretagne', 'Îles bretonnes', 'Littoral'],
    ...(c.author.sameAs && c.author.sameAs.length ? { sameAs: c.author.sameAs } : {})
  };
}

/** Bloc carte interactive + liste alternative accessible. */
function blocCarte(site, { id = 'carte', fig = 'Planche I', titreListe = 'Liste des territoires' } = {}) {
  const svg = carteSVG({ territoires: site.territoires, compte: site.compteParTerritoire, mode: 'interactive', id });
  const liste = site.territoires
    .map((t) => `<li><a href="/territoires/${t.slug}/">${esc(t.name)}</a> <span class="legende">${esc(P.compteLivres(site.compteParTerritoire[t.slug] || 0))}</span></li>`)
    .join('');
  return `<figure class="carte" data-carte id="${id}">
  <div class="carte-cadre">
    <div class="carte-outils" role="group" aria-label="Zoom de la carte">
      <button type="button" class="btn-outil" data-zoom="plus" aria-label="Zoomer sur la carte">+</button>
      <button type="button" class="btn-outil" data-zoom="moins" aria-label="Dézoomer la carte">−</button>
      <button type="button" class="btn-outil" data-zoom="reset" aria-label="Recentrer la carte">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="carte-vue">${svg}</div>
    <div class="carte-infobulle" aria-hidden="true" hidden><strong></strong><span></span></div>
  </div>
  <figcaption class="legende carte-legende">${esc(fig)} — Les îles et territoires de Bretagne. Choisissez un lieu pour voir les livres qui lui sont consacrés. <span class="carte-aide">Sur téléphone, utilisez les boutons + et − pour zoomer.</span></figcaption>
</figure>
<nav class="carte-liste" aria-labelledby="${id}-liste-titre">
  <h3 class="legende" id="${id}-liste-titre">${esc(titreListe)}</h3>
  <ul>${liste}</ul>
</nav>`;
}

/** Livres liés à un territoire. */
function livresDu(site, slug) {
  return site.books.filter((b) => b.territoires.includes(slug));
}

/** Livres similaires : territoires et thèmes partagés. */
function similaires(site, livre, n = 3) {
  return site.books
    .filter((b) => b.slug !== livre.slug)
    .map((b) => ({
      b,
      score: b.territoires.filter((t) => livre.territoires.includes(t)).length * 2 + (b.themes || []).filter((t) => (livre.themes || []).includes(t)).length
    }))
    .sort((x, y) => y.score - x.score || y.b.year - x.b.year)
    .slice(0, n)
    .map((x) => x.b);
}

/* ------------------------------------------------------------------ */
/* Accueil                                                             */
/* ------------------------------------------------------------------ */

function accueil(site) {
  const c = site.config;
  const une = site.books.find((b) => b.featured) || site.books[0];
  const recents = [...site.books].sort((a, b) => b.year - a.year).slice(0, 3);
  const auteur = site.auteur;

  const contenu = `
<section class="hero fond-graticule" aria-labelledby="hero-titre">
  <div class="conteneur hero-grille">
    <div class="hero-texte">
      <p class="legende fig">Géographe · Auteur</p>
      <h1 id="hero-titre" class="hero-titre">${esc(c.author.name)}</h1>
      <p class="hero-accroche">${escKeepComments(auteur.accroche)}</p>
      <div class="hero-actions">
        <a class="btn btn-primaire btn-grand" href="/livres/">Découvrir les livres</a>
        <a class="btn btn-secondaire btn-grand" href="#carte">Explorer la carte des îles</a>
      </div>
    </div>
    <figure class="hero-portrait">
      ${P.portrait(site, { eager: true })}
      <figcaption class="legende">Fig. 1 — ${esc(c.author.name)}, géographe</figcaption>
    </figure>
  </div>
</section>

<section class="section" aria-labelledby="carte-titre">
  <div class="conteneur">
    ${P.enteteSection({ fig: 'Planche I', titre: 'La Bretagne et ses îles', id: 'carte-titre', chapo: 'Du Ponant au golfe du Morbihan, chaque île a son caractère. Choisissez un lieu sur la carte pour découvrir les livres qui lui sont consacrés.' })}
    ${blocCarte(site, { id: 'carte' })}
  </div>
</section>

${une ? `<section class="section section--parchemin" aria-labelledby="une-titre">
  <div class="conteneur une-grille">
    <div class="une-couverture reveal">${P.couverture(une, { sizes: '(min-width: 768px) 360px, 70vw' })}</div>
    <div class="une-texte">
      <p class="legende fig">Fig. 2 — Livre à la une</p>
      ${P.badgeExemple(une)}
      <h2 class="titre-section" id="une-titre">${esc(une.title)}</h2>
      ${une.subtitle ? `<p class="sous-titre">${esc(une.subtitle)}</p>` : ''}
      <p class="texte-courant">${escKeepComments(truncate(une.synopsis, 320))}</p>
      <div class="ligne-achat">
        <span class="prix prix--grand">${esc(priceLabel(une.price))}</span>
        ${P.boutonAcheter(une)}
        <a class="lien-fleche" href="/livres/${une.slug}/">Lire la présentation</a>
      </div>
    </div>
  </div>
</section>` : ''}

<section class="section" aria-labelledby="bio-titre">
  <div class="conteneur bio-grille">
    <div class="bio-texte">
      ${P.enteteSection({ fig: 'Fig. 3', titre: "L'auteur", id: 'bio-titre' })}
      ${auteur.provisoire ? '<!-- À RELIRE : biographie provisoire -->' : ''}
      <p class="texte-courant">${escKeepComments(auteur.bioCourte)}</p>
      <a class="lien-fleche" href="/auteur/">Lire la biographie complète</a>
    </div>
    ${une && une.extract ? `<figure class="citation reveal">
      <blockquote><p>${escKeepComments(une.extract)}</p></blockquote>
      <figcaption class="legende">Extrait de <cite>${esc(une.title)}</cite></figcaption>
    </figure>` : ''}
  </div>
</section>

<section class="section section--parchemin" aria-labelledby="catalogue-titre">
  <div class="conteneur">
    ${P.enteteSection({ fig: 'Fig. 4', titre: 'Les livres', id: 'catalogue-titre', chapo: 'Des ouvrages de géographie pour comprendre les îles et le littoral breton, écrits pour tous les curieux.' })}
    ${P.grilleLivres(recents, site.territoiresParSlug)}
    <p class="centre"><a class="btn btn-secondaire" href="/livres/">Voir tout le catalogue</a></p>
  </div>
</section>

<section class="section" aria-labelledby="contact-titre">
  <div class="conteneur"><div class="contact-bandeau cartouche">
    <div>
      <p class="legende fig">Correspondance</p>
      <h2 class="titre-section" id="contact-titre">Une question, une invitation ?</h2>
      <p class="texte-courant">Bibliothèques, associations, établissements scolaires, offices de tourisme : Jacques Lescoat se déplace pour des conférences et des séances de dédicace.</p>
    </div>
    <div class="contact-actions">
      <a class="btn btn-primaire btn-grand" href="/contact/">Écrire à l'auteur</a>
      <a class="lien-fleche" href="/conferences/">Conférences &amp; dédicaces</a>
    </div>
  </div></div>
</section>`;

  return {
    chemin: '/',
    titre: `${c.author.name} — Géographe, livres sur la Bretagne et ses îles`,
    description: truncate(`${c.author.name}, géographe, auteur de livres sur la Bretagne et ses îles : Ouessant, Molène, Sein, Groix, Belle-Île, Houat, Hoëdic, Bréhat, Batz, golfe du Morbihan. Découvrir et acheter ses ouvrages.`),
    contenu,
    scripts: ['carte'],
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: c.siteName, url: c.url + '/', inLanguage: 'fr', publisher: { '@id': `${c.url}/#auteur` } },
      personneLD(site)
    ]
  };
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

function catalogue(site) {
  const terrAvecLivres = site.territoires.filter((t) => site.compteParTerritoire[t.slug]);
  const themes = [...new Set(site.books.flatMap((b) => b.themes || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  const livres = [...site.books].sort((a, b) => b.year - a.year);
  const ariane = P.filAriane(site, [{ nom: 'Accueil', href: '/' }, { nom: 'Livres', href: '/livres/' }]);

  const contenu = `
<div class="conteneur page-entete">
  ${ariane.html}
  ${P.enteteSection({ fig: 'Catalogue', titre: 'Les livres', niveau: 'h1', chapo: `${plural(site.books.length, 'ouvrage')} de géographie sur la Bretagne et ses îles. Chaque livre peut être commandé en ligne ou dédicacé lors d'une rencontre.` })}
</div>
<section class="conteneur section section--serre" aria-label="Catalogue">
  <form class="filtres cartouche" data-filtres>
    <div class="champ">
      <label for="filtre-territoire">Territoire</label>
      <select id="filtre-territoire" name="territoire">
        <option value="">Tous les territoires</option>
        ${terrAvecLivres.map((t) => `<option value="${t.slug}">${esc(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="champ">
      <label for="filtre-theme">Thème</label>
      <select id="filtre-theme" name="theme">
        <option value="">Tous les thèmes</option>
        ${themes.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
      </select>
    </div>
    <div class="champ">
      <label for="filtre-tri">Trier par</label>
      <select id="filtre-tri" name="tri">
        <option value="recent">Du plus récent au plus ancien</option>
        <option value="ancien">Du plus ancien au plus récent</option>
        <option value="titre">Titre (A → Z)</option>
        <option value="prix">Prix croissant</option>
      </select>
    </div>
    <p class="filtres-compte" role="status" aria-live="polite">${plural(livres.length, 'livre affiché', 'livres affichés')}</p>
  </form>
  ${P.grilleLivres(livres, site.territoiresParSlug, { titreNiveau: 'h2' })}
  <p class="aucun-resultat" hidden>Aucun livre ne correspond à ces critères. <button type="button" class="lien-bouton" data-reinitialiser>Afficher tous les livres</button></p>
</section>`;

  return {
    chemin: '/livres/',
    titre: 'Les livres — géographie de la Bretagne et des îles bretonnes',
    description: truncate(`Catalogue des livres de ${site.config.author.name} : géographie de la Bretagne et de ses îles. Filtrez par île ou par thème et commandez en ligne.`),
    contenu,
    scripts: ['catalogue'],
    jsonld: [
      ariane.ld,
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: livres.map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site.config.url}/livres/${b.slug}/`, name: b.title }))
      }
    ]
  };
}

/* ------------------------------------------------------------------ */
/* Page livre                                                          */
/* ------------------------------------------------------------------ */

function livre(site, b) {
  const c = site.config;
  const terr = b.territoires.map((s) => site.territoiresParSlug[s]).filter(Boolean);
  const sim = similaires(site, b);
  const ariane = P.filAriane(site, [{ nom: 'Accueil', href: '/' }, { nom: 'Livres', href: '/livres/' }, { nom: b.title, href: `/livres/${b.slug}/` }]);
  const aRemplacer = (v, vide = '—') => (v ? esc(v) : `${vide}<!-- À REMPLACER -->`);

  const ficheTech = [
    ['Parution', esc(b.year)],
    ['Pages', b.pages ? esc(b.pages) : aRemplacer('')],
    ['Format', aRemplacer(b.format)],
    ['ISBN', aRemplacer(b.isbn)],
    ['Prix', esc(priceLabel(b.price))]
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  const livraison = [
    ['Envoi', c.shipping.envoi],
    ['Retrait', c.shipping.retrait],
    ['Dédicace', c.shipping.dedicace]
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');

  const contenu = `
<div class="conteneur page-entete">${ariane.html}</div>
<article class="conteneur livre-page" aria-labelledby="livre-titre">
  <div class="livre-visuel">
    <figure>
      ${P.couverture(b, { sizes: '(min-width: 1024px) 400px, (min-width: 768px) 40vw, 80vw', eager: true })}
      <figcaption class="legende">Couverture — ${esc(b.format || 'Livre')}</figcaption>
    </figure>
  </div>
  <div class="livre-infos">
    ${P.badgeExemple(b)}
    <h1 class="livre-titre" id="livre-titre">${esc(b.title)}</h1>
    ${b.subtitle ? `<p class="sous-titre">${esc(b.subtitle)}</p>` : ''}
    <p class="legende">${esc(c.author.name)} · ${esc(b.year)}${b.pages ? ` · ${esc(b.pages)} pages` : ''}${b.format ? ` · ${esc(b.format)}` : ''}</p>

    <div class="encart-achat cartouche" id="acheter">
      <p class="prix prix--grand">${esc(priceLabel(b.price))}</p>
      ${P.boutonAcheter(b, { classe: 'btn-grand' })}
      <p class="encart-note">${b.payhipProductId ? 'Paiement sécurisé par carte bancaire ou PayPal via Payhip.' : 'La commande en ligne ouvre bientôt. Laissez votre e-mail pour être prévenu.'}</p>
    </div>

    <section class="livre-bloc" aria-labelledby="synopsis-titre">
      <h2 class="titre-bloc" id="synopsis-titre">Présentation</h2>
      <p class="texte-courant">${escKeepComments(b.synopsis)}</p>
    </section>

    ${b.extract ? `<section class="livre-bloc" aria-labelledby="extrait-titre">
      <h2 class="titre-bloc" id="extrait-titre">Extrait</h2>
      <figure class="citation"><blockquote><p>${escKeepComments(b.extract)}</p></blockquote></figure>
    </section>` : ''}

    ${b.tableOfContents && b.tableOfContents.length ? `<section class="livre-bloc" aria-labelledby="sommaire-titre">
      <h2 class="titre-bloc" id="sommaire-titre">Sommaire</h2>
      <ol class="sommaire">${b.tableOfContents.map((ch) => `<li>${esc(ch)}</li>`).join('')}</ol>
    </section>` : ''}

    <section class="livre-bloc" aria-labelledby="fiche-titre">
      <h2 class="titre-bloc" id="fiche-titre">Fiche technique</h2>
      <dl class="fiche">${ficheTech}</dl>
    </section>

    <section class="livre-bloc" aria-labelledby="livraison-titre">
      <h2 class="titre-bloc" id="livraison-titre">Livraison, retrait et dédicace</h2>
      <dl class="fiche fiche--large">${livraison}</dl>
      <p class="petit">Détails dans les <a href="/cgv/">conditions générales de vente</a>.</p>
    </section>

    ${terr.length ? `<section class="livre-bloc" aria-labelledby="territoires-titre">
      <h2 class="titre-bloc" id="territoires-titre">Territoires abordés</h2>
      <ul class="pastilles">${terr.map((t) => `<li><a class="pastille" href="/territoires/${t.slug}/">${esc(t.name)}</a></li>`).join('')}</ul>
    </section>` : ''}
  </div>
</article>

${sim.length ? `<section class="section section--parchemin" aria-labelledby="similaires-titre">
  <div class="conteneur">
    ${P.enteteSection({ fig: 'Voir aussi', titre: 'Livres similaires', id: 'similaires-titre' })}
    ${P.grilleLivres(sim, site.territoiresParSlug)}
  </div>
</section>` : ''}

<div class="barre-achat" aria-label="Acheter ce livre" role="region">
  <span class="barre-achat-titre">${esc(b.title)}<span class="prix">${esc(priceLabel(b.price))}</span></span>
  ${P.boutonAcheter(b, { classe: 'btn-petit' })}
</div>`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    '@id': `${c.url}/livres/${b.slug}/#livre`,
    name: b.title,
    ...(b.subtitle ? { alternativeHeadline: b.subtitle } : {}),
    author: { '@id': `${c.url}/#auteur`, '@type': 'Person', name: c.author.name },
    url: `${c.url}/livres/${b.slug}/`,
    image: c.url + (b._img ? b._img.src : b._og),
    description: stripComments(b.synopsis),
    inLanguage: 'fr',
    datePublished: String(b.year),
    bookFormat: 'https://schema.org/Paperback',
    ...(b.isbn ? { isbn: b.isbn } : {}),
    ...(b.pages ? { numberOfPages: b.pages } : {}),
    about: terr.map((t) => ({ '@type': 'Place', name: t.name })),
    ...(priceValue(b.price) > 0
      ? {
          offers: {
            '@type': 'Offer',
            price: priceValue(b.price).toFixed(2),
            priceCurrency: 'EUR',
            availability: b.payhipProductId ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: `${c.url}/livres/${b.slug}/`,
            seller: { '@id': `${c.url}/#auteur` }
          }
        }
      : {})
  };

  return {
    chemin: `/livres/${b.slug}/`,
    titre: `${b.title}${b.subtitle ? ` — ${b.subtitle}` : ''}`,
    description: truncate(`${b.title}, livre de ${c.author.name}. ${b.synopsis}`),
    contenu,
    image: b._og,
    imageAlt: `Couverture du livre « ${b.title} » de ${c.author.name}`,
    type: 'book',
    bodyClass: 'avec-barre-achat',
    jsonld: [ariane.ld, ld]
  };
}

/* ------------------------------------------------------------------ */
/* Territoires                                                         */
/* ------------------------------------------------------------------ */

function territoiresIndex(site) {
  const ariane = P.filAriane(site, [{ nom: 'Accueil', href: '/' }, { nom: 'Territoires', href: '/territoires/' }]);
  const groupes = {};
  for (const t of site.territoires) (groupes[t.departement || 'Toute la Bretagne'] ||= []).push(t);

  const contenu = `
<div class="conteneur page-entete">
  ${ariane.html}
  ${P.enteteSection({ fig: 'Atlas', titre: 'Les territoires', niveau: 'h1', chapo: 'Îles, archipels et espaces maritimes de Bretagne : choisissez un lieu pour lire sa présentation et découvrir les livres qui lui sont consacrés.' })}
</div>
<section class="conteneur section section--serre" aria-label="Carte des territoires">
  ${blocCarte(site, { id: 'carte', titreListe: 'Tous les territoires' })}
</section>
<section class="section section--parchemin" aria-labelledby="index-titre">
  <div class="conteneur">
    ${P.enteteSection({ fig: 'Index', titre: 'Par département', id: 'index-titre' })}
    <div class="index-territoires">
      ${Object.entries(groupes).map(([dep, liste]) => `<section class="index-groupe">
        <h3 class="titre-bloc">${esc(dep)}</h3>
        <ul>${liste.map((t) => `<li><a href="/territoires/${t.slug}/"><span class="index-nom">${esc(t.name)}</span><span class="legende">${esc(t.type)} · ${esc(P.compteLivres(site.compteParTerritoire[t.slug] || 0))}</span></a><p>${escKeepComments(t.intro)}</p></li>`).join('')}</ul>
      </section>`).join('')}
    </div>
  </div>
</section>`;

  return {
    chemin: '/territoires/',
    titre: 'Les îles et territoires de Bretagne — carte et livres',
    description: truncate('Carte interactive des îles de Bretagne : Ouessant, Molène, Sein, Glénan, Groix, Belle-Île, Houat, Hoëdic, golfe du Morbihan, Bréhat, Batz. Présentation et livres de géographie pour chaque territoire.'),
    contenu,
    scripts: ['carte'],
    jsonld: [ariane.ld]
  };
}

function territoire(site, t) {
  const c = site.config;
  const livres = livresDu(site, t.slug);
  const voisins = site.territoires.filter((x) => x.slug !== t.slug && x.departement && x.departement === t.departement).slice(0, 6);
  const ariane = P.filAriane(site, [{ nom: 'Accueil', href: '/' }, { nom: 'Territoires', href: '/territoires/' }, { nom: t.name, href: `/territoires/${t.slug}/` }]);
  const aCarte = typeof t.lon === 'number';
  const nomComplet = /^(Île|Les|Mer|Golfe|Belle)/.test(t.name) ? t.name : `${t.type === 'archipel' ? "l'archipel de" : "l'île de"} ${t.name}`;

  const contenu = `
<div class="conteneur page-entete">${ariane.html}</div>
<article class="conteneur territoire-page" aria-labelledby="territoire-titre">
  <div class="territoire-texte">
    <p class="legende fig">${esc(t.type)}${t.departement ? ` · ${esc(t.departement)}` : ''}</p>
    <h1 class="titre-section titre-page" id="territoire-titre">${esc(t.name)}</h1>
    ${t.breton ? `<p class="nom-breton">En breton : <span lang="br">${esc(t.breton)}</span></p>` : ''}
    <p class="chapo">${escKeepComments(t.intro)}</p>
    ${t.presentation.map((p) => `<p class="texte-courant">${escKeepComments(p)}</p>`).join('\n    ')}
  </div>
  ${aCarte ? `<figure class="territoire-carte cartouche">
    ${carteSVG({ territoires: site.territoires, mode: 'locator', highlight: t.slug, id: 'situation' })}
    <figcaption class="legende">Carte de situation — ${esc(t.name)}${t.departement ? `, ${esc(t.departement)}` : ''}</figcaption>
  </figure>` : ''}
</article>

<section class="section section--parchemin" aria-labelledby="livres-titre">
  <div class="conteneur">
    ${P.enteteSection({ fig: 'Bibliographie', titre: `Livres sur ${t.type === 'région' ? 'la Bretagne' : t.name}`, id: 'livres-titre' })}
    ${livres.length
      ? P.grilleLivres(livres, site.territoiresParSlug)
      : `<p class="texte-courant">Aucun livre n'est encore consacré spécifiquement à ce territoire. <a href="/livres/">Parcourir tout le catalogue</a>.</p>`}
  </div>
</section>

${voisins.length ? `<section class="section" aria-labelledby="voisins-titre">
  <div class="conteneur">
    <h2 class="titre-bloc" id="voisins-titre">Autres territoires du ${esc(t.departement)}</h2>
    <ul class="pastilles">${voisins.map((v) => `<li><a class="pastille" href="/territoires/${v.slug}/">${esc(v.name)}</a></li>`).join('')}</ul>
    <p><a class="lien-fleche" href="/territoires/">Voir la carte de tous les territoires</a></p>
  </div>
</section>` : ''}`;

  const motCle = t.type === 'région' ? 'la Bretagne' : nomComplet;
  return {
    chemin: `/territoires/${t.slug}/`,
    titre: `${t.name} — livres de géographie sur ${t.type === 'région' ? 'la Bretagne' : t.name}`,
    description: truncate(`${t.intro} Livres de géographie de ${c.author.name} consacrés à ${motCle}.`),
    contenu,
    jsonld: [
      ariane.ld,
      {
        '@context': 'https://schema.org',
        '@type': t.type === 'zone' ? 'Place' : t.type === 'région' ? 'AdministrativeArea' : 'Place',
        name: t.name,
        description: stripComments(t.intro),
        ...(aCarte ? { geo: { '@type': 'GeoCoordinates', latitude: t.lat, longitude: t.lon } } : {}),
        containedInPlace: { '@type': 'AdministrativeArea', name: t.departement || 'Bretagne' }
      }
    ]
  };
}

/* ------------------------------------------------------------------ */
/* L'auteur                                                            */
/* ------------------------------------------------------------------ */

function auteurPage(site) {
  const a = site.auteur;
  const ariane = P.filAriane(site, [{ nom: 'Accueil', href: '/' }, { nom: "L'auteur", href: '/auteur/' }]);
  const contenu = `
<div class="conteneur page-entete">${ariane.html}</div>
<article class="conteneur auteur-page" aria-labelledby="auteur-titre">
  <figure class="auteur-portrait">
    ${P.portrait(site, { eager: true })}
    <figcaption class="legende">Fig. 1 — ${esc(site.config.author.name)}</figcaption>
  </figure>
  <div class="auteur-texte">
    <p class="legende fig">Biographie</p>
    <h1 class="titre-section titre-page" id="auteur-titre">${esc(site.config.author.name)}, géographe</h1>
    ${a.provisoire ? '<p class="note-provisoire" role="note">Texte provisoire, en cours de relecture par l\'auteur.</p><!-- À RELIRE -->' : ''}
    <p class="chapo">${escKeepComments(a.accroche)}</p>
    ${a.bio.map((p) => `<p class="texte-courant">${escKeepComments(p)}</p>`).join('\n    ')}

    <h2 class="titre-bloc">Parcours</h2>
    <ol class="parcours">${a.parcours.map((p) => `<li><span class="parcours-date">${esc(p.periode)}</span><span>${escKeepComments(p.texte)}</span></li>`).join('')}</ol>

    <h2 class="titre-bloc">Travaux et thèmes de recherche</h2>
    <ul class="liste-puces">${a.travaux.map((t) => `<li>${escKeepComments(t)}</li>`).join('')}</ul>

    <h2 class="titre-bloc">Ses livres</h2>
    <ul class="liste-puces">${site.books.map((b) => `<li><a href="/livres/${b.slug}/"><cite>${esc(b.title)}</cite></a> (${esc(b.year)})</li>`).join('')}</ul>

    <p class="actions-ligne"><a class="btn btn-primaire" href="/livres/">Découvrir les livres</a> <a class="btn btn-secondaire" href="/conferences/#inviter">Inviter l'auteur</a></p>
  </div>
</article>`;

  return {
    chemin: '/auteur/',
    titre: `${site.config.author.name}, géographe — biographie`,
    description: truncate(`${a.bioCourte}`),
    contenu,
    type: 'profile',
    jsonld: [ariane.ld, personneLD(site)]
  };
}

/* ------------------------------------------------------------------ */
/* Conférences & dédicaces                                             */
/* ------------------------------------------------------------------ */

function conferences(site) {
  const c = site.config;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const evts = [...site.events].sort((a, b) => a.date.localeCompare(b.date));
  const aVenir = evts.filter((e) => (e.dateFin || e.date) >= aujourdhui);
  const passes = evts.filter((e) => (e.dateFin || e.date) < aujourdhui).reverse().slice(0, 10);
  const ariane = P.filAriane(site, [{ nom: 'Accueil', href: '/' }, { nom: 'Conférences & dédicaces', href: '/conferences/' }]);

  const carteEvt = (e) => `<li class="evenement" data-fin="${esc(e.dateFin || e.date)}">
    <p class="evenement-date"><time datetime="${esc(e.date)}${e.heure ? 'T' + esc(e.heure) : ''}">${esc(formatDate(e.date))}${e.heure ? ` · ${esc(e.heure.replace(':', ' h '))}` : ''}</time></p>
    <div>
      <p class="legende">${esc(e.type || 'Rencontre')}</p>
      <h3 class="evenement-titre">${esc(e.titre)}</h3>
      <p>${esc(e.lieu || '')}${e.ville ? `, ${esc(e.ville)}` : ''}</p>
      ${e.description ? `<p class="petit">${esc(e.description)}</p>` : ''}
      ${e.url ? `<p><a href="${esc(e.url)}" rel="noopener">Informations pratiques<span class="sr-only"> sur « ${esc(e.titre)} »</span></a></p>` : ''}
    </div>
  </li>`;

  const contenu = `
<div class="conteneur page-entete">
  ${ariane.html}
  ${P.enteteSection({ fig: 'Agenda', titre: 'Conférences & dédicaces', niveau: 'h1', chapo: 'Retrouvez Jacques Lescoat lors de conférences, de rencontres en librairie et de séances de dédicace en Bretagne.' })}
</div>
<section class="conteneur section section--serre" aria-labelledby="avenir-titre">
  <h2 class="titre-bloc" id="avenir-titre">Prochains rendez-vous</h2>
  ${aVenir.length
    ? `<ul class="evenements">${aVenir.map(carteEvt).join('')}</ul>`
    : `<p class="vide cartouche">Aucune date n'est programmée pour le moment. Les prochaines rencontres seront annoncées ici.<!-- À REMPLACER : événements (data/events.json) --></p>`}
  ${passes.length ? `<h2 class="titre-bloc">Rendez-vous passés</h2><ul class="evenements evenements--passes">${passes.map(carteEvt).join('')}</ul>` : ''}
</section>
<section class="section section--parchemin" aria-labelledby="inviter">
  <div class="conteneur deux-colonnes">
    <div>
      ${P.enteteSection({ fig: 'Invitation', titre: "Inviter l'auteur", id: 'inviter' })}
      <p class="texte-courant">Bibliothèques et médiathèques, associations, établissements scolaires, offices de tourisme, librairies : Jacques Lescoat propose des interventions adaptées à chaque public.</p>
      <ul class="liste-puces">
        <li><strong>Conférences illustrées</strong> sur une île, un archipel ou le littoral breton, avec cartes et images projetées.</li>
        <li><strong>Rencontres et lectures</strong> autour d'un livre, suivies d'un temps d'échange.</li>
        <li><strong>Séances de dédicace</strong> en librairie, en salon du livre ou lors d'une manifestation.</li>
        <li><strong>Interventions scolaires</strong> pour faire découvrir la géographie des îles aux élèves.</li>
      </ul>
    </div>
    <div class="cartouche encart-contact">
      <p class="legende">Pour organiser une rencontre</p>
      <p>Précisez le lieu, la date envisagée, le public attendu et le format souhaité.</p>
      <p><a class="btn btn-primaire" href="/contact/?objet=invitation#formulaire">Envoyer une invitation</a></p>
      <p class="petit">Ou par e-mail : <a href="mailto:${esc(c.author.email)}">${esc(c.author.email)}</a></p>
    </div>
  </div>
</section>`;

  return {
    chemin: '/conferences/',
    titre: 'Conférences, rencontres et dédicaces',
    description: truncate(`Agenda des conférences, rencontres et séances de dédicace de ${c.author.name}, géographe, en Bretagne. Inviter l'auteur dans votre bibliothèque, association ou école.`),
    contenu,
    jsonld: [
      ariane.ld,
      ...aVenir.map((e) => ({
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: e.titre,
        startDate: e.heure ? `${e.date}T${e.heure}` : e.date,
        ...(e.dateFin ? { endDate: e.dateFin } : {}),
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        eventStatus: 'https://schema.org/EventScheduled',
        location: { '@type': 'Place', name: e.lieu || e.ville, address: { '@type': 'PostalAddress', addressLocality: e.ville || '', addressCountry: 'FR' } },
        performer: { '@id': `${c.url}/#auteur`, '@type': 'Person', name: c.author.name },
        organizer: { '@type': 'Organization', name: e.organisateur || e.lieu || c.author.name },
        ...(e.description ? { description: e.description } : {})
      }))
    ]
  };
}

/* ------------------------------------------------------------------ */
/* Contact                                                             */
/* ------------------------------------------------------------------ */

function contact(site) {
  const c = site.config;
  const f = P.actionFormulaire(site, 'contactAction', 'Message depuis le site jlescoat.glsc.fr');
  const ariane = P.filAriane(site, [{ nom: 'Accueil', href: '/' }, { nom: 'Contact', href: '/contact/' }]);
  const contenu = `
<div class="conteneur page-entete">
  ${ariane.html}
  ${P.enteteSection({ fig: 'Correspondance', titre: "Écrire à l'auteur", niveau: 'h1', chapo: 'Une question sur un livre, une commande dédicacée, une invitation à une conférence ? Écrivez directement à Jacques Lescoat.' })}
</div>
<section class="conteneur section section--serre deux-colonnes contact-page">
  <div>
    <form class="formulaire cartouche" id="formulaire" method="post" action="${esc(f.action)}" ${f.extra} data-formulaire="contact" data-mailto="${f.mailto}">
      <div class="champ">
        <label for="contact-nom">Votre nom <span class="requis">(obligatoire)</span></label>
        <input id="contact-nom" name="nom" type="text" autocomplete="name" required>
      </div>
      <div class="champ">
        <label for="contact-email">Votre adresse e-mail <span class="requis">(obligatoire)</span></label>
        <input id="contact-email" name="email" type="email" autocomplete="email" required>
      </div>
      <div class="champ">
        <label for="contact-objet">Objet</label>
        <select id="contact-objet" name="objet">
          <option value="question">Une question sur un livre</option>
          <option value="prevenir">Être prévenu de la disponibilité d'un livre</option>
          <option value="commande">Commande, retrait ou dédicace</option>
          <option value="invitation">Invitation : conférence, rencontre, dédicace</option>
          <option value="autre">Autre</option>
        </select>
      </div>
      <div class="champ">
        <label for="contact-message">Votre message <span class="requis">(obligatoire)</span></label>
        <textarea id="contact-message" name="message" rows="7" required></textarea>
      </div>
      ${P.POT_DE_MIEL.replace(/\{id\}/g, 'contact')}
      <div class="champ champ-case">
        <input id="contact-accord" name="accord" type="checkbox" required>
        <label for="contact-accord">J'accepte que mes données soient utilisées pour répondre à ma demande.</label>
      </div>
      ${P.mentionRGPD()}
      <p class="formulaire-statut" role="status" aria-live="polite"></p>
      <button type="submit" class="btn btn-primaire btn-grand">Envoyer le message</button>
      ${f.mailto ? '<p class="petit">L\'envoi ouvre votre logiciel de messagerie avec le message prérempli.</p>' : ''}
    </form>
  </div>
  <aside class="contact-aside">
    <div class="cartouche">
      <p class="legende">Par e-mail</p>
      <p><a class="lien-fort" href="mailto:${esc(c.author.email)}">${esc(c.author.email)}</a></p>
    </div>
    <div class="cartouche" id="etre-prevenu">
      <p class="legende">Être prévenu</p>
      <p>La vente en ligne de certains livres n'est pas encore ouverte. Choisissez l'objet « Être prévenu de la disponibilité d'un livre » et indiquez le titre : vous recevrez un message dès qu'il sera disponible.</p>
    </div>
    <div class="cartouche">
      <p class="legende">Conférences</p>
      <p>Pour une invitation, précisez le lieu, la date envisagée et le public. <a href="/conferences/">Voir l'agenda</a>.</p>
    </div>
  </aside>
</section>`;

  return {
    chemin: '/contact/',
    titre: 'Contact — écrire à Jacques Lescoat',
    description: truncate(`Contacter ${c.author.name}, géographe : questions sur ses livres, commandes dédicacées, invitations à des conférences et rencontres.`),
    contenu,
    jsonld: [ariane.ld]
  };
}

/* ------------------------------------------------------------------ */
/* Pages légales                                                       */
/* ------------------------------------------------------------------ */

function pageTexte(site, { chemin, titre, fig, description, corps }) {
  const ariane = P.filAriane(site, [{ nom: 'Accueil', href: '/' }, { nom: titre, href: chemin }]);
  return {
    chemin,
    titre,
    description,
    contenu: `
<div class="conteneur page-entete">
  ${ariane.html}
  ${P.enteteSection({ fig, titre, niveau: 'h1' })}
</div>
<div class="conteneur section section--serre"><div class="prose-atlas">${corps}</div></div>`,
    jsonld: [ariane.ld]
  };
}

/** Identification de l'éditeur selon le statut (particulier / micro-entreprise / association). */
function identification(site) {
  const l = site.config.legal;
  const lignes = [`<strong>${esc(l.raisonSociale)}</strong>`];
  if (l.statut === 'micro-entreprise') lignes.push('Entrepreneur individuel (micro-entreprise)', `SIRET : ${esc(l.siret)}<!-- À REMPLACER -->`);
  else if (l.statut === 'association') lignes.push('Association loi 1901', `RNA : ${esc(l.rna || 'à renseigner')}<!-- À REMPLACER -->`);
  else lignes.push('Particulier — auteur');
  lignes.push(`Adresse : ${esc(l.adresse)}<!-- À REMPLACER -->`, `E-mail : <a href="mailto:${esc(site.config.author.email)}">${esc(site.config.author.email)}</a>`);
  if (l.statut === 'micro-entreprise' && l.tva) lignes.push(esc(l.tva));
  return `<p>${lignes.join('<br>')}</p>`;
}

function mentionsLegales(site) {
  const l = site.config.legal;
  const h = l.hebergeur;
  return pageTexte(site, {
    chemin: '/mentions-legales/',
    titre: 'Mentions légales',
    fig: 'Informations légales',
    description: 'Mentions légales du site jlescoat.glsc.fr : éditeur, directeur de la publication, hébergeur, propriété intellectuelle.',
    corps: `
<p class="petit">Conformément à l'article 6 de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN).</p>
<h2>Éditeur du site</h2>
${identification(site)}
<h2>Directeur de la publication</h2>
<p>${esc(l.directeurPublication)}</p>
<h2>Hébergement</h2>
<p><strong>${esc(h.nom)}</strong><br>${esc(h.adresse)}<br>Téléphone : ${esc(h.telephone)}<!-- À REMPLACER : hébergeur du VPS --></p>
<h2>Paiement en ligne</h2>
<p>Les paiements sont traités par la plateforme Payhip (Payhip Ltd, Royaume-Uni), qui assure la gestion sécurisée des transactions. Aucune donnée bancaire ne transite par ce site ni n'y est conservée.</p>
<h2>Propriété intellectuelle</h2>
<p>L'ensemble des contenus de ce site (textes, extraits, couvertures, photographies, cartes) est protégé par le droit d'auteur. Toute reproduction, même partielle, est soumise à l'autorisation préalable de l'auteur, sauf courte citation mentionnant la source.</p>
<h2>Fond de carte</h2>
<p>La carte de la Bretagne est un tracé simplifié réalisé pour ce site, à des fins d'illustration uniquement. Elle ne doit pas être utilisée pour la navigation.<!-- À AFFINER : si un fond OpenStreetMap / IGN / Natural Earth est utilisé, ajouter ici l'attribution requise. --></p>
<h2>Polices de caractères</h2>
<p>Fraunces (Undercase Type) et Atkinson Hyperlegible (Braille Institute), sous licence SIL Open Font License, hébergées sur ce serveur.</p>
<h2>Données personnelles</h2>
<p>Voir la <a href="/confidentialite/">politique de confidentialité</a>.</p>`
  });
}

function confidentialite(site) {
  const c = site.config;
  return pageTexte(site, {
    chemin: '/confidentialite/',
    titre: 'Politique de confidentialité',
    fig: 'Vos données',
    description: 'Politique de confidentialité du site jlescoat.glsc.fr : aucun cookie de suivi, données des formulaires utilisées uniquement pour répondre, vos droits RGPD.',
    corps: `
<p>Ce site est conçu pour collecter le moins de données possible. <strong>Il n'utilise aucun cookie de suivi, aucun outil publicitaire et aucune mesure d'audience tierce.</strong> C'est pourquoi aucun bandeau de consentement ne s'affiche.</p>
<h2>Responsable du traitement</h2>
${identification(site)}
<h2>Données collectées et finalités</h2>
<ul>
  <li><strong>Formulaire de contact</strong> : nom, adresse e-mail et message, utilisés uniquement pour vous répondre. Base légale : votre consentement (case à cocher).</li>
  <li><strong>« Être prévenu »</strong> : adresse e-mail et titre du livre, utilisés uniquement pour vous informer de la disponibilité de ce livre. Base légale : votre consentement.</li>
  <li><strong>Commandes</strong> : lors d'un achat, vos coordonnées et données de paiement sont collectées par Payhip, qui agit pour le compte du vendeur et selon sa propre <a href="https://payhip.com/privacy" rel="noopener">politique de confidentialité</a>. Les données de livraison sont utilisées pour expédier votre commande et conservées le temps imposé par les obligations comptables.</li>
</ul>
${c.forms.contactAction.startsWith('mailto:') ? '<p>Les formulaires ouvrent votre propre logiciel de messagerie : le message est envoyé depuis votre boîte e-mail, rien n\'est stocké sur ce site.</p>' : '<p>Les messages des formulaires sont transmis par un service d\'envoi de formulaires, sous-traitant chargé uniquement de les acheminer jusqu\'à l\'auteur.<!-- À VÉRIFIER : nommer le service utilisé --></p>'}
<h2>Durée de conservation</h2>
<p>Les échanges par e-mail sont conservés au maximum trois ans après le dernier contact. Les demandes « être prévenu » sont supprimées une fois l'information envoyée.</p>
<h2>Préférences d'affichage</h2>
<p>Si vous changez la taille du texte ou activez le mode « carte de nuit », ce choix est enregistré <em>uniquement dans votre navigateur</em> (stockage local) pour être retrouvé à votre prochaine visite. Il n'est jamais transmis. Vous pouvez l'effacer en vidant les données de navigation.</p>
<h2>Mesure d'audience</h2>
<p>${c.analytics && c.analytics.enabled ? `Une mesure d'audience respectueuse de la vie privée (${esc(c.analytics.provider)}), sans cookie et sans donnée personnelle, est utilisée pour connaître la fréquentation globale du site.` : 'Aucune mesure d\'audience n\'est active sur ce site.'}</p>
<h2>Hébergement et journaux techniques</h2>
<p>Le serveur conserve des journaux techniques (adresse IP, page demandée, date) pour assurer la sécurité du site. Ils sont conservés au maximum 12 mois et ne sont utilisés à aucune autre fin.<!-- À VÉRIFIER : durée de rotation des logs Nginx --></p>
<h2>Vos droits</h2>
<p>Conformément au Règlement général sur la protection des données (RGPD) et à la loi Informatique et Libertés, vous disposez d'un droit d'accès, de rectification, d'effacement, d'opposition et de limitation du traitement de vos données. Pour l'exercer, écrivez à <a href="mailto:${esc(c.author.email)}">${esc(c.author.email)}</a>.</p>
<p>Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (<a href="https://www.cnil.fr" rel="noopener">cnil.fr</a>).</p>`
  });
}

function cgv(site) {
  const c = site.config;
  const l = c.legal;
  const pro = l.statut !== 'particulier';
  return pageTexte(site, {
    chemin: '/cgv/',
    titre: 'Conditions générales de vente',
    fig: 'Conditions de vente',
    description: 'Conditions générales de vente des livres de Jacques Lescoat : commande via Payhip, prix, livraison, retrait, dédicace, droit de rétractation, garanties.',
    corps: `
<p class="petit">Version en vigueur au ${esc(formatDate(new Date().toISOString().slice(0, 10)))}.<!-- À VÉRIFIER : faire relire ces CGV par un professionnel du droit --></p>
<h2>1. Vendeur</h2>
${identification(site)}
<h2>2. Objet</h2>
<p>Les présentes conditions régissent la vente à distance des livres de ${esc(c.author.name)} présentés sur ce site, à destination des particuliers. Toute commande implique leur acceptation.</p>
<h2>3. Produits</h2>
<p>Les livres proposés sont des ouvrages imprimés. Leurs caractéristiques essentielles (titre, format, nombre de pages, ISBN) figurent sur chaque fiche. Les photographies et visuels n'ont pas de valeur contractuelle.</p>
<h2>4. Prix</h2>
<p>Les prix sont indiqués en euros, toutes taxes comprises${l.statut === 'micro-entreprise' && l.tva ? ` (${esc(l.tva)})` : ''}. Conformément à la loi n° 81-766 du 10 août 1981 relative au prix du livre, le prix de vente au public est fixé par l'éditeur. Les frais de livraison, facturés en sus, sont indiqués avant la validation de la commande ; la réglementation impose un montant minimal de frais d'envoi pour les livres neufs vendus à distance.<!-- À VÉRIFIER : montant minimal en vigueur (loi n° 2021-1901 dite « Darcos » et son arrêté d'application) --></p>
<h2>5. Commande et paiement</h2>
<p>La commande s'effectue en cliquant sur le bouton « Acheter » de la fiche du livre. Le paiement est réalisé de manière sécurisée sur la plateforme Payhip, par carte bancaire ou PayPal. La commande est ferme après confirmation du paiement ; un e-mail récapitulatif est envoyé à l'acheteur.</p>
<h2>6. Livraison, retrait et dédicace</h2>
<ul>
  <li><strong>Envoi</strong> : ${esc(c.shipping.envoi)} Les livres sont expédiés dans un délai indicatif de 5 jours ouvrés après le paiement.<!-- À VÉRIFIER : délai et zones de livraison --></li>
  <li><strong>Retrait</strong> : ${esc(c.shipping.retrait)}</li>
  <li><strong>Dédicace</strong> : ${esc(c.shipping.dedicace)}</li>
</ul>
<p>En cas de retard ou de colis endommagé, contactez le vendeur à <a href="mailto:${esc(c.author.email)}">${esc(c.author.email)}</a>.</p>
<h2>7. Droit de rétractation</h2>
<p>Conformément à l'article L221-18 du Code de la consommation, l'acheteur dispose d'un délai de quatorze jours à compter de la réception du livre pour se rétracter, sans avoir à se justifier. Il en informe le vendeur par e-mail, puis retourne le livre en bon état, à ses frais, dans les quatorze jours. Le remboursement, incluant les frais de livraison initiaux au tarif standard, intervient dans les quatorze jours suivant la réception du retour. Un livre dédicacé à la demande de l'acheteur est un bien personnalisé : le droit de rétractation ne s'applique pas (article L221-28, 3° du Code de la consommation).</p>
<h2>8. Garanties</h2>
<p>${pro ? 'Les livres bénéficient de la garantie légale de conformité (articles L217-3 et suivants du Code de la consommation) et de la garantie des vices cachés (articles 1641 et suivants du Code civil). Un livre défectueux (pages manquantes, défaut d\'impression) est remplacé ou remboursé.' : 'Un livre défectueux (pages manquantes, défaut d\'impression) est remplacé ou remboursé, conformément à la garantie des vices cachés (articles 1641 et suivants du Code civil).'}</p>
<h2>9. Données personnelles</h2>
<p>Voir la <a href="/confidentialite/">politique de confidentialité</a>.</p>
<h2>10. Médiation et litiges</h2>
<p>En cas de difficulté, l'acheteur est invité à contacter d'abord le vendeur pour trouver une solution amiable.${pro ? ` Conformément à l'article L612-1 du Code de la consommation, il peut ensuite recourir gratuitement au médiateur de la consommation : ${esc(l.mediateur.nom)}${l.mediateur.url ? ` (<a href="${esc(l.mediateur.url)}" rel="noopener">${esc(l.mediateur.url)}</a>)` : ''}.<!-- À REMPLACER : médiateur de la consommation -->` : ''} Les présentes conditions sont soumises au droit français.</p>`
  });
}

function planDuSite(site) {
  const sections = [
    ['Pages principales', [['Accueil', '/'], ...site.config.nav.map((n) => [n.label, n.href])]],
    ['Livres', site.books.map((b) => [b.title, `/livres/${b.slug}/`])],
    ['Territoires', site.territoires.map((t) => [t.name, `/territoires/${t.slug}/`])],
    ['Informations', [['Mentions légales', '/mentions-legales/'], ['Confidentialité', '/confidentialite/'], ['Conditions de vente', '/cgv/']]]
  ];
  return pageTexte(site, {
    chemin: '/plan-du-site/',
    titre: 'Plan du site',
    fig: 'Index général',
    description: 'Plan du site de Jacques Lescoat, géographe : toutes les pages, livres et territoires.',
    corps: sections.map(([t, liens]) => `<h2>${esc(t)}</h2><ul>${liens.map(([n, h]) => `<li><a href="${h}">${esc(n)}</a></li>`).join('')}</ul>`).join('')
  });
}

/* ------------------------------------------------------------------ */
/* 404 « Hors carte »                                                  */
/* ------------------------------------------------------------------ */

function page404(site) {
  return {
    chemin: '/404.html',
    titre: 'Page introuvable — vous êtes hors carte',
    description: "Cette page n'existe pas ou a été déplacée.",
    noindex: true,
    contenu: `
<section class="conteneur section hors-carte" aria-labelledby="hc-titre">
  <svg class="hors-carte-dessin" viewBox="0 0 400 260" width="400" height="260" aria-hidden="true" focusable="false">
    <path class="hc-trait" d="M10 200 C 60 170, 90 210, 140 180 S 210 120, 250 150 S 330 210, 390 170" />
    <path class="hc-trait hc-trait--pointille" d="M10 222 C 60 192, 90 232, 140 202 S 210 142, 250 172 S 330 232, 390 192" />
    <g transform="translate(300 70)"><circle r="34" class="hc-cercle"/><path d="M0 -42 6 0 0 42 -6 0Z" class="hc-rose"/><path d="M-42 0 0 -6 42 0 0 6Z" class="hc-rose hc-rose--b"/></g>
    <text x="40" y="70" class="hc-texte">Terra incognita</text>
    <text x="40" y="100" class="hc-texte hc-texte--petit">ici s'arrêtent les relevés</text>
  </svg>
  <p class="legende fig">Erreur 404</p>
  <h1 class="titre-section titre-page" id="hc-titre">Vous êtes hors de la carte</h1>
  <p class="chapo">La page demandée n'existe pas ou a été déplacée. Pas d'inquiétude : voici de quoi retrouver votre cap.</p>
  <ul class="actions-ligne">
    <li><a class="btn btn-primaire" href="/">Revenir à l'accueil</a></li>
    <li><a class="btn btn-secondaire" href="/livres/">Voir les livres</a></li>
    <li><a class="btn btn-secondaire" href="/territoires/">Carte des îles</a></li>
  </ul>
</section>`
  };
}

module.exports = {
  accueil, catalogue, livre, territoiresIndex, territoire, auteurPage, conferences, contact,
  mentionsLegales, confidentialite, cgv, planDuSite, page404
};
