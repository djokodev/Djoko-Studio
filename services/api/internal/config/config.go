package config

const (
	defaultPort        = "8080"
	defaultEnvironment = "development"
)

type Config struct {
	Port        string
	Environment string
	DatabaseURL string
}

func Load(lookup func(string) string) Config {
	cfg := Config{
		Port:        defaultPort,
		Environment: defaultEnvironment,
	}

	if lookup == nil {
		return cfg
	}

	if port := lookup("PORT"); port != "" {
		cfg.Port = port
	}

	if environment := lookup("APP_ENV"); environment != "" {
		cfg.Environment = environment
	}

	cfg.DatabaseURL = lookup("DATABASE_URL")

	return cfg
}
