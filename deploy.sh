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

  local tpl="$RACINE/deploy/nginx/jlescoat.glsc.fr.conf.tpl"
  [[ -f "$tpl" ]] || die "Gabarit Nginx introuvable : $tpl"

  # Script serveur autonome : variables + gabarit encodé + deploy/remote/init.sh.
  local script
  script="$(
    printf 'DOMAIN=%q\nREMOTE_ROOT=%q\nDEPLOY_USER=%q\nCERTBOT_EMAIL=%q\nDRY_RUN=%q\n' "$DOMAIN" "$REMOTE_ROOT" "${SSH_USER:-deploy}" "$CERTBOT_EMAIL" "$DRY_RUN"
    printf 'CSP_EXTRA_FORM=%q\nCSP_EXTRA_SCRIPT=%q\nCSP_EXTRA_CONNECT=%q\n' "${CSP_EXTRA_FORM:-}" "${CSP_EXTRA_SCRIPT:-}" "${CSP_EXTRA_CONNECT:-}"
    printf 'TEMPLATE_B64=%q\n' "$(base64 <"$tpl" | tr -d '\n')"
    cat "$RACINE/deploy/remote/init.sh"
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
