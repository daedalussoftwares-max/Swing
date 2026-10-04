package push

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"lib/stdid"

	"serving/app/pkg/logx"
)

const (
	fcmScope       = "https://www.googleapis.com/auth/firebase.messaging"
	fcmSendURLFmt  = "https://fcm.googleapis.com/v1/projects/%s/messages:send"
	perSendTimeout = 8 * time.Second

	// maxParallelSends caps concurrent FCM requests for one recipient.
	maxParallelSends = 4

	// AndroidChannelID must match the NotificationChannel created by the
	// Android app at startup (MainApplication.kt).
	AndroidChannelID = "messages"
)

// TokenStore reads and prunes device tokens. The default implementation
// is backed by the device_tokens table.
type TokenStore interface {
	Tokens(ctx context.Context, accountID stdid.UUID) ([]DeviceToken, error)
	Remove(ctx context.Context, token string) error
}

type DeviceToken struct {
	Token    string
	Platform string
}

// FCM sends notifications through Firebase Cloud Messaging HTTP v1
// (Android + iOS via APNs). Safe for concurrent use.
type FCM struct {
	projectID string
	tokens    TokenStore
	auth      *tokenSource
	http      *http.Client
	sendURL   string
}

// NewFCMFromFile loads a service-account JSON and returns an FCM pusher
// that reads device tokens from db. projectID overrides the JSON's
// project_id when non-empty.
func NewFCMFromFile(path, projectID string, db *sql.DB) (*FCM, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read fcm service account: %w", err)
	}
	sa, err := parseServiceAccount(raw)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(projectID) == "" {
		projectID = sa.ProjectID
	}
	if projectID == "" {
		return nil, errors.New("fcm: project_id missing (service account JSON or push.fcm_project_id)")
	}
	client := &http.Client{Timeout: 15 * time.Second}
	return &FCM{
		projectID: projectID,
		tokens:    &SQLTokenStore{DB: db},
		auth:      newTokenSource(sa, client),
		http:      client,
		sendURL:   fmt.Sprintf(fcmSendURLFmt, projectID),
	}, nil
}

// ProjectID returns the Firebase project messages are sent through.
func (f *FCM) ProjectID() string { return f.projectID }

// Notify sends n to every registered device of recipientID concurrently
// (bounded by maxParallelSends) and waits for all of them.
// Tokens FCM reports as invalid are deleted. Errors are logged; the
// returned error is non-nil only when every send failed.
func (f *FCM) Notify(ctx context.Context, recipientID stdid.UUID, n Notification) error {
	if recipientID.IsZero() {
		return nil
	}
	devices, err := f.tokens.Tokens(ctx, recipientID)
	if err != nil {
		logx.Error("push: load device tokens", err, "recipient", recipientID.String())
		return err
	}
	if len(devices) == 0 {
		return nil
	}
	access, err := f.auth.Token(ctx)
	if err != nil {
		logx.Error("push: fcm access token", err)
		return err
	}

	var (
		wg     sync.WaitGroup
		mu     sync.Mutex
		failed int
	)
	// At most maxParallelSends requests in flight per Notify; Notify itself
	// runs on the bounded background pool, so total push concurrency is
	// bounded too.
	sem := make(chan struct{}, maxParallelSends)
	for _, d := range devices {
		wg.Add(1)
		sem <- struct{}{}
		go func(d DeviceToken) {
			defer wg.Done()
			defer func() { <-sem }()
			defer func() {
				if r := recover(); r != nil {
					logx.Error("push: send panic", fmt.Errorf("%v", r))
				}
			}()
			if err := f.sendOne(ctx, access, d, n); err != nil {
				mu.Lock()
				failed++
				mu.Unlock()
			}
		}(d)
	}
	wg.Wait()
	if failed == len(devices) {
		return fmt.Errorf("push: all %d sends failed", failed)
	}
	return nil
}

