package controllers

import (
	"errors"
	"net/http"

	"serving/app/cmd/auth"
	"serving/app/pkg/httpx"
	"serving/app/pkg/logx"
)

func writeServiceError(w http.ResponseWriter, r *http.Request, op string, err error) {
	attrs := append(logx.RequestAttrs(r), "op", op)

	switch {
	case errors.Is(err, auth.ErrEmailInUse):
		httpx.Error(w, r, http.StatusConflict, "EMAIL_IN_USE", "An account with this email already exists. Try logging in.")
	case errors.Is(err, auth.ErrAccountNotFound):
		httpx.Error(w, r, http.StatusUnauthorized, "USER_NOT_FOUND", "No account with this email. Create one?")
	case errors.Is(err, auth.ErrWrongPassword):
		httpx.Error(w, r, http.StatusUnauthorized, "WRONG_PASSWORD", "Incorrect password.")
	case errors.Is(err, auth.ErrInvalidToken):
		httpx.Error(w, r, http.StatusUnauthorized, "INVALID_TOKEN", "Session expired. Please sign in again.")
	case errors.Is(err, auth.ErrUsernameTaken):
		httpx.Error(w, r, http.StatusConflict, "USERNAME_TAKEN", "That username is already taken.")
	case errors.Is(err, auth.ErrUsernameReserved):
		httpx.Error(w, r, http.StatusBadRequest, "USERNAME_RESERVED", "That username is reserved.")
	case errors.Is(err, auth.ErrUsernameInvalid):
		httpx.Error(w, r, http.StatusBadRequest, "USERNAME_INVALID", "Choose a valid username (3–20 chars, lowercase letters, numbers, underscores).")
	case errors.Is(err, auth.ErrInvalidInput):
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Please check your input and try again.")
	case errors.Is(err, auth.ErrNothingToUpdate):
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Nothing to update.")
	case errors.Is(err, auth.ErrGoogleTokenInvalid):
		httpx.Error(w, r, http.StatusUnauthorized, "GOOGLE_AUTH_FAILED", "Google sign-in failed. Try again.")
	case errors.Is(err, auth.ErrGoogleNotConfigured):
		httpx.Error(w, r, http.StatusServiceUnavailable, "GOOGLE_NOT_CONFIGURED", "Google sign-in is not configured on the server.")
	default:
		logx.Error("auth handler error", err, attrs...)
		httpx.Error(w, r, http.StatusInternalServerError, "INTERNAL", "Something went wrong. Try again.")
	}
}
