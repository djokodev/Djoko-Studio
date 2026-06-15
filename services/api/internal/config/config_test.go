package config

import "testing"

func TestLoadUsesDefaultsWhenEnvironmentValuesAreMissing(t *testing.T) {
	t.Parallel()

	cfg := Load(func(string) string {
		return ""
	})

	if cfg.Port != defaultPort {
		t.Fatalf("expected port %q, got %q", defaultPort, cfg.Port)
	}

	if cfg.Environment != defaultEnvironment {
		t.Fatalf("expected environment %q, got %q", defaultEnvironment, cfg.Environment)
	}

	if cfg.DatabaseURL != "" {
		t.Fatalf("expected database url to be empty, got %q", cfg.DatabaseURL)
	}
}

func TestLoadAppliesOverridesFromLookup(t *testing.T) {
	t.Parallel()

	values := map[string]string{
		"PORT":         "9090",
		"APP_ENV":      "staging",
		"DATABASE_URL": "postgres://example/db",
	}

	cfg := Load(func(key string) string {
		return values[key]
	})

	if cfg.Port != "9090" {
		t.Fatalf("expected port %q, got %q", "9090", cfg.Port)
	}

	if cfg.Environment != "staging" {
		t.Fatalf("expected environment %q, got %q", "staging", cfg.Environment)
	}

	if cfg.DatabaseURL != "postgres://example/db" {
		t.Fatalf("expected database url %q, got %q", "postgres://example/db", cfg.DatabaseURL)
	}
}

func TestLoadReadsDatabaseURLWithoutRequiringOtherValues(t *testing.T) {
	t.Parallel()

	cfg := Load(func(key string) string {
		if key == "DATABASE_URL" {
			return "postgres://example/db"
		}

		return ""
	})

	if cfg.Port != defaultPort {
		t.Fatalf("expected port %q, got %q", defaultPort, cfg.Port)
	}

	if cfg.Environment != defaultEnvironment {
		t.Fatalf("expected environment %q, got %q", defaultEnvironment, cfg.Environment)
	}

	if cfg.DatabaseURL != "postgres://example/db" {
		t.Fatalf("expected database url %q, got %q", "postgres://example/db", cfg.DatabaseURL)
	}
}
