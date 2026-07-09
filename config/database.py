from pathlib import Path
from urllib.parse import urlparse

from config.env import env


def build_database_config(base_dir: Path):
    database_url = env('DATABASE_URL', '')

    if not database_url:
        sqlite_path = env('SQLITE_PATH', str(base_dir / 'db.sqlite3'))
        return {
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME': sqlite_path,
            }
        }

    parsed = urlparse(database_url)

    return {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': parsed.path.lstrip('/'),
            'USER': parsed.username or '',
            'PASSWORD': parsed.password or '',
            'HOST': parsed.hostname or '',
            'PORT': parsed.port or 5432,
        }
    }
