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

# Examples:
# make access ACCESS_ARGS='--email user@example.com --days 30 --note "WhatsApp order"'
# make access ACCESS_ARGS='--email user@example.com --lifetime'
# make access ACCESS_ARGS='--email user@example.com --revoke'
access:
	go run ./cmd/access $(ACCESS_ARGS)

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

migrate-reset:
	@set -a; \
	if [ -f "$(ENV_FILE)" ]; then . "./$(ENV_FILE)"; fi; \
	db_url="$${DATABASE_URL:-$(GOOSE_DBSTRING)}"; \
	if [ -z "$$db_url" ]; then \
		echo "DATABASE_URL is required. Set it in your environment or $(ENV_FILE)."; \
		exit 1; \
	fi; \
	goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$$db_url" reset

migrate-status:
	@set -a; \
	if [ -f "$(ENV_FILE)" ]; then . "./$(ENV_FILE)"; fi; \
	db_url="$${DATABASE_URL:-$(GOOSE_DBSTRING)}"; \
	if [ -z "$$db_url" ]; then \
		echo "DATABASE_URL is required. Set it in your environment or $(ENV_FILE)."; \
		exit 1; \
	fi; \
	goose -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) "$$db_url" status