func (f *FCM) sendOne(ctx context.Context, access string, d DeviceToken, n Notification) error {
	ctx, cancel := context.WithTimeout(ctx, perSendTimeout)
	defer cancel()

	body, err := json.Marshal(fcmRequest{Message: buildMessage(d.Token, n)})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.sendURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.http.Do(req)
	if err != nil {
		logx.Warn("push: fcm send failed", "err", err.Error(), "platform", d.Platform)
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	if resp.StatusCode == http.StatusUnauthorized {
		f.auth.Invalidate()
	}
	status, code, msg := parseFCMError(respBody)
	if IsInvalidTokenError(resp.StatusCode, status, code, msg) {
		if err := f.tokens.Remove(context.WithoutCancel(ctx), d.Token); err != nil {
			logx.Error("push: remove invalid token", err)
		} else {
			logx.Info("push: removed invalid device token", "platform", d.Platform, "fcm_code", firstNonEmpty(code, status))
		}
		return fmt.Errorf("fcm: invalid token (%s)", firstNonEmpty(code, status))
	}
	logx.Warn("push: fcm send rejected",
		"http_status", resp.StatusCode,
		"fcm_status", status,
		"fcm_code", code,
		"platform", d.Platform,
	)
	return fmt.Errorf("fcm: http %d %s", resp.StatusCode, firstNonEmpty(code, status))
}

// ---- payload ---------------------------------------------------------

type fcmRequest struct {
	Message fcmMessage `json:"message"`
}

type fcmMessage struct {
	Token        string            `json:"token"`
	Notification *fcmNotification  `json:"notification,omitempty"`
	Data         map[string]string `json:"data,omitempty"`
	Android      *fcmAndroid       `json:"android,omitempty"`
	APNS         *fcmAPNS          `json:"apns,omitempty"`
}

type fcmNotification struct {
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
}

type fcmAndroid struct {
	Priority     string               `json:"priority,omitempty"`
	CollapseKey  string               `json:"collapse_key,omitempty"`
	Notification *fcmAndroidNotifBody `json:"notification,omitempty"`
}

type fcmAndroidNotifBody struct {
	ChannelID    string `json:"channel_id,omitempty"`
	Tag          string `json:"tag,omitempty"`
	Sound        string `json:"sound,omitempty"`
	DefaultSound bool   `json:"default_sound,omitempty"`
}

type fcmAPNS struct {
	Headers map[string]string `json:"headers,omitempty"`
	Payload map[string]any    `json:"payload,omitempty"`
}

// buildMessage builds the FCM v1 message for a single device token.
func buildMessage(token string, n Notification) fcmMessage {
	data := make(map[string]string, len(n.Data))
	for k, v := range n.Data {
		data[k] = v
	}
	if len(data) == 0 {
		data = nil
	}

	android := &fcmAndroid{
		Priority: "HIGH",
		Notification: &fcmAndroidNotifBody{
			ChannelID:    AndroidChannelID,
			Tag:          n.ThreadID,
			Sound:        "default",
			DefaultSound: true,
		},
	}

	aps := map[string]any{
		"sound": "default",
	}
	if n.ThreadID != "" {
		aps["thread-id"] = n.ThreadID
	}
	headers := map[string]string{
		"apns-priority":  "10",
		"apns-push-type": "alert",
	}
	// Collapse only per-message so repeated sends of the same event
	// (retries) replace instead of stacking; distinct messages still
	// group under thread-id.
	if id := collapseID(n); id != "" {
		headers["apns-collapse-id"] = id
	}

	return fcmMessage{
		Token: token,
		Notification: &fcmNotification{
			Title: truncateRunes(n.Title, 120),
			Body:  truncateRunes(n.Body, 240),
		},
		Data:    data,
		Android: android,
		APNS:    &fcmAPNS{Headers: headers, Payload: map[string]any{"aps": aps}},
	}
}

func collapseID(n Notification) string {
	var id string
	switch {
	case n.Data["messageId"] != "":
		id = n.Data["messageId"]
	case n.Data["planeId"] != "" && n.Data["type"] != "":
		id = n.Data["type"] + ":" + n.Data["planeId"]
	}
	// apns-collapse-id must be <= 64 bytes.
	if len(id) > 64 {
		id = id[:64]
	}
	return id
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}

// ---- errors ----------------------------------------------------------

type fcmErrorBody struct {
	Error struct {
		Code    int    `json:"code"`
		Status  string `json:"status"`
		Message string `json:"message"`
		Details []struct {
			Type      string `json:"@type"`
			ErrorCode string `json:"errorCode"`
		} `json:"details"`
	} `json:"error"`
}

func parseFCMError(b []byte) (status, code, message string) {
	var e fcmErrorBody
	if json.Unmarshal(b, &e) != nil {
		return "", "", ""
	}
	for _, d := range e.Error.Details {
		if d.ErrorCode != "" {
			code = d.ErrorCode
			break
		}
	}
	return e.Error.Status, code, e.Error.Message
}

// IsInvalidTokenError reports whether an FCM error means the token will
// never work again and should be deleted.
func IsInvalidTokenError(httpStatus int, status, code, message string) bool {
	switch code {
	case "UNREGISTERED", "SENDER_ID_MISMATCH":
		return true
	case "INVALID_ARGUMENT":
		// INVALID_ARGUMENT is also returned for malformed payloads, so
		// only drop the token when FCM says the token itself is bad.
		return strings.Contains(strings.ToLower(message), "registration token")
	}
	// Older/undetailed responses: 404 NOT_FOUND "Requested entity was not
	// found." means the token is gone. A wrong project id yields a
	// different message (or 403), so this does not mass-delete tokens.
	if code == "" && httpStatus == http.StatusNotFound && status == "NOT_FOUND" &&
		strings.Contains(strings.ToLower(message), "requested entity was not found") {
		return true
	}
	return false
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// ---- token store -----------------------------------------------------

// SQLTokenStore reads device_tokens.
type SQLTokenStore struct {
	DB *sql.DB
}

func (s *SQLTokenStore) Tokens(ctx context.Context, accountID stdid.UUID) ([]DeviceToken, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT token, platform FROM device_tokens
		WHERE account_id = $1
		  AND token NOT LIKE 'stub-%'
		ORDER BY updated_at DESC
		LIMIT 20
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeviceToken
	for rows.Next() {
		var d DeviceToken
		if err := rows.Scan(&d.Token, &d.Platform); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *SQLTokenStore) Remove(ctx context.Context, token string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM device_tokens WHERE token = $1`, token)
	return err
}
