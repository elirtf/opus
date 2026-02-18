from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_bcrypt import Bcrypt
import os

db = SQLAlchemy()
login_manager = LoginManager()
bcrypt = Bcrypt()


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change-me-in-production")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///opus.db"
    app.config["GO2RTC_URL"] = os.environ.get("GO2RTC_URL", "http://go2rtc:1984")

    db.init_app(app)
    bcrypt.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"

    from app.models import User

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    from app.routes import auth, main, nvrs, cameras

    app.register_blueprint(auth.bp)
    app.register_blueprint(main.bp)
    app.register_blueprint(nvrs.bp)
    app.register_blueprint(cameras.bp)

    with app.app_context():
        db.create_all()
        # Seed a default admin account if none exists
        if not User.query.first():
            admin = User(username="admin", role="admin")
            admin.set_password("admin")
            db.session.add(admin)
            db.session.commit()
            print("Default admin created — username: admin / password: admin")

    return app