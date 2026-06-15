package invite

import "testing"

func TestGenerateTokenReturnsNonEmptyDistinctValues(t *testing.T) {
	t.Parallel()

	first, err := GenerateToken()
	if err != nil {
		t.Fatalf("generate first token: %v", err)
	}

	second, err := GenerateToken()
	if err != nil {
		t.Fatalf("generate second token: %v", err)
	}

	if first == "" {
		t.Fatal("expected first token to be non-empty")
	}

	if second == "" {
		t.Fatal("expected second token to be non-empty")
	}

	if first == second {
		t.Fatal("expected generated tokens to differ")
	}
}

func TestHashTokenReturnsDeterministicSHA256Hex(t *testing.T) {
	t.Parallel()

	rawToken := "guest-token"
	firstHash := HashToken(rawToken)
	secondHash := HashToken(rawToken)

	if firstHash != secondHash {
		t.Fatalf("expected deterministic hash, got %q and %q", firstHash, secondHash)
	}

	if firstHash == rawToken {
		t.Fatalf("expected hash to differ from raw token %q", rawToken)
	}

	if len(firstHash) != 64 {
		t.Fatalf("expected 64-character sha256 hex hash, got length %d", len(firstHash))
	}
}
