package domain

import "time"

type SessionStatus string

const (
	SessionStatusDraft     SessionStatus = "draft"
	SessionStatusWaiting   SessionStatus = "waiting"
	SessionStatusLive      SessionStatus = "live"
	SessionStatusEnded     SessionStatus = "ended"
	SessionStatusCancelled SessionStatus = "cancelled"
)

type ParticipantRole string

const (
	ParticipantRoleHost  ParticipantRole = "host"
	ParticipantRoleGuest ParticipantRole = "guest"
)

type ParticipantStatus string

const (
	ParticipantStatusInvited ParticipantStatus = "invited"
	ParticipantStatusJoined  ParticipantStatus = "joined"
	ParticipantStatusLeft    ParticipantStatus = "left"
)

type User struct {
	ID           string
	Email        string
	DisplayName  *string
	PasswordHash *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type Studio struct {
	ID          string
	OwnerUserID string
	Name        string
	Slug        string
	Visibility  string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Session struct {
	ID          string
	StudioID    string
	HostUserID  string
	Title       string
	Status      SessionStatus
	ScheduledAt *time.Time
	StartedAt   *time.Time
	EndedAt     *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Participant struct {
	ID            string
	SessionID     string
	UserID        *string
	Role          ParticipantRole
	DisplayName   *string
	JoinTokenHash *string
	Status        ParticipantStatus
	JoinedAt      *time.Time
	LeftAt        *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}
