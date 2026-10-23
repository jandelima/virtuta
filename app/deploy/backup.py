#!/usr/bin/python3
"""Backup consistente do SQLite em WAL, com retenção local de 14 dias."""
from datetime import datetime, timezone
from pathlib import Path
import os
import sqlite3
import time

os.umask(0o077)
folder = Path('/var/backups/virtuta')
folder.mkdir(mode=0o700, parents=True, exist_ok=True)
target = folder / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.db')
with sqlite3.connect('file:/var/lib/virtuta/virtuta.db?mode=ro', uri=True) as source:
    with sqlite3.connect(target) as dest:
        source.backup(dest)
        assert dest.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
for old in folder.glob('*.db'):
    if old.stat().st_mtime < time.time() - 14 * 86400:
        old.unlink()
print('Backup validado:', target)
