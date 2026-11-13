#!/usr/bin/env bash
# ==========================================================================
#  DÉPLOIEMENT — site de Jacques Lescoat (https://jlescoat.glsc.fr)
#
#  ./deploy.sh init     [--dry-run]   première mise en place du serveur (idempotente)
#  ./deploy.sh deploy   [--dry-run]   build local, envoi, bascule atomique, healthcheck
#  ./deploy.sh rollback [release]     retour à la release précédente (ou à celle indiquée)
#  ./deploy.sh status                 release active, releases, Nginx, certificat
#
#  Configuration : deploy.config.env (copie de deploy.config.env.example, ignoré par Git).
#  Fichier unique : le script serveur et le gabarit Nginx sont intégrés plus bas.
#  Authentification SSH par clé uniquement. Aucun secret dans ce dépôt.
# ==========================================================================
set -Eeuo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$RACINE"
CONFIG_FILE="${DEPLOY_CONFIG:-$RACINE/deploy.config.env}"

# --------------------------------------------------------------------------
# Affichage
# --------------------------------------------------------------------------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1;34m'; D=$'\e[2m'; BOLD=$'\e[1m'; N=$'\e[0m'
else
  R='' G='' Y='' B='' D='' BOLD='' N=''
fi
titre() { printf '\n%s\n' "${B}━━ $* ━━${N}"; }
etape() { printf '%s\n' "${B}▸${N} ${BOLD}$*${N}"; }
ok()    { printf '%s\n' "  ${G}✔${N} $*"; }
info()  { printf '%s\n' "  ${D}$*${N}"; }
warn()  { printf '%s\n' "  ${Y}⚠ $*${N}" >&2; }
die()   { printf '%s\n' "  ${R}✘ $1${N}" >&2; [[ -n "${2:-}" ]] && printf '%s\n' "    ${BOLD}→ Pour corriger :${N} $2" >&2; exit "${3:-1}"; }
plan()  { printf '%s\n' "  ${Y}[dry-run]${N} $*"; }

on_error() {
  local code=$? ligne=$1 cmd=$2
  printf '%s\n' "${R}✘ Erreur (code $code) ligne $ligne : ${cmd}${N}" >&2
  exit "$code"
}
trap 'on_error $LINENO "$BASH_COMMAND"' ERR

usage() {
  sed -n '3,12p' "$0" | sed 's/^#  \{0,1\}//'
  exit "${1:-0}"
}

# --------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------
COMMANDE="${1:-}"
[[ -z "$COMMANDE" || "$COMMANDE" == "-h" || "$COMMANDE" == "--help" ]] && usage 0
shift || true
DRY_RUN=0
CIBLE_ROLLBACK=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage 0 ;;
    -*) die "Option inconnue : $a" "./deploy.sh --help" ;;
    *) CIBLE_ROLLBACK="$a" ;;
  esac
done
if [[ $DRY_RUN == 1 && "$COMMANDE" != "init" && "$COMMANDE" != "deploy" ]]; then
  die "--dry-run n'est disponible que pour init et deploy."
