# This stores runtime camera status in memory, avoiding constant DB lookups.

import time

class CameraStateCache:

    def __init__(self):
        self.cache = {}
        self.last_update = 0
        self.ttl = 2  # seconds

    def get(self, name):
        return self.cache.get(name)

    def update(self, name, data):
        self.cache[name] = data
        self.last_update = time.time()

    def all(self):
        return self.cache


camera_state = CameraStateCache()