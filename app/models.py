from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from app import db


class User(UserMixin, db.Model):
    __tablename__ = "user"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default="viewer")  # "admin" or "viewer"

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    @property
    def is_admin(self):
        return self.role == "admin"


class NVR(db.Model):
    __tablename__ = "nvr"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)
    display_name = db.Column(db.String(100), nullable=False)
    ip_address = db.Column(db.String(50))
    username = db.Column(db.String(100))
    password = db.Column(db.String(100))
    max_channels = db.Column(db.Integer, default=50)
    active = db.Column(db.Boolean, default=True)

    cameras = db.relationship("Camera", backref="nvr", lazy=True, cascade="all, delete-orphan")


class Camera(db.Model):
    __tablename__ = "camera"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)   # used as go2rtc stream key
    display_name = db.Column(db.String(100), nullable=False)
    rtsp_url = db.Column(db.String(255), nullable=False)           # full RTSP URL
    nvr_id = db.Column(db.Integer, db.ForeignKey("nvr.id"), nullable=True)
    active = db.Column(db.Boolean, default=True)