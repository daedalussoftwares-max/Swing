package push

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"lib/stdid"
)

func TestBuildMessage_ChatMessage(t *testing.T) {
	n := Notification{
		Title:    "Asha",
		Body:     "hey there",
		Data:     map[string]string{"type": "chat_message", "chatId": "c1", "messageId": "m1", "senderId": "s1"},
		ThreadID: "c1",
	}
	b, err := json.Marshal(fcmRequest{Message: buildMessage("tok", n)})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	m := got["message"].(map[string]any)
	if m["token"] != "tok" {
		t.Fatalf("token = %v", m["token"])
	}
	notif := m["notification"].(map[string]any)
	if notif["title"] != "Asha" || notif["body"] != "hey there" {
		t.Fatalf("notification = %v", notif)
	}
	data := m["data"].(map[string]any)
	for k, v := range n.Data {
		if data[k] != v {
			t.Fatalf("data[%s] = %v, want %s", k, data[k], v)
		}
	}
	android := m["android"].(map[string]any)
	if android["priority"] != "HIGH" {
		t.Fatalf("android priority = %v", android["priority"])
	}
	an := android["notification"].(map[string]any)
	if an["channel_id"] != "messages" || an["tag"] != "c1" || an["sound"] != "default" || an["default_sound"] != true {
		t.Fatalf("android notification = %v", an)
	}
	apns := m["apns"].(map[string]any)
	headers := apns["headers"].(map[string]any)
	if headers["apns-priority"] != "10" || headers["apns-push-type"] != "alert" || headers["apns-collapse-id"] != "m1" {
		t.Fatalf("apns headers = %v", headers)
	}
	aps := apns["payload"].(map[string]any)["aps"].(map[string]any)
	if aps["sound"] != "default" || aps["thread-id"] != "c1" {
		t.Fatalf("aps = %v", aps)
	}
}

func TestBuildMessage_PlaneNoThreadAndCopiesData(t *testing.T) {
	data := map[string]string{"type": "plane_received", "planeId": "p1"}
	msg := buildMessage("tok", Notification{Title: "t", Body: "b", Data: data})
	data["type"] = "mutated"
	if msg.Data["type"] != "plane_received" {
		t.Fatal("data map must be copied")
	}
	if _, ok := msg.APNS.Payload["aps"].(map[string]any)["thread-id"]; ok {
		t.Fatal("thread-id must be omitted when ThreadID is empty")
	}
	if msg.APNS.Headers["apns-collapse-id"] != "plane_received:p1" {
		t.Fatalf("collapse id = %q", msg.APNS.Headers["apns-collapse-id"])
	}
	b, _ := json.Marshal(msg)
	if strings.Contains(string(b), `"tag"`) {
		t.Fatalf("empty tag must be omitted: %s", b)
	}
}

func TestBuildMessage_TruncatesLongBody(t *testing.T) {
	long := strings.Repeat("é", 500)
	msg := buildMessage("tok", Notification{Title: "t", Body: long})
	if n := len([]rune(msg.Notification.Body)); n != 240 {
		t.Fatalf("body runes = %d", n)
	}
}

func TestIsInvalidTokenError(t *testing.T) {
	cases := []struct {
		name              string
		http              int
		status, code, msg string
		want              bool
	}{
		{"unregistered", 404, "NOT_FOUND", "UNREGISTERED", "Requested entity was not found.", true},
		{"bad token", 400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token", true},
		{"bad payload", 400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "Invalid value at 'message.data'", false},
		{"sender mismatch", 403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH", "", true},
		{"undetailed not found", 404, "NOT_FOUND", "", "Requested entity was not found.", true},
		{"wrong project", 404, "NOT_FOUND", "", "Project not found", false},
		{"quota", 429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED", "", false},
		{"unavailable", 503, "UNAVAILABLE", "UNAVAILABLE", "", false},
	}
	for _, c := range cases {
		if got := IsInvalidTokenError(c.http, c.status, c.code, c.msg); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func TestParseFCMError(t *testing.T) {
	body := `{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`
	status, code, msg := parseFCMError([]byte(body))
	if status != "NOT_FOUND" || code != "UNREGISTERED" || msg == "" {
		t.Fatalf("got %q %q %q", status, code, msg)
	}
}

// ---- fakes (no real network: httptest only) ----

type memStore struct {
	tokens  []DeviceToken
	removed []string
}

func (m *memStore) Tokens(context.Context, stdid.UUID) ([]DeviceToken, error) { return m.tokens, nil }
func (m *memStore) Remove(_ context.Context, tok string) error {
	m.removed = append(m.removed, tok)
	return nil
}

func testServiceAccount(t *testing.T, tokenURI string) *serviceAccount {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	pemKey := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	raw, _ := json.Marshal(map[string]string{
		"type": "service_account", "project_id": "demo", "private_key": pemKey,
		"client_email": "svc@demo.iam.gserviceaccount.com", "token_uri": tokenURI,
	})
	sa, err := parseServiceAccount(raw)
	if err != nil {
		t.Fatal(err)
	}
	return sa
}

func TestFCMNotify_RemovesUnregisteredAndCachesToken(t *testing.T) {
	var tokenCalls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		tokenCalls.Add(1)
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" || r.Form.Get("assertion") == "" {
			http.Error(w, "bad", 400)
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"at","expires_in":3600}`))
	})
	mux.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer at" {
			http.Error(w, "unauth", 401)
			return
		}
		var req fcmRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Message.Token == "dead" {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}`))
			return
		}
		_, _ = w.Write([]byte(`{"name":"projects/demo/messages/1"}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	store := &memStore{tokens: []DeviceToken{{"live", "ios"}, {"dead", "android"}}}
	f := &FCM{
		projectID: "demo",
		tokens:    store,
		auth:      newTokenSource(testServiceAccount(t, srv.URL+"/token"), srv.Client()),
		http:      srv.Client(),
		sendURL:   srv.URL + "/send",
	}
	uid, _ := stdid.New()
	for i := 0; i < 2; i++ {
		if err := f.Notify(context.Background(), uid, Notification{Title: "t", Body: "b"}); err != nil {
			t.Fatalf("notify: %v", err)
		}
	}
	if tokenCalls.Load() != 1 {
		t.Fatalf("access token should be cached, fetched %d times", tokenCalls.Load())
	}
	if len(store.removed) != 2 || store.removed[0] != "dead" {
		t.Fatalf("removed = %v", store.removed)
	}
}
