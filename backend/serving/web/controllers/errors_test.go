package controllers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"serving/app/cmd/auth"
)

func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	render := func(err error) (int, string, string) {
		rec := httptest.NewRecorder()
		writeServiceError(rec, httptest.NewRequest("POST", "/v1/auth/login", nil), "auth.login", err)
		var body struct {
			Error struct{ Code, Message string } `json:"error"`
		}
		if e := json.Unmarshal(rec.Body.Bytes(), &body); e != nil {
			t.Fatal(e)
		}
		return rec.Code, body.Error.Code, body.Error.Message
	}
	c1, code1, msg1 := render(auth.ErrInvalidCredentials)
	c2, code2, msg2 := render(auth.ErrWrongPassword)
	if c1 != http.StatusUnauthorized || code1 != "INVALID_CREDENTIALS" || msg1 != "Email or password is incorrect." {
		t.Fatalf("got %d %s %q", c1, code1, msg1)
	}
	if c1 != c2 || code1 != code2 || msg1 != msg2 {
		t.Fatal("wrong-password and invalid-credentials responses differ")
	}
}

func TestValidateNewCredentials(t *testing.T) {
	if validateNewCredentials("a@b.co", "1234567") == "" {
		t.Fatal("7-char password accepted for registration")
	}
	if validateNewCredentials("a@b.co", "12345678") != "" {
		t.Fatal("8-char password rejected")
	}
	long := make([]byte, 73)
	for i := range long {
		long[i] = 'a'
	}
	if validateNewCredentials("a@b.co", string(long)) == "" {
		t.Fatal(">72-byte password accepted")
	}
	if validateCredentials("a@b.co", "123456") != "" {
		t.Fatal("login must keep accepting 6-char legacy passwords")
	}
}

func TestValidateSendBody(t *testing.T) {
	long := make([]byte, 4001)
	for i := range long {
		long[i] = 'a'
	}
	if validateSendBody(&sendMessageBody{Type: "image", Text: string(long)}) == "" {
		t.Fatal("4001-byte caption accepted")
	}
	if validateSendBody(&sendMessageBody{Type: "image", Text: "hi"}) != "" {
		t.Fatal("short caption rejected")
	}
	if maxUploadBytes("video") != 50<<20 || maxUploadBytes("image") != 10<<20 || maxUploadBytes("audio") != 10<<20 {
		t.Fatal("unexpected per-type upload caps")
	}
}
