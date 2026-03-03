FROM node:20-alpine AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build


FROM python:3.12-slim

WORKDIR /app

RUN set -eu; which python || true; echo "$PATH"; ls -la /usr/bin | head

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 curl ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Create recordings directory
RUN mkdir -p /recordings

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Copy built React app into Flask's static folder
COPY --from=frontend /frontend/dist /app/app/static

ENV FLASK_APP=run.py
ENV FLASK_ENV=production

EXPOSE 5000

CMD ["python", "run.py"]