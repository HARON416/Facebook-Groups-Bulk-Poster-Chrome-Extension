package utils

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	DatabaseURL           string `mapstructure:"DATABASE_URL"`
	Port                  string `mapstructure:"PORT"`
	GoogleOAuthClientID   string `mapstructure:"GOOGLE_OAUTH_CLIENT_ID"`
	AdminAPIKey           string `mapstructure:"ADMIN_API_KEY"`
	FacebookActorHMACKey  string `mapstructure:"FACEBOOK_ACTOR_HMAC_KEY"`
	BunnyStorageZone      string `mapstructure:"BUNNY_STORAGE_ZONE"`
	BunnyStorageEndpoint  string `mapstructure:"BUNNY_STORAGE_ENDPOINT"`
	BunnyPublicBaseURL    string `mapstructure:"BUNNY_PUBLIC_BASE_URL"`
	BunnyStorageAccessKey string `mapstructure:"BUNNY_STORAGE_ACCESS_KEY"`
	ConfigFile            string `mapstructure:"-"`
}

func LoadConfig(path string) (Config, error) {
	var config Config

	configFile, err := resolveConfigFile(path)
	if err != nil {
		return config, err
	}

	v := viper.New()
	v.SetConfigType("env")
	v.SetConfigFile(configFile)
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		return config, err
	}

	if err := v.Unmarshal(&config); err != nil {
		return config, err
	}
	// Keep the existing deployment variable working while documenting the more
	// explicit name for new environments.
	if strings.TrimSpace(config.BunnyStorageAccessKey) == "" {
		config.BunnyStorageAccessKey = v.GetString("BUNNY_API_KEY")
	}

	config.ConfigFile = configFile

	return config, nil
}

func (c Config) Summary() string {
	return fmt.Sprintf(
		"config=%s database_url=%t port=%t google_oauth_client_id=%t admin_api_key=%t facebook_actor_hmac_key=%t bunny_storage=%t",
		c.ConfigFile,
		hasValue(c.DatabaseURL),
		hasValue(c.Port),
		hasValue(c.GoogleOAuthClientID),
		hasValue(c.AdminAPIKey),
		hasValue(c.FacebookActorHMACKey),
		hasValue(c.BunnyStorageZone) &&
			hasValue(c.BunnyStorageEndpoint) &&
			hasValue(c.BunnyPublicBaseURL) &&
			hasValue(c.BunnyStorageAccessKey),
	)
}

func resolveConfigFile(path string) (string, error) {
	configFile := filepath.Join(path, ".env")
	if _, err := os.Stat(configFile); err == nil {
		return configFile, nil
	}

	return "", fmt.Errorf("config file not found: %s", configFile)
}

func hasValue(input string) bool {
	return strings.TrimSpace(input) != ""
}
