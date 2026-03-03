from peewee import (
    Model,
    AutoField,
    CharField,
    BooleanField,
    IntegerField,
    BigIntegerField,
    DateTimeField,
    CompositeKey,
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

    def allowed_nvr_ids(self):
        """
        Returns a set of NVR IDs this user can see.
        Admins get None (meaning no restriction).
        Non-admins get a set — empty means they see nothing.
        """
        if self.is_admin:
            return None
        return {
            row.nvr_id
            for row in UserNVR.select().where(UserNVR.user_id == self.id)
        }

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
    recording_enabled = BooleanField(default=False)

    class Meta:
        table_name = "camera"

class UserNVR(BaseModel):
    id      = AutoField()
    user_id = IntegerField()
    nvr_id  = IntegerField()

    class Meta:
        table_name = "user_nvr"


class Recording(BaseModel):
    """
    Tracks every recorded MP4 segment on disk.

    Each row represents one file, e.g.:
      /recordings/warehouse-ch1-main/2024-01-15_14-00-00.mp4

    The recording engine scans the filesystem and registers completed segments
    here so the API can do fast DB queries instead of directory walks.
    """
    id               = AutoField()
    camera           = IntegerField(null=True, index=True)      # FK to Camera.id
    camera_name      = CharField(max_length=50, index=True)     # denormalized for fast lookups
    filename         = CharField(max_length=255)                 # e.g. "2024-01-15_14-00-00.mp4"
    file_path        = CharField(max_length=512)                 # absolute path
    file_size        = BigIntegerField(default=0)                # bytes
    started_at       = DateTimeField(index=True)                 # parsed from filename
    ended_at         = DateTimeField(null=True)                  # started_at + duration
    duration_seconds = IntegerField(null=True)                   # from ffprobe
    status           = CharField(max_length=20, default="complete")  # complete | failed

    class Meta:
        table_name = "recording"
        indexes = (
            # Composite index for the most common query pattern:
            # "show me recordings for camera X between time A and B"
            (("camera_name", "started_at"), False),
        )
