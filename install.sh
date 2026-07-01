#!/usr/bin/env bash
#
# install.sh — install howcoldismy.beer as a systemd service
# Run with sudo:  sudo ./install.sh
#
set -euo pipefail

# --- config ---
APP_NAME="howcoldismybeer"
APP_USER="howcoldismybeer"
INSTALL_DIR="/opt/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
UNIT_PATH="/etc/systemd/system/${APP_NAME}.service"

# --- sanity checks ---
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run this with sudo" >&2
  exit 1
fi

# Resolve the repo dir (where this script + the binary live)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="${SCRIPT_DIR}/${APP_NAME}"

if [[ ! -x "${BINARY}" ]]; then
  echo "ERROR: compiled binary not found or not executable at ${BINARY}" >&2
  echo "       build it first:  bun build --compile server.ts --outfile ${APP_NAME}" >&2
  exit 1
fi

echo "==> Installing ${APP_NAME}"

# --- create dedicated unprivileged user (idempotent) ---
if id "${APP_USER}" &>/dev/null; then
  echo "   user '${APP_USER}' already exists, reusing"
else
  echo "   creating system user '${APP_USER}'"
  useradd --system --no-create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

# --- install the binary ---
echo "   copying binary to ${INSTALL_DIR}/${APP_NAME}"
install -d -o root -g root -m 0755 "${INSTALL_DIR}"
install -o root -g root -m 0755 "${BINARY}" "${INSTALL_DIR}/${APP_NAME}"

# --- create data dir owned by the service user ---
echo "   creating data dir ${DATA_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "${DATA_DIR}"

# --- generate the systemd unit file ---
echo "   writing unit file to ${UNIT_PATH}"
cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=howcoldismy.beer server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}

ExecStart=${INSTALL_DIR}/${APP_NAME}
WorkingDirectory=${DATA_DIR}
Environment=DATA_FILE=${DATA_DIR}/data.json

# Cap memory at 300MB (soft + hard)
MemoryMax=300M
MemoryHigh=300M

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${DATA_DIR}

# Restart on failure
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "${UNIT_PATH}"

# --- reload + enable + start ---
echo "   reloading systemd daemon"
systemctl daemon-reload

echo "   enabling + starting ${APP_NAME}.service"
systemctl enable --now "${APP_NAME}.service"

echo
echo "==> Done. Status:"
systemctl --no-pager --full status "${APP_NAME}.service" || true
echo
echo "Logs:    journalctl -u ${APP_NAME} -f"
echo "Stop:    sudo systemctl stop ${APP_NAME}"
echo "Restart: sudo systemctl restart ${APP_NAME}"
