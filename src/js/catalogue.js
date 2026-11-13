/**
 * Catalogue : filtre par territoire et par thème, tri simple.
 * Les choix sont reflétés dans l'URL (?territoire=groix) pour pouvoir être partagés.
 */
(function () {
  'use strict';
  var form = document.querySelector('[data-filtres]');
  var grille = document.querySelector('.grille-livres');
  if (!form || !grille) return;

  var cartes = Array.prototype.slice.call(grille.querySelectorAll('.livre-carte'));
  var compte = form.querySelector('.filtres-compte');
  var aucun = document.querySelector('.aucun-resultat');
  var champs = { territoire: form.territoire, theme: form.theme, tri: form.tri };

  var TRIS = {
    recent: function (a, b) { return b.dataset.annee - a.dataset.annee; },
    ancien: function (a, b) { return a.dataset.annee - b.dataset.annee; },
    titre: function (a, b) { return a.dataset.titre.localeCompare(b.dataset.titre, 'fr'); },
    prix: function (a, b) { return (parseFloat(a.dataset.prix) || 9999) - (parseFloat(b.dataset.prix) || 9999); }
  };

  function appliquer(majUrl) {
    var t = champs.territoire.value, th = champs.theme.value, tri = champs.tri.value;
    var visibles = 0;
    cartes.forEach(function (c) {
      var ok = (!t || (' ' + c.dataset.territoires + ' ').indexOf(' ' + t + ' ') > -1)
        && (!th || c.dataset.themes.split('|').indexOf(th) > -1);
      c.hidden = !ok;
      if (ok) { visibles++; c.classList.add('est-visible'); }
    });
    cartes.slice().sort(TRIS[tri] || TRIS.recent).forEach(function (c) { grille.appendChild(c); });
    compte.textContent = visibles + (visibles > 1 ? ' livres affichés' : ' livre affiché');
    aucun.hidden = visibles > 0;
    if (majUrl && window.history.replaceState) {
      var p = new URLSearchParams();
      if (t) p.set('territoire', t);
      if (th) p.set('theme', th);
      if (tri !== 'recent') p.set('tri', tri);
      var q = p.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : ''));
    }
  }

  // État initial depuis l'URL
  var params = new URLSearchParams(window.location.search);
  Object.keys(champs).forEach(function (k) {
    var v = params.get(k);
    if (v && Array.prototype.some.call(champs[k].options, function (o) { return o.value === v; })) champs[k].value = v;
  });

  form.addEventListener('change', function () { appliquer(true); });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  document.querySelector('[data-reinitialiser]').addEventListener('click', function () {
    form.reset();
    appliquer(true);
    champs.territoire.focus();
  });
  appliquer(false);
})();