fi

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
HORS_LIGNE=0   # dry-run sans serveur joignable : simulation locale uniquement
charger_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
  elif [[ $DRY_RUN == 1 ]]; then
    warn "deploy.config.env absent : simulation avec les valeurs d'exemple."
    # shellcheck disable=SC1091
    source "$RACINE/deploy.config.env.example"
  else
    die "Fichier de configuration introuvable : $CONFIG_FILE" "cp deploy.config.env.example deploy.config.env  puis renseignez SSH_HOST, SSH_USER et CERTBOT_EMAIL"
  fi
  DOMAIN="${DOMAIN:-jlescoat.glsc.fr}"
  SSH_PORT="${SSH_PORT:-22}"
  REMOTE_ROOT="${REMOTE_ROOT:-/var/www/$DOMAIN}"
  KEEP_RELEASES="${KEEP_RELEASES:-5}"
  REMOTE_ROOT="${REMOTE_ROOT%/}"

  [[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "DOMAIN invalide : « $DOMAIN »" "corrigez DOMAIN dans deploy.config.env"
  [[ "$REMOTE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ && "$REMOTE_ROOT" != "/" && "$(tr -cd '/' <<<"$REMOTE_ROOT" | wc -c)" -ge 2 ]] \
    || die "REMOTE_ROOT invalide ou trop proche de la racine : « $REMOTE_ROOT »" "utilisez par exemple REMOTE_ROOT=/var/www/$DOMAIN"
  [[ "$KEEP_RELEASES" =~ ^[0-9]+$ && "$KEEP_RELEASES" -ge 2 ]] || die "KEEP_RELEASES doit être un nombre ≥ 2." "KEEP_RELEASES=5"
  [[ "$SSH_PORT" =~ ^[0-9]+$ ]] || die "SSH_PORT invalide." "SSH_PORT=22"

  if [[ -z "${SSH_HOST:-}" || -z "${SSH_USER:-}" ]]; then
    if [[ $DRY_RUN == 1 ]]; then
      HORS_LIGNE=1
      warn "SSH_HOST / SSH_USER non renseignés : simulation locale, sans connexion au serveur."
    else
      die "SSH_HOST et SSH_USER doivent être renseignés." "éditez deploy.config.env"
    fi
  fi
  [[ "${SSH_USER:-}" != "root" ]] || die "SSH_USER ne doit pas être root." "créez un utilisateur avec sudo : adduser deploy && usermod -aG sudo deploy"

  SSH_OPTS=(-p "$SSH_PORT" -o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=10
    -o ControlMaster=auto -o "ControlPath=$HOME/.ssh/cm-jlescoat-%r@%h:%p" -o ControlPersist=60)
  CIBLE="${SSH_USER:-?}@${SSH_HOST:-?}"
}

requiert() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null || die "Outil local manquant : $c" "installez-le (ex. sudo apt install $c  ou  brew install $c)"
  done
}

# --------------------------------------------------------------------------
# SSH
# --------------------------------------------------------------------------
ssh_run() { ssh "${SSH_OPTS[@]}" "$CIBLE" "$@"; }

# Commande root sur le serveur. sudo demande le mot de passe dans un terminal
# (-t) si nécessaire ; sans terminal, sudo doit être configuré en NOPASSWD.
# Le script est transmis encodé en base64 : aucune dépendance au shell distant.
ssh_sudo() {
  local b64 decode
  b64="$(printf '%s' "$1" | base64 | tr -d '\n')"
  decode="\"\$(printf '%s' '$b64' | base64 -d)\""
  if [[ -t 0 ]]; then ssh -t "${SSH_OPTS[@]}" "$CIBLE" "sudo -p '[sudo] mot de passe de %u sur le serveur : ' bash -c $decode jlescoat"
  else ssh "${SSH_OPTS[@]}" "$CIBLE" "sudo -n bash -c $decode jlescoat"; fi
}

verifier_ssh() {
  etape "Connexion SSH à $CIBLE (port $SSH_PORT)"
  mkdir -p "$HOME/.ssh"
  if ! ssh_run true 2>/dev/null; then
    if [[ $DRY_RUN == 1 ]]; then
      HORS_LIGNE=1
      warn "Serveur injoignable : la simulation se limite aux étapes locales."
      return 0
    fi
    die "Connexion SSH impossible (clé refusée, hôte ou port incorrect)." \
      "ssh-copy-id -p $SSH_PORT $CIBLE   puis testez : ssh -p $SSH_PORT $CIBLE"
  fi
  ok "Connexion par clé OK"
}

# --------------------------------------------------------------------------
# DNS
# --------------------------------------------------------------------------
resoudre() { # $1 = nom, $2 = 4|6 → une IP par ligne (Node est déjà requis pour le build)
  node -e '
    const dns = require("dns").promises;
    const [n, v] = process.argv.slice(1);
    (v === "6" ? dns.resolve6(n) : dns.resolve4(n))
      .catch(() => dns.lookup(n, { all: true, family: Number(v) }).then((a) => a.map((x) => x.address)))
      .then((a) => console.log(a.join("\n")))
      .catch(() => process.exit(0));' "$1" "${2:-4}" 2>/dev/null || true
}

verifier_dns() {
  etape "Prérequis DNS : $DOMAIN → IP du serveur"
  local ips_domaine ips_serveur hote ip trouve=0 ips6
  ips_domaine="$(resoudre "$DOMAIN" 4)"
  if [[ -z "$ips_domaine" ]]; then
    local msg="Le domaine $DOMAIN ne résout vers aucune adresse IPv4."
    [[ $DRY_RUN == 1 ]] && { warn "$msg (bloquant en exécution réelle)"; return 0; }
    die "$msg" "chez le gestionnaire DNS de glsc.fr, créez un enregistrement A « ${DOMAIN%%.glsc.fr} » → IP publique du VPS, attendez la propagation (dig +short $DOMAIN) puis relancez."
  fi
  info "$DOMAIN → $(tr '\n' ' ' <<<"$ips_domaine")"
  hote="$(ssh -G -p "$SSH_PORT" "$SSH_HOST" 2>/dev/null | awk '/^hostname /{print $2}')"
  ips_serveur="$( { [[ "$hote" =~ ^[0-9.]+$ ]] && echo "$hote" || resoudre "${hote:-$SSH_HOST}" 4; ssh_run "hostname -I 2>/dev/null" | tr ' ' '\n'; } | grep -E '^[0-9.]+$' | sort -u || true)"
  info "Serveur → $(tr '\n' ' ' <<<"$ips_serveur")"
  for ip in $ips_domaine; do grep -qxF "$ip" <<<"$ips_serveur" && trouve=1; done
  if [[ $trouve == 0 ]]; then
    local msg="$DOMAIN ne pointe pas vers ce serveur."
    [[ $DRY_RUN == 1 ]] && { warn "$msg (bloquant en exécution réelle)"; return 0; }
    die "$msg" "corrigez l'enregistrement A « ${DOMAIN%%.glsc.fr} » de la zone glsc.fr pour qu'il vise l'IP du VPS, puis relancez."
  fi
  ok "Le domaine pointe bien vers le serveur"
  ips6="$(resoudre "$DOMAIN" 6)"
  if [[ -n "$ips6" ]] && ! ssh_run "ip -6 addr 2>/dev/null" | grep -qF "$(head -n1 <<<"$ips6")"; then
    warn "Un enregistrement AAAA ($(head -n1 <<<"$ips6")) existe mais ne correspond pas au serveur : Let's Encrypt risque d'échouer. Supprimez-le ou corrigez-le."
  fi
}

# --------------------------------------------------------------------------
# CSP : hôtes supplémentaires selon site.config.json (formulaires, analytics)
# --------------------------------------------------------------------------
calculer_csp() {
  local sortie
  sortie="$(node -e '
    const c = require("./site.config.json");
    const origine = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.origin : ""; } catch { return ""; } };
    const formulaires = [c.forms.contactAction, c.forms.notifyAction].map(origine).filter(Boolean);
    const analytics = c.analytics && c.analytics.enabled ? [origine(c.analytics.src)].filter(Boolean) : [];
    const u = (a) => [...new Set(a)].map((x) => " " + x).join("");
    console.log([u(formulaires), u(analytics), u([...formulaires, ...analytics])].join("\t"));')"
  IFS=$'\t' read -r CSP_EXTRA_FORM CSP_EXTRA_SCRIPT CSP_EXTRA_CONNECT <<<"$sortie" || true
}

