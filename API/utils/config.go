package utils

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	DatabaseURL         string `mapstructure:"DATABASE_URL"`
	Port                string `mapstructure:"PORT"`
	PasetoPrivateKeyHex string `mapstructure:"PASETO_PRIVATE_KEY_HEX"`
	PasetoPublicKeyHex  string `mapstructure:"PASETO_PUBLIC_KEY_HEX"`
	AdminAPIKey         string `mapstructure:"ADMIN_API_KEY"`
	ConfigFile          string `mapstructure:"-"`
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

	config.ConfigFile = configFile

	return config, nil
}

func (c Config) Summary() string {
	return fmt.Sprintf(
		"config=%s database_url=%t port=%t paseto_private_key=%t paseto_public_key=%t admin_api_key=%t",
		c.ConfigFile,
		hasValue(c.DatabaseURL),
		hasValue(c.Port),
		hasValue(c.PasetoPrivateKeyHex),
		hasValue(c.PasetoPublicKeyHex),
		hasValue(c.AdminAPIKey),
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
