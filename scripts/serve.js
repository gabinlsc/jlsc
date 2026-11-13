#!/usr/bin/env node
/**
 * Serveur local de prévisualisation de dist/ (sans dépendance).
 * Reproduit le comportement de Nginx : /chemin/ → index.html, 404 → /404.html.
 *   PORT=8080 node scripts/serve.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8'
};

function envoyer(res, statut, fichier) {
  res.writeHead(statut, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(fichier).pipe(res);
}

http
  .createServer((req, res) => {
    let chemin;
    try {
      chemin = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
      chemin = '/';
    }
    let fichier = path.normalize(path.join(DIST, chemin));
    if (!fichier.startsWith(DIST) || /\/\./.test(chemin)) return envoyer(res, 404, path.join(DIST, '404.html'));
    if (fs.existsSync(fichier) && fs.statSync(fichier).isDirectory()) {
      if (!chemin.endsWith('/')) {
        res.writeHead(301, { Location: chemin + '/' });
        return res.end();
      }
      fichier = path.join(fichier, 'index.html');
    }
    if (chemin === '/404.html' || !fs.existsSync(fichier)) return envoyer(res, 404, path.join(DIST, '404.html'));
    return envoyer(res, 200, fichier);
  })
  .listen(PORT, () => console.log(`▶ Aperçu : http://localhost:${PORT}/`));
