#!/bin/bash

set -e  # stop on error

echo "🚀 Starting Opus setup... ensure you are in the Opus directory"

docker compose down

# Session secret for Flask (required by the app; DEV_KEY was a misnomer)
read -p "Enter SECRET_KEY (or press Enter for 'dev'): " SECRET_KEY
SECRET_KEY=${SECRET_KEY:-dev}

echo "📁 Moving to home directory..."
cd ~ || exit

echo "🧹 Cleaning old install..."
sudo rm -rf ~/opus

read -p "🐳 Prune Docker? (y/n): " PRUNE
if [[ "$PRUNE" == "y" ]]; then
  sudo docker system prune -af
  sudo docker volume prune -af
fi

echo "📦 Cloning repo..."
git clone -b cursor https://github.com/elirtf/opus.git

cd opus || exit

echo "⚙️ Creating .env file..."
cat <<EOL > .env
SECRET_KEY=$SECRET_KEY
EOL

echo "🐳 Building and starting containers..."
sudo docker compose up --build -d

echo "✅ Done."
