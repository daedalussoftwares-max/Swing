package config

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed setup
var setupDirectory embed.FS

func getConfig() (Configuration, error) {
	profile := lookupEnv(argProfile, defProfile)
	setup := lookupEnv(argSetup, defSetup)

	cfg, err := readSetupYAML(setup, profile)
	if err != nil {
		return Configuration{}, err
	}

	if overlay, err := readSetupOverlay(setup, profile); err == nil {
		mergeConfiguration(&cfg, &overlay)
	}

	applyEnvOverrides(&cfg)
	cfg.Version = lookupEnv(argVersion, defVersion)
	cfg.Profile = profile
	cfg.Setup = setup

	if err := cfg.validate(); err != nil {
		return Configuration{}, err
	}
	if err := cfg.parseDurations(); err != nil {
		return Configuration{}, err
	}
	return cfg, nil
}

func readSetupYAML(setup, profile string) (Configuration, error) {
	path := fmt.Sprintf("setup/%s/%s.yaml", setup, profile)
	b, err := fs.ReadFile(setupDirectory, path)
	if err != nil {
		return Configuration{}, fmt.Errorf("read embedded config %s: %w", path, err)
	}
	return decodeYAML(b)
}

func readSetupOverlay(setup, profile string) (Configuration, error) {
	path := fmt.Sprintf("config/setup/%s/%s.local.yaml", setup, profile)
	b, err := os.ReadFile(path)
	if err != nil {
		return Configuration{}, err
	}
	return decodeYAML(b)
}

func decodeYAML(b []byte) (Configuration, error) {
	var cfg Configuration
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return Configuration{}, err
	}
	return cfg, nil
}

func lookupEnv(key, defaultVal string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return defaultVal
}

func applyEnvOverrides(cfg *Configuration) {
	if v := os.Getenv(envDatabaseURL); v != "" {
		cfg.Database.URL = v
	}
	if v := os.Getenv(envJWTSecret); v != "" {
		cfg.Auth.JWTSecret = v
	}
	if v := os.Getenv(envGoogleClientID); v != "" {
		cfg.Auth.GoogleClientID = v
	}
	if v := os.Getenv(envPort); v != "" {
		cfg.Server.Port = v
	}
	if v := os.Getenv(envR2AccountID); v != "" {
		cfg.R2.AccountID = v
	}
	if v := os.Getenv(envR2AccessKeyID); v != "" {
		cfg.R2.AccessKeyID = v
	}
	if v := os.Getenv(envR2SecretAccessKey); v != "" {
		cfg.R2.SecretAccessKey = v
	}
	if v := os.Getenv(envR2Bucket); v != "" {
		cfg.R2.Bucket = v
	}
	if v := os.Getenv(envR2PublicBaseURL); v != "" {
		cfg.R2.PublicBaseURL = v
	}
	if v, ok := os.LookupEnv(envDebugHTTP); ok {
		cfg.Logging.DebugHTTP = parseTruthy(v)
	}
	if v := os.Getenv(envFCMServiceAccountFile); v != "" {
		cfg.Push.FCMServiceAccountFile = v
	}
	if v := os.Getenv(envFCMProjectID); v != "" {
		cfg.Push.FCMProjectID = v
	}
}

func parseTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func mergeConfiguration(base, overlay *Configuration) {
	if overlay.Server.Port != "" {
		base.Server.Port = overlay.Server.Port
	}
	if overlay.Server.ReadTimeout != "" {
		base.Server.ReadTimeout = overlay.Server.ReadTimeout
	}
	if overlay.Server.WriteTimeout != "" {
		base.Server.WriteTimeout = overlay.Server.WriteTimeout
	}
	if overlay.Database.URL != "" {
		base.Database.URL = overlay.Database.URL
	}
	if overlay.Auth.JWTSecret != "" {
		base.Auth.JWTSecret = overlay.Auth.JWTSecret
	}
	if overlay.Auth.GoogleClientID != "" {
		base.Auth.GoogleClientID = overlay.Auth.GoogleClientID
	}
	if len(overlay.Auth.GoogleClientIDs) > 0 {
		base.Auth.GoogleClientIDs = overlay.Auth.GoogleClientIDs
	}
	if overlay.Auth.AccessTokenTTL != "" {
		base.Auth.AccessTokenTTL = overlay.Auth.AccessTokenTTL
	}
	if overlay.Auth.RefreshTokenTTL != "" {
		base.Auth.RefreshTokenTTL = overlay.Auth.RefreshTokenTTL
	}
	if len(overlay.CORS.AllowedOrigins) > 0 {
		base.CORS.AllowedOrigins = overlay.CORS.AllowedOrigins
	}
	if overlay.R2.AccountID != "" {
		base.R2.AccountID = overlay.R2.AccountID
	}
	if overlay.R2.AccessKeyID != "" {
		base.R2.AccessKeyID = overlay.R2.AccessKeyID
	}
	if overlay.R2.SecretAccessKey != "" {
		base.R2.SecretAccessKey = overlay.R2.SecretAccessKey
	}
	if overlay.R2.Bucket != "" {
		base.R2.Bucket = overlay.R2.Bucket
	}
	if overlay.R2.PublicBaseURL != "" {
		base.R2.PublicBaseURL = overlay.R2.PublicBaseURL
	}
	if overlay.Logging.DebugHTTP {
		base.Logging.DebugHTTP = true
	}
	if overlay.Push.FCMServiceAccountFile != "" {
		base.Push.FCMServiceAccountFile = overlay.Push.FCMServiceAccountFile
	}
	if overlay.Push.FCMProjectID != "" {
		base.Push.FCMProjectID = overlay.Push.FCMProjectID
	}
}
