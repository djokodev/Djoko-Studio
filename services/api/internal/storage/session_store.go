package storage

import (
	"context"
	"errors"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
)

var ErrNotFound = errors.New("not found")

type CreateSessionParams struct {
	StudioID        string
	HostUserID      string
	InviteTokenHash string
	Title           string
	Status          domain.SessionStatus
	ScheduledAt     *time.Time
}

type SessionStore interface {
	CreateSession(ctx context.Context, params CreateSessionParams) (domain.Session, error)
	GetSession(ctx context.Context, id string) (domain.Session, error)
	GetSessionByInviteTokenHash(ctx context.Context, inviteTokenHash string) (domain.Session, error)
	ListSessionsByStudio(ctx context.Context, studioID string) ([]domain.Session, error)
}

type JoinGuestParticipantParams struct {
	SessionID   string
	DisplayName string
}

type JoinHostParticipantParams struct {
	SessionID   string
	HostUserID  string
	DisplayName string
}

type ParticipantStore interface {
	JoinGuestParticipant(ctx context.Context, params JoinGuestParticipantParams) (domain.Participant, error)
	JoinHostParticipant(ctx context.Context, params JoinHostParticipantParams) (domain.Participant, error)
}
