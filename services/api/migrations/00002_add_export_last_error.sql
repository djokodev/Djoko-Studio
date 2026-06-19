-- +goose Up
ALTER TABLE exports
ADD COLUMN last_error text;

-- +goose Down
ALTER TABLE exports
DROP COLUMN last_error;
