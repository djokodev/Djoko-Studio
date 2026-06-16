-- Local-only demo data for the DS-037 manual WebRTC test.
-- This file is intentionally idempotent so it can be re-run safely.

BEGIN;

INSERT INTO users (id, email, display_name)
VALUES ('3c9abfe7-3133-4924-b159-f62277dfce7c', 'host@example.com', 'Host User')
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    updated_at = now();

INSERT INTO studios (id, owner_user_id, name, slug, visibility)
VALUES ('2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d', '3c9abfe7-3133-4924-b159-f62277dfce7c', 'Test Studio', 'test-studio', 'private')
ON CONFLICT (id) DO UPDATE
SET owner_user_id = EXCLUDED.owner_user_id,
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    visibility = EXCLUDED.visibility,
    updated_at = now();

COMMIT;