# ==========================================================================
# GABARIT NGINX du vhost (variables ${...} injectées côté serveur)
# ==========================================================================
gabarit_nginx() {
  cat <<'NGINX_EOF'
# ==========================================================================
#  Vhost Nginx — ${DOMAIN}
#  Généré par ./deploy.sh init (gabarit intégré à deploy.sh, fonction gabarit_nginx).
#  NE PAS MODIFIER SUR LE SERVEUR : modifier le gabarit dans deploy.sh puis relancer
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
NGINX_EOF
}

# ==========================================================================
# SCRIPT SERVEUR exécuté en root sur le VPS par « init » (jamais en local)
# ==========================================================================
script_serveur() {
  cat <<'SERVEUR_EOF'
# ==========================================================================
#  Script SERVEUR — exécuté en root (sudo) sur le VPS par « ./deploy.sh init ».
#  deploy.sh lui ajoute en tête les variables
#  DOMAIN, REMOTE_ROOT, DEPLOY_USER, CERTBOT_EMAIL, DRY_RUN, TEMPLATE_B64, CSP_*.
#
#  Garanties :
#   - idempotent : peut être rejoué sans casse ;
#   - ne modifie, ne supprime et ne remplace AUCUN autre vhost ;
#   - toute conf remplacée est sauvegardée dans /etc/nginx/backup/ ;
#   - « nginx -t » avant tout reload, restauration automatique en cas d'échec.
# ==========================================================================
set -Eeuo pipefail
# shellcheck disable=SC2016 # les ${VARIABLES} du gabarit sont volontairement littérales
shopt -u patsub_replacement 2>/dev/null || true

if [[ -t 1 ]]; then R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[34m'; D=$'\e[2m'; N=$'\e[0m'; else R='' G='' Y='' B='' D='' N=''; fi
etape() { printf '%s\n' "${B}▸ [serveur] $*${N}"; }
ok()    { printf '%s\n' "  ${G}✔${N} $*"; }
info()  { printf '%s\n' "  ${D}$*${N}"; }
warn()  { printf '%s\n' "  ${Y}⚠ $*${N}"; }
die()   { printf '%s\n' "  ${R}✘ $*${N}" >&2; exit 1; }
trap 'die "Erreur inattendue ligne $LINENO : $BASH_COMMAND"' ERR

# Exécute une commande, ou l'affiche seulement en mode --dry-run.
run() {
  if [[ "${DRY_RUN:-0}" == 1 ]]; then printf '%s\n' "  ${Y}[dry-run]${N} $*"; else "$@"; fi
}

[[ $EUID -eq 0 ]] || die "Ce script doit être lancé avec sudo (par ./deploy.sh init)."
command -v apt-get >/dev/null || die "Serveur non Debian/Ubuntu (apt-get absent) : non pris en charge."
for v in DOMAIN REMOTE_ROOT DEPLOY_USER CERTBOT_EMAIL TEMPLATE_B64; do
  [[ -n "${!v:-}" ]] || die "Variable $v manquante."
done
id "$DEPLOY_USER" >/dev/null 2>&1 || die "Utilisateur $DEPLOY_USER inconnu sur le serveur."

SITE_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
SITE_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
BACKUP_DIR="/etc/nginx/backup"
HORODATAGE="$(date +%Y%m%d-%H%M%S)"

# --------------------------------------------------------------------------
# 1. Paquets (installe uniquement ceux qui manquent, ne met rien à jour)
# --------------------------------------------------------------------------
etape "Paquets requis"
manquants=()
for p in nginx certbot python3-certbot-nginx rsync; do
  if dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed'; then
    ok "$p déjà installé"
  else
    manquants+=("$p")
  fi
done
if ((${#manquants[@]})); then
  warn "À installer : ${manquants[*]}"
  apt_installer() {
    DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-upgrade "$@" >/dev/null
  }
  run apt_installer "${manquants[@]}"
  [[ "${DRY_RUN:-0}" == 1 ]] || ok "Installés : ${manquants[*]}"
fi

if [[ "${DRY_RUN:-0}" != 1 ]]; then
  [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]] \
    || die "Arborescence /etc/nginx/sites-{available,enabled} absente : configuration Nginx non standard, abandon."
fi

# La configuration actuelle doit être valide AVANT toute modification.
if command -v nginx >/dev/null; then
  if nginx -t -q 2>/dev/null; then
    ok "Configuration Nginx actuelle valide (nginx -t)"
  else
    nginx -t || true
    die "La configuration Nginx actuelle est DÉJÀ invalide (voir ci-dessus). Rien n'a été modifié. Corrigez-la puis relancez."
  fi
  systemctl is-active --quiet nginx || { warn "Nginx est arrêté : démarrage."; run systemctl enable --now nginx; }
fi

# --------------------------------------------------------------------------
# 2. Arborescence du site
# --------------------------------------------------------------------------
etape "Arborescence ${REMOTE_ROOT}"
for d in "$REMOTE_ROOT" "$REMOTE_ROOT/releases" "$REMOTE_ROOT/shared" "$REMOTE_ROOT/shared/acme"; do
  if [[ -d "$d" ]]; then ok "$d existe"; else run install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$d"; fi
done
# Propriétaire = utilisateur de déploiement ; www-data lit grâce aux droits « autres » (755/644).
for d in "$REMOTE_ROOT" "$REMOTE_ROOT/releases" "$REMOTE_ROOT/shared"; do
  if [[ -d "$d" && "$(stat -c '%U:%G %a' "$d")" != "$DEPLOY_USER:$DEPLOY_USER 755" ]]; then
    run chown "$DEPLOY_USER:$DEPLOY_USER" "$d"
    run chmod 755 "$d"
  fi
done

# Release d'attente tant qu'aucun déploiement n'a eu lieu (évite un 404 sur le domaine).
if [[ ! -e "$REMOTE_ROOT/current" ]]; then
  ATTENTE="$REMOTE_ROOT/releases/00000000-000000-init"
  if [[ "${DRY_RUN:-0}" == 1 ]]; then
    run "créer une page d'attente dans $ATTENTE et y pointer $REMOTE_ROOT/current"
  else
    install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 755 "$ATTENTE"
    printf '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Jacques Lescoat — site en préparation</title><body style="font-family:Georgia,serif;background:#F5EFE2;color:#1B2A41;display:grid;place-items:center;min-height:90vh"><p>Jacques Lescoat — site en préparation.</p></body></html>\n' > "$ATTENTE/index.html"
    cp "$ATTENTE/index.html" "$ATTENTE/404.html"
    chown "$DEPLOY_USER:$DEPLOY_USER" "$ATTENTE"/*.html && chmod 644 "$ATTENTE"/*.html
    ln -sfn "releases/00000000-000000-init" "$REMOTE_ROOT/current"
    chown -h "$DEPLOY_USER:$DEPLOY_USER" "$REMOTE_ROOT/current"
    ok "Page d'attente en place (remplacée au premier ./deploy.sh deploy)"
  fi
fi

# --------------------------------------------------------------------------
# 3. Rendu du vhost
# --------------------------------------------------------------------------
NGINX_VERSION="$(nginx -v 2>&1 | sed -n 's|.*nginx/\([0-9.]*\).*|\1|p' || true)"
version_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]; }
if [[ -n "$NGINX_VERSION" ]] && version_ge "$NGINX_VERSION" "1.25.1"; then
  HTTP2_LISTEN=""; HTTP2_DIRECTIVE="http2 on;"
else
  HTTP2_LISTEN=" http2"; HTTP2_DIRECTIVE="# HTTP/2 activé sur la directive listen (Nginx ${NGINX_VERSION:-?} < 1.25.1)"
fi
if nginx -V 2>&1 | grep -qi brotli || ls /etc/nginx/modules-enabled/*brotli* >/dev/null 2>&1; then
  BROTLI=$'    brotli on;\n    brotli_comp_level 5;\n    brotli_types text/plain text/css text/xml application/xml application/javascript text/javascript application/json image/svg+xml;'
  info "Module Brotli détecté : activé"
else
  BROTLI="    # Brotli : module non disponible sur ce serveur (gzip seul)."
fi

render() { # $1 = dossier du certificat
  local t
  t="$(printf '%s' "$TEMPLATE_B64" | base64 -d)"
  t="${t//'${DOMAIN}'/$DOMAIN}"
  t="${t//'${REMOTE_ROOT}'/$REMOTE_ROOT}"
  t="${t//'${CERT_DIR}'/$1}"
  t="${t//'${HTTP2_LISTEN}'/$HTTP2_LISTEN}"
  t="${t//'${HTTP2_DIRECTIVE}'/$HTTP2_DIRECTIVE}"
  t="${t//'${BROTLI}'/$BROTLI}"
  t="${t//'${CSP_EXTRA_FORM}'/${CSP_EXTRA_FORM:-}}"
  t="${t//'${CSP_EXTRA_SCRIPT}'/${CSP_EXTRA_SCRIPT:-}}"
  t="${t//'${CSP_EXTRA_CONNECT}'/${CSP_EXTRA_CONNECT:-}}"
  # Serveur sans IPv6 : on retire les directives « listen [::] » (sinon Nginx refuse de démarrer).
  if [[ ! -f /proc/net/if_inet6 ]]; then t="$(printf '%s\n' "$t" | grep -v 'listen \[::\]')"; fi
  printf '%s\n' "$t"
}

# Conf minimale HTTP, utilisée uniquement le temps d'obtenir le premier certificat.
bootstrap_conf() {
  cat <<EOF
# ${DOMAIN} — configuration temporaire (obtention du certificat). Remplacée par ./deploy.sh init.
server {
    listen 80;
    $( if [[ -f /proc/net/if_inet6 ]]; then echo 'listen [::]:80;'; fi )
    server_name ${DOMAIN};
    server_tokens off;
    root ${REMOTE_ROOT}/current;
    index index.html;
    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log  /var/log/nginx/${DOMAIN}.error.log warn;
    location ^~ /.well-known/acme-challenge/ { root ${REMOTE_ROOT}/shared/acme; default_type text/plain; }
    location / { try_files \$uri \$uri/ =404; }
}
EOF
}

# Installe une conf pour CE domaine uniquement : sauvegarde, nginx -t, reload, restauration si échec.
installer_conf() {
  local contenu="$1" sauvegarde="" existait=0 lien=0
  if [[ -f "$SITE_AVAILABLE" ]] && [[ "$(cat "$SITE_AVAILABLE")" == "$contenu" ]] && [[ -L "$SITE_ENABLED" ]]; then
    ok "Vhost ${SITE_AVAILABLE} inchangé"
    return 0
  fi
  if [[ "${DRY_RUN:-0}" == 1 ]]; then
    run "écrire ${SITE_AVAILABLE} (aperçu des différences ci-dessous)"
    if [[ -f "$SITE_AVAILABLE" ]]; then
      diff -u "$SITE_AVAILABLE" <(printf '%s\n' "$contenu") | sed 's/^/      /' || true
      run "sauvegarder l'ancienne version dans ${BACKUP_DIR}/${DOMAIN}.${HORODATAGE}"
    else
      printf '%s\n' "$contenu" | sed 's/^/      /'
    fi
    [[ -L "$SITE_ENABLED" ]] || run ln -s "$SITE_AVAILABLE" "$SITE_ENABLED"
    run nginx -t
    run systemctl reload nginx
    return 0
  fi
  [[ -L "$SITE_ENABLED" ]] && lien=1
  if [[ -f "$SITE_AVAILABLE" ]]; then
    existait=1
    install -d -m 755 "$BACKUP_DIR"
    sauvegarde="${BACKUP_DIR}/${DOMAIN}.${HORODATAGE}"
    cp -a "$SITE_AVAILABLE" "$sauvegarde"
    info "Ancienne conf sauvegardée : $sauvegarde"
  fi
  printf '%s\n' "$contenu" > "$SITE_AVAILABLE"
  chmod 644 "$SITE_AVAILABLE"
  [[ -L "$SITE_ENABLED" ]] || ln -s "$SITE_AVAILABLE" "$SITE_ENABLED"
  if ! nginx -t 2>/tmp/jlescoat-nginx-t.log; then
    cat /tmp/jlescoat-nginx-t.log >&2
    if ((existait)); then cp -a "$sauvegarde" "$SITE_AVAILABLE"; else rm -f "$SITE_AVAILABLE"; fi
    ((lien)) || rm -f "$SITE_ENABLED"
    nginx -t -q 2>/dev/null && info "Configuration précédente restaurée, Nginx non rechargé."
    die "nginx -t a échoué avec la nouvelle conf de ${DOMAIN} : abandon (les autres sites ne sont pas affectés)."
  fi
  systemctl reload nginx
  ok "Vhost ${DOMAIN} installé et Nginx rechargé"
}

# --------------------------------------------------------------------------
# 4. Certificat Let's Encrypt
# --------------------------------------------------------------------------
cert_valide() { # $1 = dossier
  local f="$1/fullchain.pem"
  [[ -f "$f" ]] && openssl x509 -checkend 86400 -noout -in "$f" >/dev/null 2>&1 \
    && openssl x509 -noout -text -in "$f" 2>/dev/null | grep -q "DNS:${DOMAIN}\b"
}
trouver_cert() {
  local d
  for d in "/etc/letsencrypt/live/${DOMAIN}" /etc/letsencrypt/live/"${DOMAIN}"-[0-9][0-9][0-9][0-9]; do
    if [[ -d "$d" ]] && cert_valide "$d"; then printf '%s' "$d"; return 0; fi
  done
  return 1
}

etape "Vhost Nginx et certificat HTTPS"
if CERT_DIR="$(trouver_cert)"; then
  ok "Certificat valide trouvé : $CERT_DIR ($(openssl x509 -enddate -noout -in "$CERT_DIR/fullchain.pem" | cut -d= -f2))"
  installer_conf "$(render "$CERT_DIR")"
else
  warn "Aucun certificat valide pour ${DOMAIN} : obtention auprès de Let's Encrypt."
  installer_conf "$(bootstrap_conf)"
  run certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
  if [[ "${DRY_RUN:-0}" == 1 ]]; then
    run "installer ensuite le vhost complet (HTTPS, HTTP/2, en-têtes de sécurité, CSP)"
  else
    CERT_DIR="$(trouver_cert)" || die "Certificat introuvable après certbot. Vérifiez : sudo certbot certificates"
    ok "Certificat obtenu : $CERT_DIR"
    installer_conf "$(render "$CERT_DIR")"
  fi
fi

# Renouvellement automatique
etape "Renouvellement automatique du certificat"
if systemctl is-active --quiet certbot.timer || systemctl is-active --quiet snap.certbot.renew.timer; then
  ok "Timer de renouvellement actif"
elif systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
  run systemctl enable --now certbot.timer
else
  warn "Aucun timer certbot trouvé : vérifiez le renouvellement (sudo systemctl list-timers | grep certbot)."
fi
if [[ "${DRY_RUN:-0}" == 1 ]] || [[ -z "${CERT_DIR:-}" ]]; then
  run certbot renew --dry-run --cert-name "$(basename "${CERT_DIR:-$DOMAIN}")"
else
  certbot renew --dry-run --cert-name "$(basename "$CERT_DIR")" -q && ok "certbot renew --dry-run : OK" \
    || warn "certbot renew --dry-run a échoué : consultez /var/log/letsencrypt/letsencrypt.log"
fi

# --------------------------------------------------------------------------
# 5. Pare-feu (uniquement si UFW est actif)
# --------------------------------------------------------------------------
etape "Pare-feu"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  for port in 80/tcp 443/tcp; do
    if ufw status | grep -qE "^${port}[[:space:]]+ALLOW"; then ok "UFW autorise déjà ${port}"; else run ufw allow "$port"; fi
  done
else
  info "UFW inactif ou absent : aucune règle modifiée."
fi

etape "Terminé"
if [[ "${DRY_RUN:-0}" == 1 ]]; then ok "Simulation terminée : rien n'a été modifié."; else ok "Serveur prêt pour ${DOMAIN}."; fi
SERVEUR_EOF
}

# --------------------------------------------------------------------------
# init
# --------------------------------------------------------------------------
cmd_init() {
  requiert ssh node base64
  charger_config
  titre "Initialisation du serveur pour $DOMAIN$([[ $DRY_RUN == 1 ]] && echo ' (simulation)')"
  if [[ -z "${CERTBOT_EMAIL:-}" ]]; then
    [[ $DRY_RUN == 1 ]] && { warn "CERTBOT_EMAIL vide (obligatoire en exécution réelle)."; CERTBOT_EMAIL="exemple@invalid"; } \
      || die "CERTBOT_EMAIL est vide." "renseignez CERTBOT_EMAIL dans deploy.config.env (avis d'expiration Let's Encrypt)"
  fi
  [[ $HORS_LIGNE == 1 ]] || verifier_ssh
  [[ $HORS_LIGNE == 1 ]] || verifier_dns
  calculer_csp

  # Script serveur autonome : variables + gabarit Nginx encodé + script_serveur.
  local script
  script="$(
    printf 'DOMAIN=%q\nREMOTE_ROOT=%q\nDEPLOY_USER=%q\nCERTBOT_EMAIL=%q\nDRY_RUN=%q\n' "$DOMAIN" "$REMOTE_ROOT" "${SSH_USER:-deploy}" "$CERTBOT_EMAIL" "$DRY_RUN"
    printf 'CSP_EXTRA_FORM=%q\nCSP_EXTRA_SCRIPT=%q\nCSP_EXTRA_CONNECT=%q\n' "${CSP_EXTRA_FORM:-}" "${CSP_EXTRA_SCRIPT:-}" "${CSP_EXTRA_CONNECT:-}"
    printf 'TEMPLATE_B64=%q\n' "$(gabarit_nginx | base64 | tr -d '\n')"
    script_serveur
  )"

  if [[ $HORS_LIGNE == 1 ]]; then
    etape "Simulation locale (serveur non contacté)"
    plan "vérifier que $DOMAIN résout vers l'IP du VPS"
    plan "installer si absents : nginx certbot python3-certbot-nginx rsync"
    plan "créer $REMOTE_ROOT/{releases,shared} (propriétaire ${SSH_USER:-<SSH_USER>}, lecture www-data)"
    plan "écrire /etc/nginx/sites-available/$DOMAIN + lien dans sites-enabled (sauvegarde horodatée dans /etc/nginx/backup/)"
    plan "nginx -t puis systemctl reload nginx (restauration automatique si échec)"
    plan "certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $CERTBOT_EMAIL --redirect (si aucun certificat valide)"
    plan "vérifier certbot.timer et lancer certbot renew --dry-run"
    plan "ouvrir 80/tcp et 443/tcp dans UFW (si actif)"
    bash -n <<<"$script" && ok "Script serveur généré et syntaxiquement valide ($(wc -c <<<"$script" | tr -d ' ') octets)"
    ok "Simulation terminée : rien n'a été modifié."
    return 0
  fi

  etape "Exécution sur le serveur (sudo)"
  ssh_sudo "$script" || die "La mise en place a échoué sur le serveur (voir ci-dessus)." "corrigez le problème indiqué puis relancez ./deploy.sh init (sans risque : idempotent)"
  if [[ $DRY_RUN == 0 ]]; then
    titre "Serveur prêt"
    info "Étape suivante : ./deploy.sh deploy  (ou npm run deploy)"
  fi
}

# --------------------------------------------------------------------------
# Healthcheck HTTPS
# --------------------------------------------------------------------------
healthcheck() { # $1 = identifiant de release attendu
  local base="https://$DOMAIN" essai code page attendu="$1"
  for essai in 1 2 3; do
    if [[ "$(curl -fsS --max-time 15 "$base/release.txt" 2>/dev/null | tr -d '[:space:]')" == "$attendu" ]]; then break; fi
    [[ $essai == 3 ]] && { warn "$base/release.txt ne renvoie pas « $attendu »"; return 1; }
    sleep 2
  done
  ok "Release $attendu servie"
  page="$(curl -fsS --max-time 15 "$base/" 2>/dev/null)" || { warn "$base/ ne répond pas en 200"; return 1; }
  grep -q "Jacques Lescoat" <<<"$page" || { warn "$base/ ne contient pas « Jacques Lescoat »"; return 1; }
  ok "GET / → 200, contenu attendu présent"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base/404.html")"
  [[ "$code" == 404 ]] || { warn "/404.html renvoie $code au lieu de 404"; return 1; }
  ok "GET /404.html → 404"
  for chemin in /sitemap.xml /robots.txt; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base$chemin")"
    [[ "$code" == 200 ]] || { warn "$chemin renvoie $code au lieu de 200"; return 1; }
    ok "GET $chemin → 200"
  done
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://$DOMAIN/")"
  [[ "$code" == 301 ]] && ok "HTTP → HTTPS : 301" || warn "La redirection HTTP → HTTPS renvoie $code (attendu 301)"
  return 0
}

# Bascule atomique du lien « current » (lien temporaire + mv -T = rename atomique).
basculer() { # $1 = nom de release
  ssh_run "cd $(printf '%q' "$REMOTE_ROOT") && ln -sfn releases/$(printf '%q' "$1") .current.tmp && mv -Tf .current.tmp current"
}
recharger_nginx() { ssh_sudo "nginx -t -q && systemctl reload nginx"; }
release_active() { ssh_run "readlink $(printf '%q' "$REMOTE_ROOT/current") 2>/dev/null | xargs -r basename" || true; }
lister_releases() { ssh_run "ls -1 $(printf '%q' "$REMOTE_ROOT/releases") 2>/dev/null | grep -E '^[0-9]{8}-[0-9]{6}(-init)?$' | sort" || true; }

# --------------------------------------------------------------------------
# deploy
# --------------------------------------------------------------------------
cmd_deploy() {
  requiert node npm rsync ssh curl
  charger_config
  titre "Déploiement de $DOMAIN$([[ $DRY_RUN == 1 ]] && echo ' (simulation)')"

  etape "Build local"
  npm ci --no-audit --no-fund --loglevel=error
  npm run build --silent
  [[ -f "$RACINE/dist/index.html" ]] || die "dist/index.html absent après le build : abandon." "npm run build  et lisez le message d'erreur"
  ok "Build OK ($(find dist -type f | wc -l | tr -d ' ') fichiers, $(du -sh dist | cut -f1))"

  [[ $HORS_LIGNE == 1 ]] || verifier_ssh
  local TS RELEASE PRECEDENTE
  TS="$(date -u +%Y%m%d-%H%M%S)"
  RELEASE="$REMOTE_ROOT/releases/$TS"

  if [[ $HORS_LIGNE == 1 ]]; then
    etape "Simulation locale (serveur non contacté)"
    plan "rsync -az --delete dist/ $CIBLE:$RELEASE/"
    plan "ln -sfn releases/$TS → $REMOTE_ROOT/current (bascule atomique)"
    plan "nginx -t && systemctl reload nginx"
    plan "healthcheck https://$DOMAIN/ (+ /404.html, /sitemap.xml, /robots.txt) ; rollback automatique si échec"
    plan "conserver les $KEEP_RELEASES dernières releases"
    ok "Simulation terminée : rien n'a été modifié."
    return 0
  fi

  ssh_run "test -d $(printf '%q' "$REMOTE_ROOT/releases") && test -w $(printf '%q' "$REMOTE_ROOT/releases")" \
    || die "$REMOTE_ROOT/releases absent ou non accessible en écriture pour $SSH_USER." "./deploy.sh init"
  PRECEDENTE="$(release_active)"
  info "Release active : ${PRECEDENTE:-aucune}"

  # shellcheck disable=SC2054 # (virgules de --chmod, pas un séparateur)
  local rsync_opts=(-az --delete --chmod=D755,F644 -e "ssh $(printf '%q ' "${SSH_OPTS[@]}")")
  [[ -n "$PRECEDENTE" ]] && rsync_opts+=(--link-dest="$REMOTE_ROOT/releases/$PRECEDENTE/")

  if [[ $DRY_RUN == 1 ]]; then
    etape "Fichiers qui changeraient par rapport à la release active"
    rsync -azn --delete --itemize-changes -e "ssh $(printf '%q ' "${SSH_OPTS[@]}")" dist/ "$CIBLE:$REMOTE_ROOT/current/" | sed 's/^/    /' | head -n 60 || true
    plan "rsync vers $RELEASE/ puis bascule atomique de current"
    plan "nginx -t && systemctl reload nginx, healthcheck, rollback automatique si échec"
    plan "purge au-delà de $KEEP_RELEASES releases"
    ok "Simulation terminée : rien n'a été modifié."
    return 0
  fi

  etape "Envoi vers $RELEASE"
  rsync "${rsync_opts[@]}" dist/ "$CIBLE:$RELEASE/"
  ssh_run "printf '%s\n' $(printf '%q' "$TS") > $(printf '%q' "$RELEASE/release.txt") && chmod 644 $(printf '%q' "$RELEASE/release.txt")"
  ok "Fichiers envoyés (release $TS, jamais dans la release active)"

  etape "Bascule atomique"
  basculer "$TS"
  ok "current → releases/$TS"

  annuler() {
    warn "$1 : retour automatique à la release ${PRECEDENTE:-précédente}."
    if [[ -n "$PRECEDENTE" ]]; then
      basculer "$PRECEDENTE"
      recharger_nginx || true
      ssh_run "rm -rf -- $(printf '%q' "$RELEASE")"
      die "Déploiement annulé : la release $PRECEDENTE est de nouveau en ligne." "corrigez le problème, testez avec npm run preview, puis relancez ./deploy.sh deploy" 2
    fi
    die "Déploiement en échec et aucune release précédente disponible." "./deploy.sh status" 2
  }

  etape "Rechargement de Nginx"
  recharger_nginx || annuler "nginx -t ou le rechargement a échoué"
  ok "Nginx rechargé"

  etape "Healthcheck https://$DOMAIN"
  healthcheck "$TS" || annuler "Healthcheck en échec"

  etape "Purge des anciennes releases (conservées : $KEEP_RELEASES)"
  local a_supprimer r
  # Toutes sauf les (KEEP_RELEASES - 1) plus récentes, la nouvelle release étant exclue (awk : compatible macOS).
  a_supprimer="$(lister_releases | grep -vxF "$TS" | awk -v k="$((KEEP_RELEASES - 1))" '{l[NR]=$0} END {for (i = 1; i <= NR - k; i++) print l[i]}' || true)"
  for r in $a_supprimer; do
    [[ "$r" =~ ^[0-9]{8}-[0-9]{6}(-init)?$ ]] || continue
    ssh_run "rm -rf -- $(printf '%q' "$REMOTE_ROOT/releases/$r")" && info "supprimée : $r"
  done
  ok "$(lister_releases | wc -l | tr -d ' ') release(s) sur le serveur"

  titre "En ligne : https://$DOMAIN  (release $TS)"
}

# --------------------------------------------------------------------------
# rollback
# --------------------------------------------------------------------------
cmd_rollback() {
  requiert ssh curl
  charger_config
  titre "Rollback de $DOMAIN"
  verifier_ssh
  local active releases cible
  active="$(release_active)"
  releases="$(lister_releases)"
  [[ -n "$active" ]] || die "Aucune release active." "./deploy.sh deploy"
  if [[ -n "$CIBLE_ROLLBACK" ]]; then
    grep -qxF "$CIBLE_ROLLBACK" <<<"$releases" || die "Release inconnue : $CIBLE_ROLLBACK" "./deploy.sh status  pour lister les releases"
    cible="$CIBLE_ROLLBACK"
  else
    cible="$(grep -B1 -xF "$active" <<<"$releases" | head -n1)"
    [[ -n "$cible" && "$cible" != "$active" ]] || die "Pas de release antérieure à $active." "./deploy.sh status"
  fi
  etape "Bascule : $active → $cible"
  basculer "$cible"
  recharger_nginx || die "Rechargement de Nginx impossible." "ssh -p $SSH_PORT $CIBLE 'sudo nginx -t'"
  ok "current → releases/$cible"
  if ssh_run "test -f $(printf '%q' "$REMOTE_ROOT/releases/$cible/release.txt")"; then
    healthcheck "$cible" || warn "Healthcheck en échec après rollback : vérifiez le site."
  fi
  titre "Rollback effectué (release active : $cible)"
}

# --------------------------------------------------------------------------
# status
# --------------------------------------------------------------------------
cmd_status() {
  requiert ssh curl openssl
  charger_config
  titre "État de $DOMAIN"
  verifier_ssh
  local active r fin jours code
  active="$(release_active)"
  etape "Releases ($REMOTE_ROOT/releases)"
  for r in $(lister_releases); do
    if [[ "$r" == "$active" ]]; then printf '%s\n' "  ${G}● $r  (active)${N}"; else printf '%s\n' "    $r"; fi
  done
  [[ -n "$active" ]] || warn "Aucune release active."
  etape "Nginx"
  if ssh_run "systemctl is-active --quiet nginx"; then ok "nginx : actif"; else warn "nginx : inactif"; fi
  etape "Site"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || true)"
  [[ "$code" == 200 ]] && ok "https://$DOMAIN/ → $code" || warn "https://$DOMAIN/ → ${code:-injoignable}"
  etape "Certificat TLS"
  fin="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
  if [[ -n "$fin" ]]; then
    jours="$(node -e 'console.log(Math.floor((new Date(process.argv[1]) - Date.now()) / 864e5))' "$fin")"
    if ((jours < 15)); then warn "Expire le $fin (dans $jours jours) — vérifiez certbot.timer"; else ok "Expire le $fin (dans $jours jours)"; fi
  else
    warn "Certificat illisible (HTTPS non configuré ?)  → ./deploy.sh init"
  fi
}

case "$COMMANDE" in
  init) cmd_init ;;
  deploy) cmd_deploy ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  *) printf '%s\n' "Commande inconnue : $COMMANDE" >&2; usage 1 ;;
esac
