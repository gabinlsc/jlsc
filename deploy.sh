#!/usr/bin/env bash
# ==========================================================================
#  DÉPLOIEMENT — site de Jacques Lescoat (https://jlescoat.glsc.fr)
#  Script autonome, exécuté directement SUR LE SERVEUR, en root.
#
#  Installer / mettre à jour le site (première fois comme les suivantes) :
#    curl -fsSL https://raw.githubusercontent.com/gabinlsc/jlsc/main/deploy.sh | sudo bash
#
#  Autres commandes (après « bash -s -- ») :
#    curl -fsSL …/deploy.sh | sudo bash -s -- rollback     retour à la version précédente
#    curl -fsSL …/deploy.sh | sudo bash -s -- status       état du site
#    curl -fsSL …/deploy.sh | sudo bash -s -- --dry-run    simulation, rien n'est modifié
#  Une fois installé, le script est aussi disponible localement :
#    sudo bash /opt/jlescoat/src/deploy.sh [rollback|status|--dry-run]
#
#  Réglages facultatifs (variables d'environnement, après « sudo ») :
#    EMAIL=moi@exemple.fr     adresse Let's Encrypt (avis d'expiration ; conseillé)
#    BRANCH=main              branche du dépôt à publier
#    GITHUB_TOKEN=…           jeton GitHub en lecture, si le dépôt est privé
#    DOMAIN, REPO, WEB_ROOT, KEEP_RELEASES (voir valeurs par défaut ci-dessous)
#  Exemple : curl -fsSL …/deploy.sh | sudo EMAIL=moi@exemple.fr bash
#
#  Ce que fait le script (idempotent, rejouable sans casse) :
#   1. vérifie que DOMAIN pointe vers ce serveur (enregistrement DNS A) ;
#   2. installe si absents nginx, certbot, python3-certbot-nginx, rsync, git
#      (et Node.js dans /opt/jlescoat/node, sans toucher au Node du système) ;
#   3. récupère le code, construit le site (npm ci && npm run build) ;
#   4. copie le build dans releases/<date>, bascule atomique du lien « current » ;
#   5. installe le vhost Nginx de CE domaine (sauvegarde, nginx -t, restauration
#      si échec) — aucun autre site n'est modifié ;
#   6. obtient le certificat HTTPS si besoin, vérifie le renouvellement auto ;
#   7. healthcheck HTTPS ; en cas d'échec, retour automatique à la version précédente.
# ==========================================================================

# Tout le script est dans main() : bash le lit en entier avant de l'exécuter
# (indispensable avec « curl | bash »).
main() {
set -Eeuo pipefail
shopt -u patsub_replacement 2>/dev/null || true
exec </dev/null   # aucune commande ne doit lire le script sur l'entrée standard

# --------------------------------------------------------------------------
# Réglages
# --------------------------------------------------------------------------
DOMAIN="${DOMAIN:-jlescoat.glsc.fr}"
REPO="${REPO:-https://github.com/gabinlsc/jlsc.git}"
BRANCH="${BRANCH:-main}"
EMAIL="${EMAIL:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
BASE="${BASE:-/opt/jlescoat}"
WEB_ROOT="${WEB_ROOT:-/var/www/$DOMAIN}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
NODE_MAJOR=22

SRC="$BASE/src"
NODE_DIR="$BASE/node"
SITE_AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
SITE_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"
BACKUP_DIR="/etc/nginx/backup"
HORODATAGE="$(date -u +%Y%m%d-%H%M%S)"

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
trap 'printf "%s\n" "${R}✘ Erreur inattendue ligne $LINENO : $BASH_COMMAND${N}" >&2' ERR

# --------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------
COMMANDE="deploy"
DRY_RUN=0
for a in "$@"; do
  case "$a" in
    deploy|rollback|status) COMMANDE="$a" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help|help) sed -n '2,34p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | sed 's/^#  \{0,1\}//' || true
       printf '%s\n' "Usage : curl -fsSL …/deploy.sh | sudo bash -s -- [deploy|rollback|status] [--dry-run]"; exit 0 ;;
    *) die "Argument inconnu : $a" "curl -fsSL …/deploy.sh | sudo bash -s -- [deploy|rollback|status] [--dry-run]" ;;
  esac
