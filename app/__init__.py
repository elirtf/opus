import os
from datetime import timedelta

from flask import Flask
from flask_login import LoginManager
from flask_session import Session
from werkzeug.middleware.proxy_fix import ProxyFix

login_manager = LoginManager()
server_session = Session()


def _require_secret_key() -> str:
    """
    SECRET_KEY MUST be provided via env. No on-disk fallback, no random generation:
    an unstable secret silently invalidates every issued session cookie and was the
    root cause of the 'must restart nginx to log in' bug (see plan).
    """
    sk = (os.environ.get("SECRET_KEY") or "").strip()
    if not sk:
        raise RuntimeError(
            "SECRET_KEY env var is required. Set it in .env (or docker-compose) "
            "to a long random string and keep it stable across restarts."
        )
    return sk


def _session_lifetime_seconds() -> int:
    try:
        v = int((os.environ.get("OPUS_SESSION_LENGTH") or "86400").strip())
    except ValueError:
        v = 86400
    # Clamp: 5 minutes .. 30 days
    return max(300, min(v, 86400 * 30))


def create_app():
    app = Flask(__name__)
    app.config["DATABASE_PATH"]     = os.environ.get("DATABASE_PATH", "/app/instance/opus.db")
    app.config["DATABASE_URL"]      = os.environ.get("DATABASE_URL")
    app.config["SECRET_KEY"]        = _require_secret_key()
    app.config["GO2RTC_URL"]        = os.environ.get("GO2RTC_URL", "http://go2rtc:1984")
    app.config["GO2RTC_CONFIG_PATH"] = os.environ.get("GO2RTC_CONFIG_PATH", "/config/go2rtc.yaml")
    app.config["RECORDINGS_DIR"]    = os.environ.get("RECORDINGS_DIR", "/recordings")

    # ── Reverse proxy awareness ──────────────────────────────────────────────
    # nginx terminates the client TCP conn; X-Forwarded-Proto tells Flask whether
    # the original request was HTTPS so SESSION_COOKIE_SECURE can behave correctly.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=0)

    # ── Server-side sessions (Flask-Session, filesystem backend) ─────────────
    # Stored in the same volume as SQLite so container restarts do NOT invalidate
    # live sessions. Cookie value is an opaque session id signed by SECRET_KEY.
    instance_dir = os.path.dirname(app.config["DATABASE_PATH"]) or "/app/instance"
    session_dir = os.path.join(instance_dir, "sessions")
    try:
        os.makedirs(session_dir, exist_ok=True)
    except OSError:
        # If this fails at boot, Flask-Session will also fail — surface it then.
        pass

    app.config.update(
        SESSION_TYPE="filesystem",
        SESSION_FILE_DIR=session_dir,
        SESSION_PERMANENT=True,
        PERMANENT_SESSION_LIFETIME=timedelta(seconds=_session_lifetime_seconds()),
        SESSION_USE_SIGNER=True,
        SESSION_COOKIE_NAME="opus_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure flag is decided per-request by Flask based on request.is_secure
        # (populated via ProxyFix + X-Forwarded-Proto from nginx).
        SESSION_COOKIE_SECURE=False,
    )
    server_session.init_app(app)

    # ── Database - Peewee init ───────────────────────────────────────────────
    from app.database import db, init_database

    # For SQLite, ensure the on-disk path exists. For DATABASE_URL (Postgres),
    # DATABASE_PATH is ignored by init_database().
    if not app.config["DATABASE_URL"]:
        os.makedirs(os.path.dirname(app.config["DATABASE_PATH"]), exist_ok=True)

    init_database(
        database_path=app.config["DATABASE_PATH"],
        database_url=app.config["DATABASE_URL"],
    )
    db.connect(reuse_if_open=True)

    # Run pending migrations before serving any requests.
    # Replaces db.create_tables() — migrations own the schema from here on.
    # NOTE: Current migration runner is SQLite-only. When DATABASE_URL is set
    # (e.g. Postgres), migrations must be applied separately using a dedicated
    # tool or future migration system.
    if not app.config["DATABASE_URL"]:
        from app.migrate import run_migrations
        run_migrations(app.config["DATABASE_PATH"])

    # Per-request connection management
    @app.before_request
    def open_db():
        if db.is_closed():
            db.connect(reuse_if_open=True)

    @app.teardown_request
    def close_db(exc):
        if not db.is_closed():
            db.close()

    # ── Auth - Flask-Login identity from Flask-Session cookie ────────────────
    login_manager.init_app(app)
    login_manager.login_view = None

    _cors_origins = os.environ.get("CORS_ORIGINS", "").strip()
    if _cors_origins:
        from flask_cors import CORS

        CORS(
            app,
            origins=[o.strip() for o in _cors_origins.split(",") if o.strip()],
            supports_credentials=True,
            allow_headers=["Content-Type"],
        )

    from app.models import User

    @login_manager.user_loader
    def load_user(user_id):
        try:
            return User.get_by_id(int(user_id))
        except (User.DoesNotExist, TypeError, ValueError):
            return None

    # ── Blueprints (API) ─────────────────────────────────────────────────────
    from app.routes.api.auth import bp as api_auth_bp, init_auth
    from app.routes.api.nvrs    import bp as api_nvrs_bp
    from app.routes.api.cameras import bp as api_cameras_bp
    from app.routes.api.users   import bp as api_users_bp
    from app.routes.api.health  import bp as api_health_bp
    from app.routes.api.recordings import bp as api_recordings_bp
    from app.routes.api.discovery   import bp as api_discovery_bp
    from app.routes.api.recording_settings import bp as api_rec_settings_bp
    from app.routes.api.go2rtc_settings import bp as api_go2rtc_settings_bp
    from app.routes.api.events import bp as api_events_bp
    from app.routes.api.processing_api import bp as api_processing_bp
    from app.routes.api.config_schema import bp as api_config_schema_bp
    from app.routes.api.playback import bp as api_playback_bp

    app.register_blueprint(api_auth_bp)
    app.register_blueprint(api_nvrs_bp)
    app.register_blueprint(api_cameras_bp)
    app.register_blueprint(api_users_bp)
    app.register_blueprint(api_health_bp)
    app.register_blueprint(api_recordings_bp)
    app.register_blueprint(api_discovery_bp)
    app.register_blueprint(api_rec_settings_bp)
    app.register_blueprint(api_go2rtc_settings_bp)
    app.register_blueprint(api_events_bp)
    app.register_blueprint(api_processing_bp)
    app.register_blueprint(api_config_schema_bp)
    app.register_blueprint(api_playback_bp)

    init_auth(app)

    from app.lifecycle import start_background_services

    start_background_services(app)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}, 200

    # ── SPA catch-all ────────────────────────────────────────────────────────
    register_spa_catchall(app)

    return app

def register_spa_catchall(app):
    import os
    from flask import send_from_directory

    static_dir = os.path.join(app.root_path, 'static')

    @app.route('/assets/<path:filename>')
    def assets(filename):
        return send_from_directory(
            os.path.join(static_dir, 'assets'),
            filename,
            mimetype='text/css'      if filename.endswith('.css') else
            'application/javascript' if filename.endswith('.js')  else
            None
        )

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def spa(path):
        return send_from_directory(static_dir, 'index.html')
