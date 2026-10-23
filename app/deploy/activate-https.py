#!/usr/bin/python3
"""Ativa TLS depois do DNS público correto, sem consumir tentativas ACME antes disso."""
import ipaddress
from pathlib import Path
import subprocess
import time

DOMAINS = ('virtuta.site', 'www.virtuta.site', 'lk.virtuta.site')
EXPECTED = {'A': {'168.231.94.205'}, 'AAAA': {'2a02:4780:14:d692::1'}}
STATE = Path('/var/lib/virtuta-tls')
CERT = Path('/etc/letsencrypt/live/virtuta.site/fullchain.pem')
TARGET = Path('/etc/nginx/sites-available/virtuta.site')
TEMPLATE = Path('/etc/virtuta/nginx-https.conf')


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def activate():
    data = TEMPLATE.read_bytes()
    if TARGET.read_bytes() == data:
        return
    old = TARGET.read_bytes()
    try:
        TARGET.write_bytes(data)
        run('/usr/sbin/nginx', '-t')
        run('/bin/systemctl', 'reload', 'nginx')
    except Exception:
        TARGET.write_bytes(old)
        raise
    print('HTTPS ativado para ' + ', '.join(DOMAINS), flush=True)


if CERT.exists():
    activate()
    raise SystemExit(0)

for resolver in ('1.1.1.1', '8.8.8.8'):
    for domain in DOMAINS:
        found = set()
        for kind, allowed in EXPECTED.items():
            response = run('/usr/bin/dig', '@' + resolver, '+time=3', '+tries=1', '+short', domain, kind)
            addresses = set()
            for line in response.splitlines():
                try:
                    addresses.add(str(ipaddress.ip_address(line.strip())))
                except ValueError:
                    pass  # resposta CNAME
            if addresses - allowed:
                print(f'Aguardando DNS: {domain} tem {kind} apontando para outra máquina', flush=True)
                raise SystemExit(0)
            found.update(addresses)
        if not found:
            print(f'Aguardando DNS público: {domain} ({resolver})', flush=True)
            raise SystemExit(0)

STATE.mkdir(mode=0o700, exist_ok=True)
last = STATE / 'last-attempt'
if last.exists() and time.time() - last.stat().st_mtime < 6 * 3600:
    print('Aguardando intervalo de segurança entre tentativas ACME', flush=True)
    raise SystemExit(0)
last.touch()
args = ['/usr/bin/certbot', 'certonly', '--non-interactive', '--agree-tos',
        '--register-unsafely-without-email', '--webroot', '-w', '/var/www/virtuta-acme',
        '--cert-name', 'virtuta.site', '--key-type', 'ecdsa']
for domain in DOMAINS:
    args.extend(['-d', domain])
subprocess.run(args, check=True)
activate()
