package storage

import "testing"

func TestErrNotFound(t *testing.T) {
	t.Parallel()

	if ErrNotFound == nil {
		t.Fatal("expected ErrNotFound to be defined")
	}

	if ErrNotFound.Error() != "not found" {
		t.Fatalf("expected ErrNotFound message %q, got %q", "not found", ErrNotFound.Error())
	}
}
