/**
 * Configuration Tailwind CSS (v3, build CLI).
 * Les couleurs pointent vers des variables CSS (src/styles/main.css) :
 * le mode « carte de nuit » ne fait que redéfinir ces variables.
 */
/** @type {import('tailwindcss').Config} */
const couleur = (nom) => `rgb(var(--c-${nom}) / <alpha-value>)`;

module.exports = {
  // Seuls les fichiers qui produisent du HTML sont analysés : le CSS final est purgé.
  content: ['./src/templates/**/*.js', './src/components/**/*.js', './src/js/**/*.js'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        papier: couleur('papier'),
        parchemin: couleur('parchemin'),
        encre: couleur('encre'),
        'encre-douce': couleur('encre-douce'),
        ardoise: couleur('ardoise'),
        vdg: couleur('vdg'),
        ocre: couleur('ocre'),
        'ocre-texte': couleur('ocre-texte'),
        mer: couleur('mer'),
        trait: couleur('trait')
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'Cambria', 'serif'],
        sans: ['"Atkinson Hyperlegible"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif']
      },
      maxWidth: { lecture: '68ch' },
      boxShadow: {
        livre: '0 1px 2px rgb(27 42 65 / .12), 0 10px 24px -8px rgb(27 42 65 / .35), 0 24px 48px -24px rgb(27 42 65 / .3)',
        'livre-survol': '0 2px 4px rgb(27 42 65 / .14), 0 16px 32px -8px rgb(27 42 65 / .4), 0 32px 60px -24px rgb(27 42 65 / .35)'
      }
    }
  },
  plugins: []
};
