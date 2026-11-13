# shellcheck shell=bash
# ==========================================================================
#  Script SERVEUR de mise en place — exécuté en root (sudo) par « ./deploy.sh init ».
#  Ne pas lancer à la main : deploy.sh lui ajoute en tête les variables
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