done

# Exécute une commande, ou l'affiche seulement en mode --dry-run.
run() { if [[ $DRY_RUN == 1 ]]; then printf '%s\n' "  ${Y}[dry-run]${N} $*"; else "$@"; fi; }

# --------------------------------------------------------------------------
# Vérifications de base
# --------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Ce script doit être lancé en root." "curl -fsSL …/deploy.sh | sudo bash   (sudo devant bash, pas devant curl)"
command -v apt-get >/dev/null || die "Serveur non Debian/Ubuntu (apt-get absent) : non pris en charge."
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "DOMAIN invalide : « $DOMAIN »"
[[ "$WEB_ROOT" =~ ^/[A-Za-z0-9._/-]+$ && "$(tr -cd '/' <<<"$WEB_ROOT" | wc -c)" -ge 2 ]] || die "WEB_ROOT invalide : « $WEB_ROOT »" "WEB_ROOT=/var/www/$DOMAIN"
[[ "$KEEP_RELEASES" =~ ^[0-9]+$ && "$KEEP_RELEASES" -ge 2 ]] || die "KEEP_RELEASES doit être un nombre ≥ 2."
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "BRANCH invalide : « $BRANCH »"

release_active() { readlink "$WEB_ROOT/current" 2>/dev/null | xargs -r basename || true; }
lister_releases() {
  local d
  for d in "$WEB_ROOT"/releases/*/; do
    d="$(basename "$d")"
    if [[ "$d" =~ ^[0-9]{8}-[0-9]{6}(-init)?$ ]]; then printf '%s\n' "$d"; fi
  done | sort
}

# Bascule atomique : lien temporaire puis renommage (mv -T = rename(2), atomique).
basculer() {
  ln -sfn "releases/$1" "$WEB_ROOT/.current.tmp"
  mv -Tf "$WEB_ROOT/.current.tmp" "$WEB_ROOT/current"
}
recharger_nginx() { nginx -t -q && systemctl reload nginx; }

# --------------------------------------------------------------------------
# Healthcheck HTTPS (interrogé en local : pas de dépendance au routage externe)
# --------------------------------------------------------------------------
hc() { curl -sS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" --resolve "$DOMAIN:80:127.0.0.1" "$@"; }
healthcheck() { # $1 = release attendue
  local base="https://$DOMAIN" essai code page
  for essai in 1 2 3; do
    [[ "$(hc -f "$base/release.txt" 2>/dev/null | tr -d '[:space:]')" == "$1" ]] && break
    [[ $essai == 3 ]] && { warn "$base/release.txt ne renvoie pas « $1 »"; return 1; }
    sleep 2
  done
  ok "Release $1 servie"
  page="$(hc -f "$base/" 2>/dev/null)" || { warn "$base/ ne répond pas en 200"; return 1; }
  grep -q "Jacques Lescoat" <<<"$page" || { warn "$base/ ne contient pas « Jacques Lescoat »"; return 1; }
  ok "GET / → 200, contenu attendu présent"
  code="$(hc -o /dev/null -w '%{http_code}' "$base/404.html")"
  [[ "$code" == 404 ]] || { warn "/404.html renvoie $code au lieu de 404"; return 1; }
  ok "GET /404.html → 404"
  for chemin in /sitemap.xml /robots.txt; do
    code="$(hc -o /dev/null -w '%{http_code}' "$base$chemin")"
    [[ "$code" == 200 ]] || { warn "$chemin renvoie $code au lieu de 200"; return 1; }
    ok "GET $chemin → 200"
  done
  code="$(hc -o /dev/null -w '%{http_code}' "http://$DOMAIN/")"
  if [[ "$code" == 301 ]]; then ok "HTTP → HTTPS : 301"; else warn "Redirection HTTP → HTTPS : $code (attendu 301)"; fi
}

# ==========================================================================
# status
# ==========================================================================
cmd_status() {
  titre "État de $DOMAIN"
  local active r fin
  active="$(release_active)"
  etape "Releases ($WEB_ROOT/releases)"
  for r in $(lister_releases); do
    if [[ "$r" == "$active" ]]; then printf '%s\n' "  ${G}● $r  (active)${N}"; else printf '%s\n' "    $r"; fi
  done
  [[ -n "$active" ]] || warn "Aucune release active."
  [[ -d "$SRC/.git" ]] && info "Code : $(git -C "$SRC" log -1 --format='%h %s (%cr)' 2>/dev/null || true)"
  etape "Nginx"
  if systemctl is-active --quiet nginx; then ok "nginx : actif"; else warn "nginx : inactif"; fi
  if nginx -t -q 2>/dev/null; then ok "nginx -t : configuration valide"; else warn "nginx -t : configuration invalide"; fi
  etape "Site"
  r="$(hc -o /dev/null -w '%{http_code}' "https://$DOMAIN/" 2>/dev/null || true)"
  if [[ "$r" == 200 ]]; then ok "https://$DOMAIN/ → 200"; else warn "https://$DOMAIN/ → ${r:-injoignable}"; fi
  etape "Certificat TLS"
  fin="$(echo | openssl s_client -servername "$DOMAIN" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
  if [[ -n "$fin" ]]; then
    local jours=$(( ($(date -d "$fin" +%s) - $(date +%s)) / 86400 ))
    if ((jours < 15)); then warn "Expire le $fin (dans $jours jours)"; else ok "Expire le $fin (dans $jours jours)"; fi
  else
    warn "Certificat illisible (HTTPS pas encore configuré ?)"
  fi
}

# ==========================================================================
# rollback
# ==========================================================================
cmd_rollback() {
  titre "Retour à la version précédente de $DOMAIN"
  local active cible
  active="$(release_active)"
  [[ -n "$active" ]] || die "Aucune release active."
  cible="$(lister_releases | grep -B1 -xF "$active" | head -n1)"
  [[ -n "$cible" && "$cible" != "$active" ]] || die "Pas de version antérieure à $active."
  etape "Bascule : $active → $cible"
  basculer "$cible"
  recharger_nginx || die "Rechargement de Nginx impossible." "nginx -t"
  ok "current → releases/$cible"
  if [[ -f "$WEB_ROOT/releases/$cible/release.txt" ]]; then healthcheck "$cible" || warn "Healthcheck en échec : vérifiez le site."; fi
  titre "Version active : $cible"
}

# ==========================================================================
# deploy (installation + mise à jour)
# ==========================================================================

verifier_dns() {
  etape "DNS : $DOMAIN doit pointer vers ce serveur"
  local ips_domaine ips_serveur ip trouve=0
  ips_domaine="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  if [[ -z "$ips_domaine" ]]; then
    [[ $DRY_RUN == 1 ]] && { warn "$DOMAIN ne résout pas (bloquant en exécution réelle)."; return 0; }
    die "$DOMAIN ne résout vers aucune adresse IPv4." \
      "chez le gestionnaire DNS de glsc.fr, créez un enregistrement A « ${DOMAIN%%.glsc.fr} » → IP publique de ce serveur, attendez la propagation puis relancez."
  fi
  ips_serveur="$( { hostname -I 2>/dev/null | tr ' ' '\n'; curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null; echo; } | grep -E '^[0-9.]+$' | sort -u || true)"
  info "$DOMAIN → $(tr '\n' ' ' <<<"$ips_domaine")· serveur → $(tr '\n' ' ' <<<"$ips_serveur")"
  for ip in $ips_domaine; do grep -qxF "$ip" <<<"$ips_serveur" && trouve=1; done
  if [[ $trouve == 0 ]]; then
    [[ $DRY_RUN == 1 ]] && { warn "$DOMAIN ne pointe pas vers ce serveur (bloquant en exécution réelle)."; return 0; }
    die "$DOMAIN ne pointe pas vers ce serveur." "corrigez l'enregistrement A « ${DOMAIN%%.glsc.fr} » de la zone glsc.fr pour qu'il vise l'IP de ce serveur, puis relancez."
  fi
  ok "Le domaine pointe bien vers ce serveur"
}

installer_paquets() {
  etape "Paquets requis"
  local p manquants=()
  for p in nginx certbot python3-certbot-nginx rsync git curl ca-certificates xz-utils; do
    if dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed'; then ok "$p"; else manquants+=("$p"); fi
  done
  if ((${#manquants[@]})); then
    warn "À installer : ${manquants[*]}"
    apt_installer() {
      DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-upgrade "$@" >/dev/null
    }
    run apt_installer "${manquants[@]}"
    [[ $DRY_RUN == 1 ]] || ok "Installés : ${manquants[*]}"
  fi
  if [[ $DRY_RUN != 1 ]]; then
    [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]] \
      || die "Arborescence /etc/nginx/sites-{available,enabled} absente : configuration Nginx non standard, abandon."
  fi
  if command -v nginx >/dev/null; then
    if nginx -t -q 2>/dev/null; then ok "Configuration Nginx actuelle valide (nginx -t)"; else
      nginx -t || true
      die "La configuration Nginx actuelle est DÉJÀ invalide (voir ci-dessus). Rien n'a été modifié." "corrigez-la (sudo nginx -t) puis relancez"
    fi
    systemctl is-active --quiet nginx || { warn "Nginx est arrêté : démarrage."; run systemctl enable --now nginx; }
  fi
}

# Node.js dans /opt/jlescoat/node (binaire officiel) : le Node éventuel du système n'est pas touché.
installer_node() {
  etape "Node.js $NODE_MAJOR (pour construire le site)"
  if [[ -x "$NODE_DIR/bin/node" ]] && [[ "$("$NODE_DIR/bin/node" -p 'process.versions.node.split(".")[0]')" == "$NODE_MAJOR" ]]; then
    ok "Node $("$NODE_DIR/bin/node" -v) déjà présent dans $NODE_DIR"
  else
    local arch version
    case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) die "Architecture non prise en charge : $(uname -m)" ;; esac
    version="$(curl -fsS --max-time 20 https://nodejs.org/dist/index.json | grep -o "\"version\":\"v${NODE_MAJOR}\.[0-9.]*\"" | head -n1 | cut -d'"' -f4)" \
      || die "Impossible de joindre nodejs.org." "vérifiez l'accès Internet du serveur"
    [[ -n "$version" ]] || die "Version de Node $NODE_MAJOR introuvable."
    if [[ $DRY_RUN == 1 ]]; then run "télécharger Node $version ($arch) dans $NODE_DIR"; return 0; fi
    local tmp; tmp="$(mktemp -d)"
    curl -fsSL --max-time 300 "https://nodejs.org/dist/$version/node-$version-linux-$arch.tar.xz" -o "$tmp/node.tar.xz"
    curl -fsSL --max-time 30 "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    (cd "$tmp" && grep " node-$version-linux-$arch.tar.xz\$" SHASUMS256.txt | sed "s/node-$version-linux-$arch.tar.xz/node.tar.xz/" | sha256sum -c --quiet) \
      || die "Somme de contrôle de Node invalide : téléchargement corrompu." "relancez le script"
    install -d -m 755 "$NODE_DIR"
    find "$NODE_DIR" -mindepth 1 -delete
    tar -xJf "$tmp/node.tar.xz" -C "$NODE_DIR" --strip-components=1 --no-same-owner
    rm -rf -- "$tmp"
    ok "Node $version installé dans $NODE_DIR"
  fi
  export PATH="$NODE_DIR/bin:$PATH"
}

recuperer_code() {
  etape "Code source ($REPO, branche $BRANCH)"
  local url="$REPO"
  # Dépôt privé : le jeton n'est utilisé que pour cette commande, jamais enregistré sur disque.
  local auth=()
  [[ -n "$GITHUB_TOKEN" ]] && auth=(-c "http.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')")
  if [[ $DRY_RUN == 1 ]]; then
    run "git clone/fetch $url ($BRANCH) dans $SRC"
    if [[ ! -d "$SRC/.git" ]]; then return 0; fi
  elif [[ -d "$SRC/.git" ]]; then
    git -C "$SRC" remote set-url origin "$url"
    git "${auth[@]}" -C "$SRC" fetch -q --depth 1 origin "$BRANCH" \
      || die "Impossible de récupérer la branche $BRANCH." "dépôt privé ? relancez avec GITHUB_TOKEN=… (jeton en lecture seule)"
    git -C "$SRC" checkout -q -B "$BRANCH" FETCH_HEAD
    git -C "$SRC" clean -qfdx -e node_modules -e .cache
  else
    install -d -m 755 "$BASE"
    git "${auth[@]}" clone -q --depth 1 --branch "$BRANCH" "$url" "$SRC" \
      || die "Impossible de cloner $url (branche $BRANCH)." "dépôt privé ? relancez avec GITHUB_TOKEN=… ; branche absente ? BRANCH=…"
  fi
  ok "Version : $(git -C "$SRC" log -1 --format='%h — %s')"
}

construire() {
  etape "Construction du site"
  if [[ $DRY_RUN == 1 ]]; then run "npm ci && npm run build dans $SRC"; return 0; fi
  (cd "$SRC" && npm ci --no-audit --no-fund --loglevel=error >/dev/null && npm run build --silent) \
    || die "La construction du site a échoué (voir ci-dessus)." "corrigez les données (data/*.json) puis relancez"
  [[ -f "$SRC/dist/index.html" ]] || die "dist/index.html absent après le build : abandon."
  ok "Build OK ($(find "$SRC/dist" -type f | wc -l) fichiers)"
}

preparer_arborescence() {
  etape "Arborescence $WEB_ROOT"
  local d
  for d in "$WEB_ROOT" "$WEB_ROOT/releases" "$WEB_ROOT/shared" "$WEB_ROOT/shared/acme"; do
    if [[ -d "$d" ]]; then ok "$d"; else run install -d -m 755 "$d"; fi
  done
  # Release d'attente : le vhost a une racine valide avant le premier build réussi.
  if [[ ! -e "$WEB_ROOT/current" && $DRY_RUN != 1 ]]; then
    local attente="$WEB_ROOT/releases/00000000-000000-init"
    install -d -m 755 "$attente"
    printf '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Jacques Lescoat — site en préparation</title><p>Jacques Lescoat — site en préparation.</p></html>\n' | tee "$attente/index.html" >"$attente/404.html"
    chmod 644 "$attente"/*.html
    basculer "00000000-000000-init"
  fi
}

# Hôtes supplémentaires de la CSP selon site.config.json (formulaires externes, analytics).
calculer_csp() {
  CSP_EXTRA_FORM="" CSP_EXTRA_SCRIPT="" CSP_EXTRA_CONNECT=""
  [[ -f "$SRC/site.config.json" ]] && command -v node >/dev/null || return 0
  local sortie
  sortie="$(cd "$SRC" && node -e '
    const c = require("./site.config.json");
    const origine = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.origin : ""; } catch { return ""; } };
    const f = [c.forms.contactAction, c.forms.notifyAction].map(origine).filter(Boolean);
    const a = c.analytics && c.analytics.enabled ? [origine(c.analytics.src)].filter(Boolean) : [];
    const u = (x) => [...new Set(x)].map((y) => " " + y).join("");
    console.log([u(f) || "-", u(a) || "-", u([...f, ...a]) || "-"].join("\t"));')"
  IFS=$'\t' read -r CSP_EXTRA_FORM CSP_EXTRA_SCRIPT CSP_EXTRA_CONNECT <<<"$sortie"
  [[ "$CSP_EXTRA_FORM" == "-" ]] && CSP_EXTRA_FORM=""
  [[ "$CSP_EXTRA_SCRIPT" == "-" ]] && CSP_EXTRA_SCRIPT=""
  [[ "$CSP_EXTRA_CONNECT" == "-" ]] && CSP_EXTRA_CONNECT=""
  return 0
}

# --- Vhost Nginx ------------------------------------------------------------
render() { # $1 = dossier du certificat
  local t http2_listen http2_directive brotli version
  version="$(nginx -v 2>&1 | sed -n 's|.*nginx/\([0-9.]*\).*|\1|p' || true)"
  if [[ -n "$version" && "$(printf '%s\n%s\n' "1.25.1" "$version" | sort -V | head -n1)" == "1.25.1" ]]; then
    http2_listen=""; http2_directive="http2 on;"
  else
    http2_listen=" http2"; http2_directive="# HTTP/2 activé sur la directive listen (Nginx ${version:-?} < 1.25.1)"
  fi
  if nginx -V 2>&1 | grep -qi brotli || ls /etc/nginx/modules-enabled/*brotli* >/dev/null 2>&1; then
    brotli=$'    brotli on;\n    brotli_comp_level 5;\n    brotli_types text/plain text/css text/xml application/xml application/javascript text/javascript application/json image/svg+xml;'
  else
    brotli="    # Brotli : module non disponible sur ce serveur (gzip seul)."
  fi
  t="$(gabarit_nginx)"
  # shellcheck disable=SC2016 # motifs ${…} littéraux du gabarit
  {
    t="${t//'${DOMAIN}'/$DOMAIN}"
    t="${t//'${WEB_ROOT}'/$WEB_ROOT}"
    t="${t//'${CERT_DIR}'/$1}"
    t="${t//'${HTTP2_LISTEN}'/$http2_listen}"
    t="${t//'${HTTP2_DIRECTIVE}'/$http2_directive}"
    t="${t//'${BROTLI}'/$brotli}"
    t="${t//'${CSP_EXTRA_FORM}'/$CSP_EXTRA_FORM}"
    t="${t//'${CSP_EXTRA_SCRIPT}'/$CSP_EXTRA_SCRIPT}"
    t="${t//'${CSP_EXTRA_CONNECT}'/$CSP_EXTRA_CONNECT}"
  }
  # Serveur sans IPv6 : on retire « listen [::] » (sinon Nginx refuse de démarrer).
  [[ -f /proc/net/if_inet6 ]] || t="$(grep -v 'listen \[::\]' <<<"$t")"
  printf '%s\n' "$t"
}

# Conf HTTP minimale, le temps d'obtenir le premier certificat.
conf_provisoire() {
  local v6=""
  [[ -f /proc/net/if_inet6 ]] && v6="    listen [::]:80;"
  cat <<EOF
# $DOMAIN — configuration temporaire (obtention du certificat), remplacée par deploy.sh.
server {
    listen 80;
$v6
    server_name $DOMAIN;
    server_tokens off;
    root $WEB_ROOT/current;
    index index.html;
    access_log /var/log/nginx/$DOMAIN.access.log;
    error_log  /var/log/nginx/$DOMAIN.error.log warn;
    location ^~ /.well-known/acme-challenge/ { root $WEB_ROOT/shared/acme; default_type text/plain; }
    location / { try_files \$uri \$uri/ =404; }
}
EOF
}

# Installe la conf de CE domaine uniquement : sauvegarde, nginx -t, reload, restauration si échec.
installer_conf() {
  local contenu="$1" sauvegarde="" existait=0 lien=0
  if [[ -f "$SITE_AVAILABLE" && -L "$SITE_ENABLED" ]] && [[ "$(cat "$SITE_AVAILABLE")" == "$contenu" ]]; then
    ok "Vhost $SITE_AVAILABLE inchangé"; return 0
  fi
  if [[ $DRY_RUN == 1 ]]; then
    run "écrire $SITE_AVAILABLE (différences ci-dessous)"
    if [[ -f "$SITE_AVAILABLE" ]]; then diff -u "$SITE_AVAILABLE" <(printf '%s\n' "$contenu") | sed 's/^/      /' || true
      run "sauvegarder l'ancienne version dans $BACKUP_DIR/$DOMAIN.$HORODATAGE"
    else printf '%s\n' "$contenu" | sed 's/^/      /'; fi
    [[ -L "$SITE_ENABLED" ]] || run ln -s "$SITE_AVAILABLE" "$SITE_ENABLED"
    run nginx -t; run systemctl reload nginx
    return 0
  fi
  [[ -L "$SITE_ENABLED" ]] && lien=1
  if [[ -f "$SITE_AVAILABLE" ]]; then
    existait=1
    install -d -m 755 "$BACKUP_DIR"
    sauvegarde="$BACKUP_DIR/$DOMAIN.$HORODATAGE"
    cp -a "$SITE_AVAILABLE" "$sauvegarde"
    info "Ancienne conf sauvegardée : $sauvegarde"
  fi
  printf '%s\n' "$contenu" >"$SITE_AVAILABLE"
  chmod 644 "$SITE_AVAILABLE"
  [[ -L "$SITE_ENABLED" ]] || ln -s "$SITE_AVAILABLE" "$SITE_ENABLED"
  if ! nginx -t 2>"$BASE/nginx-t.log"; then
    cat "$BASE/nginx-t.log" >&2
    if ((existait)); then cp -a "$sauvegarde" "$SITE_AVAILABLE"; else rm -f "$SITE_AVAILABLE"; fi
    ((lien)) || rm -f "$SITE_ENABLED"
    nginx -t -q 2>/dev/null && info "Configuration précédente restaurée, Nginx non rechargé."
    die "nginx -t a échoué avec la nouvelle conf de $DOMAIN : abandon (les autres sites ne sont pas affectés)."
  fi
  systemctl reload nginx
  ok "Vhost $DOMAIN installé, Nginx rechargé"
}

cert_valide() {
  local f="$1/fullchain.pem"
  [[ -f "$f" ]] && openssl x509 -checkend 86400 -noout -in "$f" >/dev/null 2>&1 \
    && openssl x509 -noout -text -in "$f" 2>/dev/null | grep -q "DNS:${DOMAIN}\b"
}
trouver_cert() {
  local d
  for d in "/etc/letsencrypt/live/$DOMAIN" /etc/letsencrypt/live/"$DOMAIN"-[0-9][0-9][0-9][0-9]; do
    if [[ -d "$d" ]] && cert_valide "$d"; then printf '%s' "$d"; return 0; fi
  done
  return 1
}

configurer_nginx_https() {
  etape "Vhost Nginx et certificat HTTPS"
  calculer_csp
  if CERT_DIR="$(trouver_cert)"; then
    ok "Certificat valide : $CERT_DIR (expire le $(openssl x509 -enddate -noout -in "$CERT_DIR/fullchain.pem" | cut -d= -f2))"
    installer_conf "$(render "$CERT_DIR")"
  else
    warn "Aucun certificat valide pour $DOMAIN : demande à Let's Encrypt."
    installer_conf "$(conf_provisoire)"
    local compte=(--register-unsafely-without-email)
    [[ -n "$EMAIL" ]] && compte=(-m "$EMAIL")
    [[ -z "$EMAIL" ]] && warn "Sans EMAIL, vous ne recevrez pas les avis d'expiration (relancez avec EMAIL=… pour en définir un)."
    run certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos "${compte[@]}" --redirect
    if [[ $DRY_RUN == 1 ]]; then run "installer ensuite le vhost complet (HTTPS, HTTP/2, en-têtes de sécurité, CSP)"; else
      CERT_DIR="$(trouver_cert)" || die "Certificat introuvable après certbot." "sudo certbot certificates"
      ok "Certificat obtenu : $CERT_DIR"
      installer_conf "$(render "$CERT_DIR")"
    fi
  fi

  etape "Renouvellement automatique du certificat"
  if systemctl is-active --quiet certbot.timer || systemctl is-active --quiet snap.certbot.renew.timer; then
    ok "Timer de renouvellement actif"
  elif systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
    run systemctl enable --now certbot.timer
  else
    warn "Aucun timer certbot trouvé : vérifiez avec  systemctl list-timers | grep certbot"
  fi
  if [[ $DRY_RUN == 1 || -z "${CERT_DIR:-}" ]]; then
    run certbot renew --dry-run --cert-name "$DOMAIN"
  elif certbot renew --dry-run --cert-name "$(basename "$CERT_DIR")" -q 2>/dev/null; then
    ok "certbot renew --dry-run : OK"
  else
    warn "certbot renew --dry-run a échoué : voir /var/log/letsencrypt/letsencrypt.log"
  fi
}

ouvrir_parefeu() {
  etape "Pare-feu"
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    local port
    for port in 80/tcp 443/tcp; do
      if ufw status | grep -qE "^${port}[[:space:]]+ALLOW"; then ok "UFW autorise $port"; else run ufw allow "$port"; fi
    done
  else
    info "UFW inactif ou absent : aucune règle modifiée."
  fi
}

publier() {
  etape "Mise en ligne (release $HORODATAGE)"
  local precedente release="$WEB_ROOT/releases/$HORODATAGE"
  precedente="$(release_active)"
  if [[ $DRY_RUN == 1 ]]; then
    run "copier dist/ dans $release puis basculer current (actuellement : ${precedente:-aucune})"
    run "nginx -t && systemctl reload nginx, healthcheck, retour automatique si échec"
    run "conserver les $KEEP_RELEASES dernières releases"
    return 0
  fi
  # shellcheck disable=SC2054 # virgules de --chmod, pas un séparateur
  local opts=(-a --delete --chmod=D755,F644)
  [[ -n "$precedente" ]] && opts+=(--link-dest="$WEB_ROOT/releases/$precedente/")
  rsync "${opts[@]}" "$SRC/dist/" "$release/"
  printf '%s\n' "$HORODATAGE" >"$release/release.txt"
  chmod 644 "$release/release.txt"
  basculer "$HORODATAGE"
  ok "current → releases/$HORODATAGE (précédente : ${precedente:-aucune})"

  annuler() {
    warn "$1 : retour automatique à ${precedente:-la version précédente}."
    if [[ -n "$precedente" ]]; then
      basculer "$precedente"; recharger_nginx || true
      rm -rf -- "$release"
      die "Mise en ligne annulée : $precedente est de nouveau en ligne." "corrigez le problème puis relancez le script" 2
    fi
    die "Mise en ligne en échec, aucune version précédente." "sudo nginx -t ; consultez /var/log/nginx/$DOMAIN.error.log" 2
  }
  recharger_nginx || annuler "nginx -t ou le rechargement a échoué"
  ok "Nginx rechargé"

  etape "Healthcheck https://$DOMAIN"
  healthcheck "$HORODATAGE" || annuler "Healthcheck en échec"

  etape "Nettoyage (conservées : $KEEP_RELEASES)"
  local r
  for r in $(lister_releases | grep -vxF "$HORODATAGE" | head -n "-$((KEEP_RELEASES - 1))"); do
    [[ "$r" =~ ^[0-9]{8}-[0-9]{6}(-init)?$ ]] || continue
    rm -rf -- "${WEB_ROOT:?}/releases/$r" && info "supprimée : $r"
  done
  ok "$(lister_releases | wc -l) version(s) conservée(s) — retour arrière : … | sudo bash -s -- rollback"
}

cmd_deploy() {
  titre "Déploiement de $DOMAIN$([[ $DRY_RUN == 1 ]] && echo ' (simulation : rien ne sera modifié)')"
  verifier_dns
  installer_paquets
  installer_node
  recuperer_code
  construire
  preparer_arborescence
  configurer_nginx_https
  ouvrir_parefeu
  publier
  if [[ $DRY_RUN == 1 ]]; then titre "Simulation terminée : rien n'a été modifié"; else titre "En ligne : https://$DOMAIN"; fi
}

case "$COMMANDE" in
  deploy) cmd_deploy ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
esac
}

# ==========================================================================
# Gabarit du vhost Nginx — variables ${…} injectées par render().
# ==========================================================================
gabarit_nginx() {
  cat <<'NGINX_EOF'
# ==========================================================================
#  Vhost Nginx — ${DOMAIN}
#  Généré par deploy.sh : ne pas modifier ici, modifier deploy.sh et relancer.
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
        root ${WEB_ROOT}/shared/acme;
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

    root ${WEB_ROOT}/current;
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

main "$@"
