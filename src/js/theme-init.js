/* Exécuté de façon synchrone dans <head> : applique thème et taille de texte
   enregistrés AVANT l'affichage (évite le « flash » de thème). */
(function () {
  var d = document.documentElement;
  d.className = d.className.replace('no-js', 'js');
  try {
    if (localStorage.getItem('jl-theme') === 'dark') d.setAttribute('data-theme', 'dark');
    var t = localStorage.getItem('jl-texte');
    if (t) d.setAttribute('data-texte', t);
  } catch (e) { /* stockage indisponible : réglages par défaut */ }
})();
