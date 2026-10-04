package controllers

import (
	"net/http"
	"strings"

	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
)

type emailPasswordBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshBody struct {
	RefreshToken string `json:"refreshToken"`
}

type googleBody struct {
	IDToken string `json:"idToken"`
}

func Register(w http.ResponseWriter, r *http.Request) {
	var body emailPasswordBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	if msg := validateCredentials(body.Email, body.Password); msg != "" {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", msg)
		return
	}
	resp, err := common.Auth.Register(r.Context(), body.Email, body.Password)
	if err != nil {
		writeServiceError(w, r, "auth.register", err)
		return
	}
	httpx.JSON(w, http.StatusCreated, resp)
}

func Login(w http.ResponseWriter, r *http.Request) {
	var body emailPasswordBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	if msg := validateCredentials(body.Email, body.Password); msg != "" {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", msg)
		return
	}
	resp, err := common.Auth.Login(r.Context(), body.Email, body.Password)
	if err != nil {
		writeServiceError(w, r, "auth.login", err)
		return
	}
	httpx.JSON(w, http.StatusOK, resp)
}

func LoginGoogle(w http.ResponseWriter, r *http.Request) {
	var body googleBody
	if err := httpx.DecodeJSON(r, &body); err != nil || strings.TrimSpace(body.IDToken) == "" {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "idToken is required.")
		return
	}
	resp, err := common.Auth.LoginGoogle(r.Context(), body.IDToken)
	if err != nil {
		writeServiceError(w, r, "auth.google", err)
		return
	}
	httpx.JSON(w, http.StatusOK, resp)
}

func Refresh(w http.ResponseWriter, r *http.Request) {
	var body refreshBody
	if err := httpx.DecodeJSON(r, &body); err != nil || body.RefreshToken == "" {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "refreshToken is required.")
		return
	}
	resp, err := common.Auth.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		writeServiceError(w, r, "auth.refresh", err)
		return
	}
	httpx.JSON(w, http.StatusOK, resp)
}

func Logout(w http.ResponseWriter, r *http.Request) {
	var body refreshBody
	if err := httpx.DecodeJSON(r, &body); err != nil || body.RefreshToken == "" {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "refreshToken is required.")
		return
	}
	_ = common.Auth.Logout(r.Context(), body.RefreshToken)
	w.WriteHeader(http.StatusNoContent)
}

func validateCredentials(email, password string) string {
	email = strings.TrimSpace(email)
	if email == "" || !strings.Contains(email, "@") {
		return "Please enter a valid email."
	}
	if len(password) < 6 {
		return "Password must be at least 6 characters."
	}
	return ""
}
