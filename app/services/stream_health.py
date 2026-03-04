import requests

GO2RTC_URL = "http://localhost:1984/api/streams"

def get_stream_health():

    try:
        r = requests.get(GO2RTC_URL, timeout=1)
        data = r.json()

        streams = {}

        for name, info in data.items():
            streams[name] = info.get("producers") != []

        return streams

    except Exception:
        return {}