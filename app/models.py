from peewee import (
    Model,
    AutoField,
    CharField,
    BooleanField,
    IntegerField,
)
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from app.database import db


class BaseModel(Model):
    """All models inherit this so they share the same database connection."""
    class Meta:
        database = db


class User(UserMixin, BaseModel):
    id           = AutoField()
    username     = CharField(max_length=50, unique=True)
    password_hash = CharField(max_length=255)
    role         = CharField(max_length=20, default="viewer")  # "admin" | "viewer"

    class Meta:
        table_name = "user"

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    # Flask-Login requires get_id() to return a string
    def get_id(self) -> str:
        return str(self.id)


class NVR(BaseModel):
    id           = AutoField()
    name         = CharField(max_length=50, unique=True)        # slug, e.g. "warehouse-nvr"
    display_name = CharField(max_length=100)
    ip_address   = CharField(max_length=50, null=True)
    username     = CharField(max_length=100, null=True)
    password     = CharField(max_length=100, null=True)
    max_channels = IntegerField(default=50)
    active       = BooleanField(default=True)

    class Meta:
        table_name = "nvr"


class Camera(BaseModel):
    id           = AutoField()
    name         = CharField(max_length=50, unique=True)        # go2rtc stream key
    display_name = CharField(max_length=100)
    rtsp_url     = CharField(max_length=255)
    nvr          = IntegerField(null=True)                      # FK to NVR.id (manual)
    active       = BooleanField(default=True)

    class Meta:
        table_name = "camera"