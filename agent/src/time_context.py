"""Server-clock context; client timezones are data, never instructions."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def valid_zone(value):
    if not isinstance(value, str) or len(value) > 100:
        return False
    try:
        ZoneInfo(value)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


class TimeContext:
    def __init__(self, metadata, *, now=None):
        config = metadata.get("timezone", {})
        if not isinstance(config, dict):
            config = {}
        self.zone = config.get("name") if valid_zone(config.get("name")) else None
        self.manual = config.get("mode") == "manual"
        self.identity = metadata.get("participantIdentity")
        self._now = now or (lambda: datetime.now(timezone.utc))
        self.started = self._now()

    def update(self, identity, zone):
        if (
            self.manual
            or not self.identity
            or identity != self.identity
            or not valid_zone(zone)
        ):
            return False
        self.zone = zone
        return True

    def current(self, zone=None):
        now = self._now()
        selected = zone if zone is not None else self.zone
        if selected is not None and not valid_zone(selected):
            return {
                "error": "Unknown IANA timezone. Ask for the city or a valid timezone."
            }
        local = now.astimezone(ZoneInfo(selected)) if selected else None
        return {
            "utc_time": now.isoformat(),
            "timezone": selected,
            "local_time": local.isoformat() if local else None,
            "weekday": local.strftime("%A") if local else None,
            "session_started_utc": self.started.isoformat(),
        }
