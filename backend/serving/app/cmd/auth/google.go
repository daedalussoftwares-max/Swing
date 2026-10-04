package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrGoogleTokenInvalid  = errors.New("google token invalid")
	ErrGoogleNotConfigured = errors.New("google auth not configured")
)

type googleTokenInfo struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Aud           string `json:"aud"`
	Iss           string `json:"iss"`
}

// VerifyGoogleIDToken checks a Google ID token via Google's tokeninfo endpoint.
// Uses stdlib HTTP only — no extra Go modules.
func VerifyGoogleIDToken(ctx context.Context, allowedClientIDs []string, idToken string) (googleTokenInfo, error) {
	if len(allowedClientIDs) == 0 {
		return googleTokenInfo{}, ErrGoogleNotConfigured
	}
	idToken = strings.TrimSpace(idToken)
	if idToken == "" {
		return googleTokenInfo{}, ErrGoogleTokenInvalid
	}

	u := "https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(idToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return googleTokenInfo{}, err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return googleTokenInfo{}, fmt.Errorf("google tokeninfo: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return googleTokenInfo{}, ErrGoogleTokenInvalid
	}

	var info googleTokenInfo
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&info); err != nil {
		return googleTokenInfo{}, ErrGoogleTokenInvalid
	}
	// tokeninfo validates signature and expiry; audience and issuer are ours to check.
	if info.Sub == "" || !googleAudienceAllowed(info.Aud, allowedClientIDs) {
		return googleTokenInfo{}, ErrGoogleTokenInvalid
	}
	if info.Iss != "accounts.google.com" && info.Iss != "https://accounts.google.com" {
		return googleTokenInfo{}, ErrGoogleTokenInvalid
	}
	if info.EmailVerified != "true" && info.EmailVerified != "1" {
		return googleTokenInfo{}, ErrGoogleTokenInvalid
	}
	info.Email = normalizeEmail(info.Email)
	if info.Email == "" {
		return googleTokenInfo{}, ErrGoogleTokenInvalid
	}
	return info, nil
}

func googleAudienceAllowed(aud string, allowed []string) bool {
	for _, id := range allowed {
		if aud == id {
			return true
		}
	}
	return false
}
