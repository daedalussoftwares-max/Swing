package controllers

import (
	"errors"
	"net/http"

	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
	"serving/app/pkg/r2storage"
	"serving/web/middlewares/bearer"
)

type avatarUploadURLBody struct {
	ContentType string `json:"contentType"`
}

func AvatarUploadURL(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	if common.R2 == nil {
		httpx.Error(
			w,
			r,
			http.StatusServiceUnavailable,
			"STORAGE_NOT_CONFIGURED",
			"Media upload is not configured on the server.",
		)
		return
	}

	var body avatarUploadURLBody
	_ = httpx.DecodeJSONLenient(r, &body)

	result, err := common.R2.PresignAvatarPut(r.Context(), accountID, body.ContentType)
	if err != nil {
		if errors.Is(err, r2storage.ErrInvalidMIME) {
			httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Use a JPEG, PNG, or WebP image.")
			return
		}
		writeServiceError(w, r, "avatar.upload_url", err)
		return
	}

	httpx.JSON(w, http.StatusOK, result)
}
