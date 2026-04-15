import os
import secrets
from flask import Flask
from flask_login import LoginManager

login_manager = LoginManager()


def _load_or_create_secret_key(database_path: str) -> str:
    """
    Persist SECRET_KEY next to the SQLite file so containers start without a pre-seeded .env.
    Env SECRET_KEY still wins when set.
    """
    env_sk = (os.environ.get("SECRET_KEY") or "").strip()
    if env_sk:
        return env_sk
    parent = os.path.dirname(database_path) or "."
    path = os.path.join(parent, ".flask_secret_key")
    try:
        os.makedirs(parent, exist_ok=True)
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                existing = f.read().strip()
            if existing:
                return existing
        sk = secrets.token_hex(32)
        with open(path, "w", encoding="utf-8") as f:
            f.write(sk)
        return sk
    except OSError:
        return secrets.token_hex(32)


def create_app():
    app = Flask(__name__)
    app.config["DATABASE_PATH"]     = os.environ.get("DATABASE_PATH", "/app/instance/opus.db")
    app.config["DATABASE_URL"]      = os.environ.get("DATABASE_URL")
    app.config["SECRET_KEY"]        = _load_or_create_secret_key(app.config["DATABASE_PATH"])
    app.config["GO2RTC_URL"]        = os.environ.get("GO2RTC_URL", "http://go2rtc:1984")
    app.config["GO2RTC_CONFIG_PATH"] = os.environ.get("GO2RTC_CONFIG_PATH", "/config/go2rtc.yaml")
    app.config["RECORDINGS_DIR"]    = os.environ.get("RECORDINGS_DIR", "/recordings")

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

    # ── Auth - Flask-Login (identity from JWT cookie / Bearer, optional proxy headers) ──
    login_manager.init_app(app)
    login_manager.login_view = None

    _cors_origins = os.environ.get("CORS_ORIGINS", "").strip()
    if _cors_origins:
        from flask_cors import CORS

        CORS(
            app,
            origins=[o.strip() for o in _cors_origins.split(",") if o.strip()],
            supports_credentials=True,
            allow_headers=["Content-Type", "Authorization"],
        )

    from app.models import User

    @login_manager.user_loader
    def load_user(user_id):
        try:
            return User.get_by_id(int(user_id))
        except User.DoesNotExist:
            return None

    @login_manager.request_loader
    def load_user_from_request(req):
        from app.opus_auth import load_user_for_request

        return load_user_for_request(app, req)

    @app.after_request
    def _opus_jwt_cookie_refresh(resp):
        from app.opus_auth import apply_jwt_rotation

        return apply_jwt_rotation(resp)

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

    from app.ops_alerts import start_ops_alerts_thread

    start_ops_alerts_thread(app)

    with app.app_context():
        from app.go2rtc_config import write_go2rtc_yaml
        from app.go2rtc import sync_all_on_startup

        write_go2rtc_yaml(app)
        try:
            sync_all_on_startup()
        except Exception:
            # Defensive — sync_all_on_startup already catches internally.
            pass

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