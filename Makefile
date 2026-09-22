.PHONY: install dev build start lint type-check migrate seed zip clean

install:
	npm install

dev:
	npx next dev -p 3000

build:
	npx next build

start:
	npx next start -p 3000

lint:
	npx next lint

type-check:
	npx tsc --noEmit

# Apply migrations to the configured Supabase project. Requires psql + SUPABASE_DB_URL.
migrate:
	@for f in supabase/migrations/*.sql; do \
	  echo "▶ $$f"; \
	  psql "$$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f $$f || exit 1; \
	done

seed:
	@echo "▶ applying seed (idempotent)"
	psql "$$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260101000100_seed.sql

zip:
	@rm -f /tmp/educlass-fusion-saas.zip
	@cd .. && zip -r /tmp/educlass-fusion-saas.zip educlass-fusion \
	  -x 'educlass-fusion/node_modules/*' \
	     'educlass-fusion/.next/*' \
	     'educlass-fusion/tsconfig.tsbuildinfo' \
	     '*/.git/*'

clean:
	rm -rf .next .turbo out
