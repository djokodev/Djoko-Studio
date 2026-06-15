package database

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, databaseURL string) (*DB, error) {
	if databaseURL == "" {
		return &DB{}, nil
	}

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}

	return &DB{pool: pool}, nil
}

func (db *DB) Enabled() bool {
	return db != nil && db.pool != nil
}

func (db *DB) Close() {
	if db == nil || db.pool == nil {
		return
	}

	db.pool.Close()
}

func (db *DB) Ping(ctx context.Context) error {
	if db == nil || db.pool == nil {
		return nil
	}

	return db.pool.Ping(ctx)
}
