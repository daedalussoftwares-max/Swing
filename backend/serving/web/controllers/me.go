package controllers

import (
	"errors"
	"net/http"

	"serving/app/cmd/auth"
	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
	"serving/app/pkg/r2storage"
	"serving/web/middlewares/bearer"
)

type patchMeBody struct {
	Username        *string `json:"username"`
	Name            *string `json:"name"`
	Dob             *string `json:"dob"`
	Gender          *string `json:"gender"`
	Bio             *string `json:"bio"`
	Interests       *string `json:"interests"`
	City            *string `json:"city"`
	Country         *string `json:"country"`
	AvatarURL       *string `json:"avatarUrl"`
	ProfileComplete *bool   `json:"profileComplete"`
}

func Me(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	u, err := common.Auth.GetMe(r.Context(), accountID)
	if err != nil {
		writeServiceError(w, r, "auth.me", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": u})
}

func PatchMe(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	var body patchMeBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	if body.AvatarURL != nil && common.R2 != nil {
		if err := r2storage.ValidateAvatarURL(*body.AvatarURL, common.R2.PublicBaseURL()); err != nil {
			if errors.Is(err, r2storage.ErrInvalidAvatarURL) {
				httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid avatar URL.")
				return
			}
			writeServiceError(w, r, "auth.patch_me.avatar", err)
			return
		}
	}

	u, err := common.Auth.UpdateProfile(r.Context(), accountID, auth.ProfilePatch{
		Username:        body.Username,
		Name:            body.Name,
		Dob:             body.Dob,
		Gender:          body.Gender,
		Bio:             body.Bio,
		Interests:       body.Interests,
		City:            body.City,
		Country:         body.Country,
		AvatarURL:       body.AvatarURL,
		ProfileComplete: body.ProfileComplete,
	})
	if err != nil {
		writeServiceError(w, r, "auth.patch_me", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": u})
}

func DeleteMe(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	if err := common.Auth.DeleteAccount(r.Context(), accountID); err != nil {
		writeServiceError(w, r, "auth.delete_me", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func UsernameAvailable(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	available, err := common.Auth.IsUsernameAvailable(r.Context(), username)
	if err != nil {
		writeServiceError(w, r, "auth.username_available", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"available": available})
}
