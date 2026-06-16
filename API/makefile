GOOSE_DRIVER ?= postgres
GOOSE_DBSTRING ?= $(DATABASE_URL)
GOOSE_MIGRATION_DIR ?= db/migrations
ENV_FILE ?= .env

run:
	go run main.go

tidy:
	go mod tidy

sqlc:
	sqlc generate

migrate-up:
	@set -a; \
	if [ -f "$(ENV_FILE)" ]; then . "./$(ENV_FILE)"; fi; \
	db_url="$${DATABASE_URL:-$(GOOSE_DBSTRING)}"; \
	if [ -z "$$db_url" ]; then \
		echo "DATABASE_URL is required. Set it in your environment or $(ENV_FILE)."; \
		exit 1; \
	fi; \
	goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$$db_url" up

migrate-down:
	@set -a; \
	if [ -f "$(ENV_FILE)" ]; then . "./$(ENV_FILE)"; fi; \
	db_url="$${DATABASE_URL:-$(GOOSE_DBSTRING)}"; \
	if [ -z "$$db_url" ]; then \
		echo "DATABASE_URL is required. Set it in your environment or $(ENV_FILE)."; \
		exit 1; \
	fi; \
	goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$$db_url" down

migrate-status:
	@set -a; \
	if [ -f "$(ENV_FILE)" ]; then . "./$(ENV_FILE)"; fi; \
	db_url="$${DATABASE_URL:-$(GOOSE_DBSTRING)}"; \
	if [ -z "$$db_url" ]; then \
		echo "DATABASE_URL is required. Set it in your environment or $(ENV_FILE)."; \
		exit 1; \
	fi; \
	goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$$db_url" status