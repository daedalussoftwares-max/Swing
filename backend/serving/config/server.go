package config

import "time"

func GetSetup() string {
	return selected.Setup
}

func GetProfile() string {
	return selected.Profile
}

func GetPort() string {
	port := selected.Server.Port
	if port == "" {
		port = "8080"
	}
	if port[0] != ':' {
		return ":" + port
	}
	return port
}

func GetServerReadTimeout() time.Duration {
	return selected.readTimeout
}

func GetServerWriteTimeout() time.Duration {
	return selected.writeTimeout
}

// TrustProxy reports whether X-Forwarded-For may be used for client IPs
// (server.trust_proxy, default false).
func TrustProxy() bool {
	return selected.Server.TrustProxy
}
