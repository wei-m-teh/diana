"""Permission-resolved location snapshot from the authenticated session API."""

import math
from datetime import datetime, timezone


class LocationContext:
    def __init__(self, value, *, now=None):
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._value = {"source": "unavailable"}
        if not isinstance(value, dict):
            return
        source = value.get("source")
        city = value.get("city")
        city = city if isinstance(city, str) and 0 < len(city) <= 200 else None
        if source == "manual" and city:
            self._value = {"source": source, "city": city}
        elif source in {"device", "last_known"}:
            try:
                lat, lon, accuracy = (
                    value[key] for key in ("latitude", "longitude", "accuracyMeters")
                )
                if any(
                    isinstance(v, bool)
                    or not isinstance(v, (int, float))
                    or not math.isfinite(v)
                    for v in (lat, lon, accuracy)
                ):
                    return
                if abs(lat) > 90 or abs(lon) > 180 or not 0 <= accuracy <= 100000:
                    return
                captured = datetime.fromisoformat(
                    value["capturedAt"].replace("Z", "+00:00")
                )
                if (
                    captured.tzinfo is None
                    or (captured - self._now()).total_seconds() > 60
                ):
                    return
                self._value = {
                    "source": source,
                    "city": city,
                    "latitude": round(lat, 2),
                    "longitude": round(lon, 2),
                    "accuracy_meters": max(1000, accuracy),
                    "captured_at": captured.isoformat(),
                }
            except (KeyError, ValueError, TypeError, AttributeError):
                pass

    def current(self):
        result = dict(self._value)
        if "captured_at" in result:
            result["age_seconds"] = max(
                0,
                int(
                    (
                        self._now() - datetime.fromisoformat(result["captured_at"])
                    ).total_seconds()
                ),
            )
        return result
