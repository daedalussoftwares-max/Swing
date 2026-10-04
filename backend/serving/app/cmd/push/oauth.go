package push

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const defaultTokenURI = "https://oauth2.googleapis.com/token"

type serviceAccount struct {
	Type        string `json:"type"`
	ProjectID   string `json:"project_id"`
	PrivateKey  string `json:"private_key"`
	ClientEmail string `json:"client_email"`
	TokenURI    string `json:"token_uri"`

	key *rsa.PrivateKey
}

func parseServiceAccount(raw []byte) (*serviceAccount, error) {
	var sa serviceAccount
	if err := json.Unmarshal(raw, &sa); err != nil {
		return nil, fmt.Errorf("fcm service account json: %w", err)
	}
	if sa.Type != "" && sa.Type != "service_account" {
		return nil, fmt.Errorf("fcm service account: unexpected type %q (need a service account key, not google-services.json)", sa.Type)
	}
	if sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, errors.New("fcm service account: client_email and private_key are required")
	}
	if sa.TokenURI == "" {
		sa.TokenURI = defaultTokenURI
	}
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return nil, errors.New("fcm service account: private_key is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		k1, err1 := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err1 != nil {
			return nil, fmt.Errorf("fcm service account: parse private_key: %w", err)
		}
		parsed = k1
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("fcm service account: private_key is not RSA")
	}
	sa.key = key
	return &sa, nil
}

// tokenSource exchanges a self-signed JWT for a Google OAuth2 access
// token (RFC 7523 jwt-bearer grant) and caches it until near expiry.
type tokenSource struct {
	sa   *serviceAccount
	http *http.Client
	now  func() time.Time

	mu      sync.Mutex
	token   string
	expires time.Time
}

func newTokenSource(sa *serviceAccount, client *http.Client) *tokenSource {
	return &tokenSource{sa: sa, http: client, now: time.Now}
}

func (t *tokenSource) Invalidate() {
	t.mu.Lock()
	t.token = ""
	t.mu.Unlock()
}

func (t *tokenSource) Token(ctx context.Context) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.token != "" && t.now().Before(t.expires.Add(-2*time.Minute)) {
		return t.token, nil
	}
	assertion, err := t.signAssertion()
	if err != nil {
		return "", err
	}
	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {assertion},
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.sa.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := t.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("oauth token request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("oauth token: http %d: %s", resp.StatusCode, truncateRunes(string(body), 300))
	}
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.AccessToken == "" {
		return "", errors.New("oauth token: malformed response")
	}
	if out.ExpiresIn <= 0 {
		out.ExpiresIn = 3600
	}
	t.token = out.AccessToken
	t.expires = t.now().Add(time.Duration(out.ExpiresIn) * time.Second)
	return t.token, nil
}

func (t *tokenSource) signAssertion() (string, error) {
	now := t.now()
	header := map[string]string{"alg": "RS256", "typ": "JWT"}
	claims := map[string]any{
		"iss":   t.sa.ClientEmail,
		"scope": fcmScope,
		"aud":   t.sa.TokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}
	hb, _ := json.Marshal(header)
	cb, _ := json.Marshal(claims)
	enc := base64.RawURLEncoding
	signing := enc.EncodeToString(hb) + "." + enc.EncodeToString(cb)
	sum := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, t.sa.key, crypto.SHA256, sum[:])
	if err != nil {
		return "", fmt.Errorf("sign jwt: %w", err)
	}
	return signing + "." + enc.EncodeToString(sig), nil
}
