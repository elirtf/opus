.PHONY: dev up compose-up down rebuild clean-wipe prune logs go2rtc

# Repo / compose directory (override: make up PROJECT_DIR=/path/to/opus)
PROJECT_DIR ?= $(CURDIR)

# Use: make DOCKER="sudo docker" ... if your user is not in the docker group
DOCKER ?= docker
DC = $(DOCKER) compose

# -------------------------
# Helpers
# -------------------------

define ensure_env
	@if [ ! -f $(PROJECT_DIR)/.env ]; then \
		echo "Creating $(PROJECT_DIR)/.env with SECRET_KEY=dev ..."; \
		printf 'SECRET_KEY=dev\n' > $(PROJECT_DIR)/.env; \
	fi
endef

# -------------------------
# Commands
# -------------------------

# Safe default: start the full stack (same as up). No repo wipe.
dev: up

up compose-up:
	@echo "Starting services in $(PROJECT_DIR) ..."
	@$(call ensure_env)
	@cd $(PROJECT_DIR) && $(DC) up --build -d

down:
	@echo "Stopping services..."
	@cd $(PROJECT_DIR) && $(DC) down || true

rebuild:
	@echo "Rebuilding containers..."
	@cd $(PROJECT_DIR) && $(DC) down || true
	@cd $(PROJECT_DIR) && $(DC) up --build -d

logs:
	@cd $(PROJECT_DIR) && $(DC) logs -f

# Split dev: only streaming service (published on host :1984 / :8554 per docker-compose.yml)
go2rtc:
	@$(call ensure_env)
	@cd $(PROJECT_DIR) && $(DC) up go2rtc -d

prune:
	@echo "Pruning Docker..."
	@read -p "This removes unused Docker data. Continue? (y/n): " CONFIRM; \
	if [ "$$CONFIRM" = "y" ]; then \
		$(DOCKER) system prune -af; \
		$(DOCKER) volume prune -af; \
	else \
		echo "Skipped prune."; \
	fi

# Deletes PROJECT_DIR from disk. Refuses if PROJECT_DIR is the current makefile directory.
clean-wipe:
	@if [ "$(PROJECT_DIR)" = "$(CURDIR)" ]; then \
		echo "Refusing: PROJECT_DIR is this repo ($(CURDIR)). Set PROJECT_DIR to a disposable clone path."; \
		exit 1; \
	fi
	@read -p "Delete entire directory $(PROJECT_DIR) ? Type yes: " CONFIRM; \
	if [ "$$CONFIRM" = "yes" ]; then \
		rm -rf $(PROJECT_DIR); \
		echo "Removed."; \
	else \
		echo "Cancelled."; \
	fi
