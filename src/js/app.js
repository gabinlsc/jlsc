/**
 * Script commun à toutes les pages : menu mobile, préférences d'affichage,
 * modale « Bientôt disponible », formulaires (mailto / service externe),
 * apparition au défilement. Aucune dépendance.
 */
(function () {
  'use strict';
  var doc = document.documentElement;
  var $ = function (s, ctx) { return (ctx || document).querySelector(s); };
  var $$ = function (s, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(s)); };
  var stocker = function (k, v) {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignoré */ }
  };

  /* ---------- Menu mobile ---------- */
  var btnMenu = $('.btn-menu');
  var nav = $('#menu-principal');
  if (btnMenu && nav) {
    btnMenu.addEventListener('click', function () {
      var ouvert = btnMenu.getAttribute('aria-expanded') === 'true';
      btnMenu.setAttribute('aria-expanded', String(!ouvert));
      if (ouvert) nav.removeAttribute('data-ouvert'); else nav.setAttribute('data-ouvert', '');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btnMenu.getAttribute('aria-expanded') === 'true') {
        btnMenu.click();
        btnMenu.focus();
      }
    });
  }

  /* ---------- Taille du texte et mode « carte de nuit » ---------- */
  var outils = $('.outils-affichage');
  if (outils) {
    $$('[data-texte]', outils).forEach(function (b) {
      b.addEventListener('click', function () {
        var n = parseInt(doc.getAttribute('data-texte') || '0', 10);
        n = Math.max(0, Math.min(3, n + (b.getAttribute('data-texte') === 'plus' ? 1 : -1)));
        if (n) doc.setAttribute('data-texte', String(n)); else doc.removeAttribute('data-texte');
        stocker('jl-texte', n ? String(n) : null);
      });
    });
    var btnTheme = $('[data-theme-toggle]', outils);
    var majTheme = function () {
      var nuit = doc.getAttribute('data-theme') === 'dark';
      btnTheme.setAttribute('aria-pressed', String(nuit));
      var meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', nuit ? '#0E1826' : '#F5EFE2');
    };
    btnTheme.addEventListener('click', function () {
      var nuit = doc.getAttribute('data-theme') !== 'dark';
      doc.setAttribute('data-theme', nuit ? 'dark' : 'light');
      stocker('jl-theme', nuit ? 'dark' : null);
      majTheme();
    });
    majTheme();
  }

  /* ---------- Modale « Bientôt disponible » ---------- */
  var dialog = $('#dialog-bientot');
  var declencheur = null;
  if (dialog && typeof dialog.showModal === 'function') {
    $$('[data-bientot]').forEach(function (lien) {
      lien.addEventListener('click', function (e) {
        e.preventDefault();
        declencheur = lien;
        var titre = lien.getAttribute('data-livre') || '';
        $('[data-livre-titre]', dialog).textContent = '« ' + titre + ' »';
        $('input[name="livre"]', dialog).value = titre;
        $('.formulaire-statut', dialog).textContent = '';
        dialog.showModal();
        $('input[type="email"]', dialog).focus();
      });
    });
    var fermer = function () { dialog.close(); };
    $$('[data-fermer]', dialog).forEach(function (b) { b.addEventListener('click', fermer); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) fermer(); });
    dialog.addEventListener('close', function () { if (declencheur) declencheur.focus(); });
  }

  /* ---------- Formulaires ---------- */
  var OBJETS = {
    question: 'Question sur un livre',
    prevenir: 'Être prévenu de la disponibilité d\'un livre',
    commande: 'Commande, retrait ou dédicace',
    invitation: 'Invitation (conférence, rencontre, dédicace)',
    autre: 'Message'
  };
  $$('form[data-formulaire]').forEach(function (form) {
    var statut = $('.formulaire-statut', form);
    form.addEventListener('submit', function (e) {
      var donnees = new FormData(form);
      // Pot de miel : un robot a rempli le champ caché → on ignore silencieusement.
      if (donnees.get('_gotcha')) {
        e.preventDefault();
        statut.textContent = 'Merci, votre message a bien été pris en compte.';
        return;
      }
      if (form.getAttribute('data-mailto') === 'true') {
        e.preventDefault();
        var corps = [];
        var objet = OBJETS[donnees.get('objet')] || 'Message depuis le site';
        if (donnees.get('livre')) objet = 'Être prévenu : ' + donnees.get('livre');
        donnees.forEach(function (v, k) {
          if (k !== '_gotcha' && k !== 'accord' && k !== 'objet' && v) corps.push(k.charAt(0).toUpperCase() + k.slice(1) + ' : ' + v);
        });
        var adresse = form.getAttribute('action').split('?')[0];
        window.location.href = adresse + '?subject=' + encodeURIComponent(objet + ' — jlescoat.glsc.fr') + '&body=' + encodeURIComponent(corps.join('\n\n'));
        statut.textContent = 'Votre logiciel de messagerie s\'ouvre avec le message prérempli : il ne vous reste qu\'à l\'envoyer. Si rien ne s\'ouvre, écrivez directement à ' + adresse.replace('mailto:', '') + '.';
        return;
      }
      // Service de formulaire externe (ex. Formspree) : envoi sans quitter la page.
      if (!window.fetch) return;
      e.preventDefault();
      statut.textContent = 'Envoi en cours…';
      fetch(form.action, { method: 'POST', body: donnees, headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          form.reset();
          statut.textContent = 'Merci ! Votre message a bien été envoyé.';
        })
        .catch(function () {
          statut.textContent = 'L\'envoi a échoué. Merci de réessayer plus tard ou d\'écrire directement par e-mail.';
        });
    });
  });

  // Préremplissage du formulaire de contact depuis l'URL (?livre=… ou ?objet=…).
  var formContact = $('form[data-formulaire="contact"]');
  if (formContact && window.URLSearchParams) {
    var params = new URLSearchParams(window.location.search);
    var selObjet = $('select[name="objet"]', formContact);
    if (params.get('objet') && OBJETS[params.get('objet')]) selObjet.value = params.get('objet');
    if (params.get('livre')) {
      selObjet.value = 'prevenir';
      var msg = $('textarea[name="message"]', formContact);
      if (!msg.value) msg.value = 'Bonjour,\n\nJe souhaite être prévenu(e) dès que le livre « ' + params.get('livre').slice(0, 200) + ' » sera disponible à l\'achat.\n\nMerci.';
    }
  }

  /* ---------- Apparition au défilement ---------- */
  var elements = $$('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var io = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('est-visible'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    elements.forEach(function (el) { io.observe(el); });
  } else {
    elements.forEach(function (el) { el.classList.add('est-visible'); });
  }

  /* ---------- Agenda : masque les événements devenus passés depuis le dernier build ---------- */
  var auj = new Date().toISOString().slice(0, 10);
  $$('.evenements:not(.evenements--passes) [data-fin]').forEach(function (li) {
    if (li.getAttribute('data-fin') < auj) li.hidden = true;
  });
})();
