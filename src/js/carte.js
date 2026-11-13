/**
 * Carte interactive : infobulles (survol + clavier), zoom par boutons,
 * déplacement au doigt / à la souris une fois zoomé, recentrage automatique
 * sur le lieu qui reçoit le focus clavier.
 */
(function () {
  'use strict';

  Array.prototype.forEach.call(document.querySelectorAll('[data-carte]'), function (fig) {
    var svg = fig.querySelector('svg.carte-svg');
    var vue = fig.querySelector('.carte-vue');
    var bulle = fig.querySelector('.carte-infobulle');
    var outils = fig.querySelector('.carte-outils');
    if (!svg || !vue) return;

    var base = svg.viewBox.baseVal;
    var W = base.width, H = base.height;
    var vb = { x: 0, y: 0, w: W, h: H };
    var ZOOM_MAX = 4;

    function appliquer() {
      vb.w = Math.min(W, Math.max(W / ZOOM_MAX, vb.w));
      vb.h = vb.w * H / W;
      vb.x = Math.min(W - vb.w, Math.max(0, vb.x));
      vb.y = Math.min(H - vb.h, Math.max(0, vb.y));
      svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map(function (n) { return n.toFixed(1); }).join(' '));
      vue.classList.toggle('est-zoomee', vb.w < W - 1);
      cacherBulle();
    }

    function zoomer(facteur, cx, cy) {
      cx = cx === undefined ? vb.x + vb.w / 2 : cx;
      cy = cy === undefined ? vb.y + vb.h / 2 : cy;
      vb.w = vb.w / facteur;
      vb.h = vb.w * H / W;
      vb.x = cx - vb.w / 2;
      vb.y = cy - vb.h / 2;
      appliquer();
    }

    /* Boutons + / − / recentrer */
    if (outils) {
      outils.addEventListener('click', function (e) {
        var b = e.target.closest('[data-zoom]');
        if (!b) return;
        var action = b.getAttribute('data-zoom');
        if (action === 'plus') zoomer(1.6);
        else if (action === 'moins') zoomer(1 / 1.6);
        else { vb = { x: 0, y: 0, w: W, h: H }; appliquer(); }
      });
    }

    /* Infobulle */
    function montrerBulle(lieu) {
      if (!bulle) return;
      var x = parseFloat(lieu.getAttribute('data-x'));
      var y = parseFloat(lieu.getAttribute('data-y'));
      var echelle = svg.clientWidth / vb.w;
      bulle.querySelector('strong').textContent = lieu.getAttribute('data-nom');
      bulle.querySelector('span').textContent = lieu.getAttribute('data-info');
      bulle.style.left = Math.max(70, Math.min(svg.clientWidth - 70, (x - vb.x) * echelle)) + 'px';
      bulle.style.top = Math.max(60, (y - vb.y) * echelle) + 'px';
      bulle.hidden = false;
    }
    function cacherBulle() { if (bulle) bulle.hidden = true; }

    Array.prototype.forEach.call(svg.querySelectorAll('a.lieu'), function (lieu) {
      lieu.addEventListener('mouseenter', function () { montrerBulle(lieu); });
      lieu.addEventListener('mouseleave', cacherBulle);
      lieu.addEventListener('focus', function () {
        // Si la carte est zoomée et que le lieu est hors champ, on recentre dessus.
        var x = parseFloat(lieu.getAttribute('data-x'));
        var y = parseFloat(lieu.getAttribute('data-y'));
        if (x < vb.x || x > vb.x + vb.w || y < vb.y || y > vb.y + vb.h) {
          vb.x = x - vb.w / 2; vb.y = y - vb.h / 2; appliquer();
        }
        montrerBulle(lieu);
      });
      lieu.addEventListener('blur', cacherBulle);
    });
    fig.addEventListener('keydown', function (e) { if (e.key === 'Escape') cacherBulle(); });

    /* Déplacement (souris ou doigt) quand la carte est zoomée */
    var glisse = null;
    var aBouge = false;
    vue.addEventListener('pointerdown', function (e) {
      if (vb.w >= W - 1) return;
      glisse = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
      aBouge = false;
    });
    window.addEventListener('pointermove', function (e) {
      if (!glisse) return;
      var echelle = vb.w / svg.clientWidth;
      var dx = e.clientX - glisse.x, dy = e.clientY - glisse.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) aBouge = true;
      vb.x = glisse.vx - dx * echelle;
      vb.y = glisse.vy - dy * echelle;
      appliquer();
    });
    window.addEventListener('pointerup', function () { glisse = null; });
    // Un glisser ne doit pas déclencher l'ouverture d'un lien.
    vue.addEventListener('click', function (e) {
      if (aBouge) { e.preventDefault(); aBouge = false; }
    }, true);
  });
})();
