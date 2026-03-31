# ── Stage 1: Build React frontend ──
FROM node:20.19-alpine AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


# ── Stage 2: Python backend ──
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /recordings

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Baked UI (copied into named volume at runtime — see docker-entrypoint-opus.sh)
COPY --from=frontend /frontend/dist /opt/opus-ui

COPY docker-entrypoint-opus.sh /docker-entrypoint-opus.sh
RUN chmod +x /docker-entrypoint-opus.sh

ENV FLASK_APP=run.py
ENV FLASK_ENV=production

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:5000/healthz || exit 1

ENTRYPOINT ["/docker-entrypoint-opus.sh"]
CMD ["python", "run.py"]
