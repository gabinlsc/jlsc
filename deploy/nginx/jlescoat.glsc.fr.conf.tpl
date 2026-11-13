# ==========================================================================
#  Vhost Nginx — ${DOMAIN}
#  Généré par ./deploy.sh init à partir de deploy/nginx/jlescoat.glsc.fr.conf.tpl
#  NE PAS MODIFIER SUR LE SERVEUR : modifier le gabarit puis relancer
#  « ./deploy.sh init » (idempotent, sauvegarde automatique de l'ancienne version).
#
#  Variables injectées : ${DOMAIN}, ${REMOTE_ROOT}, ${CERT_DIR}, ${HTTP2_LISTEN},
#  ${HTTP2_DIRECTIVE}, ${BROTLI}, ${CSP_EXTRA_FORM}, ${CSP_EXTRA_SCRIPT}, ${CSP_EXTRA_CONNECT}
#  Tous les noms globaux (map, zones) sont préfixés « jlescoat_ » pour ne
#  jamais entrer en conflit avec les autres sites du serveur.
# ==========================================================================

# Politique de cache selon le chemin : assets fingerprintés = 1 an immuable,
# HTML et fichiers à nom fixe = revalidation.
map $uri $jlescoat_cache_control {
    ~^/assets/                        "public, max-age=31536000, immutable";
    ~\.(?:ico|png|svg)$               "public, max-age=604800";
    default                           "no-cache";
}

# --- HTTP : redirection permanente vers HTTPS (sauf défi ACME) ---------------
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    server_tokens off;

    location ^~ /.well-known/acme-challenge/ {
        root ${REMOTE_ROOT}/shared/acme;
        default_type text/plain;
    }
    location / {
        return 301 https://${DOMAIN}$request_uri;
    }

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log  /var/log/nginx/${DOMAIN}.error.log warn;
}

# --- HTTPS -------------------------------------------------------------------
server {
    listen 443 ssl${HTTP2_LISTEN};
    listen [::]:443 ssl${HTTP2_LISTEN};
    ${HTTP2_DIRECTIVE}
    server_name ${DOMAIN};
    server_tokens off;

    root ${REMOTE_ROOT}/current;
    index index.html;
    charset utf-8;

    # Certificat Let's Encrypt (renouvelé automatiquement par certbot.timer)
    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:jlescoat_SSL:10m;
    ssl_session_tickets off;

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log  /var/log/nginx/${DOMAIN}.error.log warn;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_min_length 512;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml application/xml application/javascript text/javascript application/json image/svg+xml font/woff2;
${BROTLI}

    # En-têtes de sécurité (always = aussi sur les pages d'erreur)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=(), payment=(self \"https://payhip.com\")" always;
    # CSP compatible Payhip (overlay de paiement : script, iframe, appels réseau, formulaires)
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://payhip.com https://*.payhip.com${CSP_EXTRA_SCRIPT}; style-src 'self' 'unsafe-inline' https://payhip.com https://*.payhip.com; img-src 'self' data: https://payhip.com https://*.payhip.com; font-src 'self' https://payhip.com https://*.payhip.com; connect-src 'self' https://payhip.com https://*.payhip.com${CSP_EXTRA_CONNECT}; frame-src https://payhip.com https://*.payhip.com; form-action 'self' https://payhip.com mailto:${CSP_EXTRA_FORM}; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; upgrade-insecure-requests" always;
    add_header Cache-Control $jlescoat_cache_control always;

    # Fichiers cachés (.git, .env…) : jamais servis
    location ~ /\. {
        return 404;
    }

    # Page 404 « hors carte » : accessible uniquement en interne,
    # une requête directe sur /404.html renvoie donc bien un statut 404.
    error_page 404 /404.html;
    location = /404.html {
        internal;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
