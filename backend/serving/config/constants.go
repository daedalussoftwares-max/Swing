package config

const (
	argProfile = "PROFILE"
	defProfile = "dev"

	argSetup = "SETUP"
	defSetup = "local"

	argVersion        = "VERSION"
	defVersion        = "dev"
	argBuildTimestamp = "BUILD_TIMESTAMP"

	envDatabaseURL     = "DATABASE_URL"
	envJWTSecret       = "JWT_SECRET"
	envGoogleClientID  = "GOOGLE_CLIENT_ID"
	envPort            = "PORT"

	envR2AccountID       = "R2_ACCOUNT_ID"
	envR2AccessKeyID     = "R2_ACCESS_KEY_ID"
	envR2SecretAccessKey = "R2_SECRET_ACCESS_KEY"
	envR2Bucket          = "R2_BUCKET"
	envR2PublicBaseURL   = "R2_PUBLIC_BASE_URL"

	envDebugHTTP = "SWING_DEBUG_HTTP"

	envFCMServiceAccountFile = "FCM_SERVICE_ACCOUNT_FILE"
	envFCMProjectID          = "FCM_PROJECT_ID"
)
