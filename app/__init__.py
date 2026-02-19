import os
from flask import Flask, g
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
    db.create_tables([User, NVR, Camera], safe=True)  # safe=True = IF NOT EXISTS

    # Open a connection at the start of each request, close it on teardown.
    # Peewee requires this — connections are not thread-safe by default.
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

    # ── Blueprints ───────────────────────────────────────────────────────────
    from app.routes import auth, main, nvrs, cameras, users
    app.register_blueprint(auth.bp)
    app.register_blueprint(main.bp)
    app.register_blueprint(nvrs.bp)
    app.register_blueprint(cameras.bp)
    app.register_blueprint(users.bp)

    # ── Seed default admin if no users exist ─────────────────────────────────
    if User.select().count() == 0:
        admin = User(username="admin", role="admin")
        admin.set_password("admin")
        admin.save(force_insert=True)
        print("Default admin created — username: admin / password: admin")

    return app