from app import create_app

app = create_app()

if __name__ == "__main__":
    import os

    host = (os.environ.get("FLASK_RUN_HOST") or "0.0.0.0").strip()
    port = int(os.environ.get("FLASK_RUN_PORT", "5000"))
    app.run(host=host, port=port, threaded=True)
