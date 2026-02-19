import os
from flask import Flask
from flask_login import LoginManager
from app.database import db
from app.models import User, NVR, Camera

login_manager = LoginManager()


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"]   = os.environ.get("SECRET_KEY", "change-me-in-production")
    app.config["DATABASE_PATH"] = os.environ.get("DATABASE_PATH", "/app/instance/opus.db")
    app.config["GO2RTC_URL"]   = os.environ.get("GO2RTC_URL", "http://go2rtc:1984")

    # ── Peewee database init ─────────────────────────────────────────────────
    os.makedirs(os.path.dirname(app.config["DATABASE_PATH"]), exist_ok=True)
    db.init(app.config["DATABASE_PATH"])
    db.start()          # starts the background writer thread
    db.connect(reuse_if_open=True)

    # Run pending migrations before serving any requests.
    # Replaces db.create_tables() — migrations own the schema from here on.
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

    # ── Flask-Login ──────────────────────────────────────────────────────────
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"

    @login_manager.user_loader
    def load_user(user_id):
        try:
            return User.get_by_id(int(user_id))
        except User.DoesNotExist:
            return None

    # ── Blueprints (Jinja) ───────────────────────────────────────────────────
    from app.routes.auth    import bp as auth_bp
    from app.routes.main    import bp as main_bp
    from app.routes.nvrs    import bp as nvrs_bp
    from app.routes.cameras import bp as cameras_bp
    from app.routes.users   import bp as users_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(nvrs_bp)
    app.register_blueprint(cameras_bp)
    app.register_blueprint(users_bp)

    # ── Blueprints (API) ─────────────────────────────────────────────────────
    from app.routes.api.auth    import bp as api_auth_bp
    from app.routes.api.nvrs    import bp as api_nvrs_bp
    from app.routes.api.cameras import bp as api_cameras_bp
    from app.routes.api.users   import bp as api_users_bp

    app.register_blueprint(api_auth_bp)
    app.register_blueprint(api_nvrs_bp)
    app.register_blueprint(api_cameras_bp)
    app.register_blueprint(api_users_bp)

    # ── Seed default admin if no users exist ─────────────────────────────────
    if User.select().count() == 0:
        admin = User(username="admin", role="admin")
        admin.set_password("admin")
        admin.save(force_insert=True)
        print("Default admin created — username: admin / password: admin")

    return app