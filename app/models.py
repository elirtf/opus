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

import bcrypt
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
    can_view_live = BooleanField(default=True)
    can_view_recordings = BooleanField(default=True)
    # Hashed secret for Authorization: Bearer (optional; legacy automation tokens)
    api_token_hash = CharField(max_length=255, null=True)
    created_at = DateTimeField(null=True)

    class Meta:
        table_name = "user"

    def set_password(self, password: str):
        """PBKDF2-SHA256 (600k). Legacy bcrypt rows remain readable via check_password."""
        self.password_hash = generate_password_hash(
            password, method="pbkdf2:sha256:600000"
        )

    def check_password(self, password: str) -> bool:
        h = self.password_hash or ""
        if h.startswith(("$2a$", "$2b$", "$2y$")):
            try:
                return bcrypt.checkpw(password.encode("utf-8"), h.encode("utf-8"))
            except (ValueError, TypeError):
                return False
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

    def allowed_camera_ids_subset(self):
        """
        If this viewer has rows in user_camera, return that set of camera IDs
        (further intersected with NVR-visible cameras in access helpers).
        None means no extra restriction.
        """
        if self.is_admin:
            return None
        rows = UserCamera.select().where(UserCamera.user_id == self.id)
        ids = {row.camera_id for row in rows}
        return ids if ids else None

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
    # off | continuous | events_only — synced with recording_enabled (off = disabled)
    recording_policy = CharField(max_length=20, default="continuous")
    rtsp_substream_url = CharField(max_length=255, null=True)
    # Stream role model inspired by Frigate-style semantics.
    stream_role = CharField(max_length=10, default="main")  # main | sub
    paired_stream_name = CharField(max_length=50, null=True)
    # True: force H.264 output via go2rtc ffmpeg source (use for HEVC-only cameras).
    # False (default): passthrough RTSP source — avoids per-stream FFmpeg child
    #   processes in go2rtc, which is the root cause of NVR RTSP session
    #   exhaustion on multi-channel installs (see migration 013).
    # None: fall back to GO2RTC_TRANSCODE_DEFAULT at config generation time.
    transcode = BooleanField(default=False, null=True)

    class Meta:
        table_name = "camera"

class UserNVR(BaseModel):
    id      = AutoField()
    user_id = IntegerField()
    nvr_id  = IntegerField()

    class Meta:
        table_name = "user_nvr"


class UserCamera(BaseModel):
    """Optional per-user camera allowlist; intersects with NVR-based access."""

    id        = AutoField()
    user_id   = IntegerField()
    camera_id = IntegerField()

    class Meta:
        table_name = "user_camera"
        indexes = ((("user_id", "camera_id"), True),)


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


class RecordingEvent(BaseModel):
    """
    Motion (or future AI) clip — stored under RECORDINGS_DIR/clips/<camera_name>/.
    """

    id               = AutoField()
    camera           = IntegerField(null=True, index=True)
    camera_name      = CharField(max_length=50, index=True)
    filename         = CharField(max_length=255)
    file_path        = CharField(max_length=512)
    file_size        = BigIntegerField(default=0)
    started_at       = DateTimeField(index=True)
    ended_at         = DateTimeField(null=True)
    duration_seconds = IntegerField(null=True)
    reason           = CharField(max_length=20, default="motion")
    recording_id     = IntegerField(null=True)
    status           = CharField(max_length=20, default="complete")

    class Meta:
        table_name = "recording_event"
        indexes = ((("camera_name", "started_at"), False),)
