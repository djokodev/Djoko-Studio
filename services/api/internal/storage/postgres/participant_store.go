package postgres

import (
	"context"
	"database/sql"
	"errors"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const participantColumnList = `
  id::text,
  session_id::text,
  user_id::text,
  role,
  display_name,
  join_token_hash,
  status,
  joined_at,
  left_at,
  created_at,
  updated_at
`

const joinGuestParticipantQuery = `
INSERT INTO participants (
  session_id,
  role,
  display_name,
  status,
  joined_at
) VALUES (
  $1::uuid,
  'guest',
  $2,
  'joined',
  now()
)
ON CONFLICT (session_id, role) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  status = 'joined',
  joined_at = EXCLUDED.joined_at,
  left_at = NULL,
  updated_at = now()
RETURNING
` + participantColumnList

type ParticipantStore struct {
	db queryer
}

var _ storage.ParticipantStore = (*ParticipantStore)(nil)

func NewParticipantStore(pool *pgxpool.Pool) *ParticipantStore {
	return &ParticipantStore{db: pool}
}

func (s *ParticipantStore) JoinGuestParticipant(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
	return scanParticipant(s.db.QueryRow(ctx, joinGuestParticipantQuery, params.SessionID, params.DisplayName))
}

func scanParticipant(scanner rowScanner) (domain.Participant, error) {
	var (
		participant   domain.Participant
		userID        sql.NullString
		role          string
		displayName   sql.NullString
		joinTokenHash sql.NullString
		status        string
		joinedAt      sql.NullTime
		leftAt        sql.NullTime
	)

	err := scanner.Scan(
		&participant.ID,
		&participant.SessionID,
		&userID,
		&role,
		&displayName,
		&joinTokenHash,
		&status,
		&joinedAt,
		&leftAt,
		&participant.CreatedAt,
		&participant.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Participant{}, storage.ErrNotFound
		}

		return domain.Participant{}, err
	}

	participant.UserID = nullableStringPtr(userID)
	participant.Role = domain.ParticipantRole(role)
	participant.DisplayName = nullableStringPtr(displayName)
	participant.JoinTokenHash = nullableStringPtr(joinTokenHash)
	participant.Status = domain.ParticipantStatus(status)
	participant.JoinedAt = nullableTimePtr(joinedAt)
	participant.LeftAt = nullableTimePtr(leftAt)

	return participant, nil
}

func nullableStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}

	text := value.String
	return &text
}
