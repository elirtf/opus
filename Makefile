.PHONY: dev up down rebuild clean prune logs

# Config
PROJECT_DIR := ~/opus
REPO_URL := https://github.com/elirtf/opus.git
BRANCH ?= cursor
DEV_KEY ?=

# -------------------------
# Helpers
# -------------------------

define ensure_env
	@if [ ! -f $(PROJECT_DIR)/.env ]; then \
		echo "⚙️ .env not found."; \
		if [ -z "$(DEV_KEY)" ]; then \
			read -p "Enter DEV KEY: " DEV_KEY_INPUT; \
		else \
			DEV_KEY_INPUT=$(DEV_KEY); \
		fi; \
		echo "Creating .env..."; \
		echo "DEV_KEY=$$DEV_KEY_INPUT" > $(PROJECT_DIR)/.env; \
	fi
endef

define ensure_repo
	@if [ ! -d $(PROJECT_DIR) ]; then \
		echo "📦 Cloning repo..."; \
		git clone -b $(BRANCH) $(REPO_URL) $(PROJECT_DIR); \
	else \
		echo "📂 Repo exists, pulling latest..."; \
		cd $(PROJECT_DIR) && git pull; \
	fi
endef

# -------------------------
# Commands
# -------------------------

dev:
	@echo "🚀 Initial dev setup..."
	@rm -rf $(PROJECT_DIR)
	@$(MAKE) prune
	@$(MAKE) up

up:
	@echo "⬆️ Starting services..."
	@$(call ensure_repo)
	@$(call ensure_env)
	@cd $(PROJECT_DIR) && sudo docker compose up --build -d

down:
	@echo "⬇️ Stopping services..."
	@cd $(PROJECT_DIR) && sudo docker compose down || true

rebuild:
	@echo "🔄 Rebuilding containers..."
	@cd $(PROJECT_DIR) && sudo docker compose down || true
	@cd $(PROJECT_DIR) && sudo docker compose up --build -d

logs:
	@cd $(PROJECT_DIR) && sudo docker compose logs -f

clean:
	@echo "🧹 Removing project directory..."
	@rm -rf $(PROJECT_DIR)

prune:
	@echo "🐳 Pruning Docker..."
	@read -p "⚠️ This removes unused Docker data. Continue? (y/n): " CONFIRM; \
	if [ "$$CONFIRM" = "y" ]; then \
		sudo docker system prune -af; \
		sudo docker volume prune -af; \
	else \
		echo "Skipped prune."; \
	fi
