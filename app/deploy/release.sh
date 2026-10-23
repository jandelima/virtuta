#!/bin/bash
# Publica o build atual; não altera credenciais, dados ou configurações de outros sites.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/virtuta/node/bin:$PATH"
npm ci --no-fund
npm run build
node --test tests/security.test.mjs
release="/opt/virtuta/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0755 "$release"
cp -a dist package.json package-lock.json "$release/"
cd "$release"
npm ci --omit=dev --no-fund
npm audit --omit=dev
chown -R root:root "$release"
chmod -R go-w "$release"
previous="$(readlink -f /opt/virtuta/current || true)"
if systemctl is-active --quiet virtuta; then /usr/local/sbin/virtuta-backup; fi
ln -sfn "$release" /opt/virtuta/current.new
mv -Tf /opt/virtuta/current.new /opt/virtuta/current
if systemctl restart virtuta; then
    for attempt in {1..30}; do
        if curl -fsS --max-time 2 http://127.0.0.1:8787/api/health; then
            echo "Publicação concluída: $release"
            exit 0
        fi
        sleep 1
    done
fi
if [ -n "$previous" ]; then
    ln -sfn "$previous" /opt/virtuta/current.new
    mv -Tf /opt/virtuta/current.new /opt/virtuta/current
    systemctl restart virtuta
fi
echo 'Falha no health check; versão anterior restaurada quando disponível.' >&2
exit 1
