package domain

import "testing"

func TestSessionStatusConstants(t *testing.T) {
	t.Parallel()

	tests := map[string]SessionStatus{
		"draft":     SessionStatusDraft,
		"waiting":   SessionStatusWaiting,
		"live":      SessionStatusLive,
		"ended":     SessionStatusEnded,
		"cancelled": SessionStatusCancelled,
	}

	for want, got := range tests {
		if string(got) != want {
			t.Fatalf("expected session status %q, got %q", want, got)
		}
	}
}

func TestParticipantRoleConstants(t *testing.T) {
	t.Parallel()

	tests := map[string]ParticipantRole{
		"host":  ParticipantRoleHost,
		"guest": ParticipantRoleGuest,
	}

	for want, got := range tests {
		if string(got) != want {
			t.Fatalf("expected participant role %q, got %q", want, got)
		}
	}
}

func TestParticipantStatusConstants(t *testing.T) {
	t.Parallel()

	tests := map[string]ParticipantStatus{
		"invited": ParticipantStatusInvited,
		"joined":  ParticipantStatusJoined,
		"left":    ParticipantStatusLeft,
	}

	for want, got := range tests {
		if string(got) != want {
			t.Fatalf("expected participant status %q, got %q", want, got)
		}
	}
}

func TestExportStatusConstants(t *testing.T) {
	t.Parallel()

	tests := map[string]ExportStatus{
		"pending":    ExportStatusPending,
		"processing": ExportStatusProcessing,
		"ready":      ExportStatusReady,
		"failed":     ExportStatusFailed,
	}

	for want, got := range tests {
		if string(got) != want {
			t.Fatalf("expected export status %q, got %q", want, got)
		}
	}
}
