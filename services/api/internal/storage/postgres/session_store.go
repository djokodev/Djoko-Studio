package postgres

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const sessionColumnList = `
  id::text,
  studio_id::text,
  host_user_id::text,
  title,
  status,
  scheduled_at,
  started_at,
  ended_at,
  created_at,
  updated_at
`

const createSessionQuery = `
INSERT INTO sessions (
  studio_id,
  host_user_id,
  invite_token_hash,
  title,
  status,
  scheduled_at
) VALUES (
  $1::uuid,
  $2::uuid,
  $3,
  $4,
  $5,
  $6
)
RETURNING
` + sessionColumnList

const getSessionQuery = `
SELECT
` + sessionColumnList + `
FROM sessions
WHERE id = $1::uuid
`

const getSessionByInviteTokenHashQuery = `
SELECT
` + sessionColumnList + `
FROM sessions
WHERE invite_token_hash = $1
`

const listSessionsByStudioQuery = `
SELECT
` + sessionColumnList + `
FROM sessions
WHERE studio_id = $1::uuid
ORDER BY created_at DESC, id DESC
`

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type rowScanner interface {
	Scan(dest ...any) error
}

type SessionStore struct {
	db queryer
}

var _ storage.SessionStore = (*SessionStore)(nil)

func NewSessionStore(pool *pgxpool.Pool) *SessionStore {
	return &SessionStore{db: pool}
}

func (s *SessionStore) CreateSession(ctx context.Context, params storage.CreateSessionParams) (domain.Session, error) {
	status := params.Status
	if status == "" {
		status = domain.SessionStatusDraft
	}

	return scanSession(s.db.QueryRow(
		ctx,
		createSessionQuery,
		params.StudioID,
		params.HostUserID,
		params.InviteTokenHash,
		params.Title,
		status,
		params.ScheduledAt,
	))
}

func (s *SessionStore) GetSession(ctx context.Context, id string) (domain.Session, error) {
	return scanSession(s.db.QueryRow(ctx, getSessionQuery, id))
}

func (s *SessionStore) GetSessionByInviteTokenHash(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
	return scanSession(s.db.QueryRow(ctx, getSessionByInviteTokenHashQuery, inviteTokenHash))
}

func (s *SessionStore) ListSessionsByStudio(ctx context.Context, studioID string) ([]domain.Session, error) {
	rows, err := s.db.Query(ctx, listSessionsByStudioQuery, studioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]domain.Session, 0)
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, err
		}

		sessions = append(sessions, session)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return sessions, nil
}

func scanSession(scanner rowScanner) (domain.Session, error) {
	var (
		session     domain.Session
		status      string
		scheduledAt sql.NullTime
		startedAt   sql.NullTime
		endedAt     sql.NullTime
	)

	err := scanner.Scan(
		&session.ID,
		&session.StudioID,
		&session.HostUserID,
		&session.Title,
		&status,
		&scheduledAt,
		&startedAt,
		&endedAt,
		&session.CreatedAt,
		&session.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, storage.ErrNotFound
		}

		return domain.Session{}, err
	}

	session.Status = domain.SessionStatus(status)
	session.ScheduledAt = nullableTimePtr(scheduledAt)
	session.StartedAt = nullableTimePtr(startedAt)
	session.EndedAt = nullableTimePtr(endedAt)

	return session, nil
}

func nullableTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}

	timestamp := value.Time
	return &timestamp
}
