from config.database import build_database_config
from config.settings import BASE_DIR
from config.settings import *  # noqa: F401,F403

DATABASES = build_database_config(BASE_DIR)
