package controllers

import (
	"errors"
	"net/http"
	"strings"

	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
	"serving/app/pkg/r2storage"
	"serving/web/middlewares/bearer"
)

type chatUploadURLBody struct {
	ChatID      string `json:"chatId"`
	ContentType string `json:"contentType"`
}

type mediaReadURLBody struct {
	MediaKey string `json:"mediaKey"`
}

func ChatUploadURL(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	if !requireR2(w, r) {
		return
	}

	var body chatUploadURLBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	chatID := strings.TrimSpace(body.ChatID)
	if chatID == "" {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "chatId is required.")
		return
	}

	slot, err := common.R2.PresignChatPut(r.Context(), accountID, chatID, body.ContentType)
	if err != nil {
		if errors.Is(err, r2storage.ErrInvalidMIME) {
			httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Use a JPEG, PNG, WebP image or audio clip.")
			return
		}
		writeServiceError(w, r, "media.chat_upload_url", err)
		return
	}
	httpx.JSON(w, http.StatusOK, slot)
}

func MediaReadURL(w http.ResponseWriter, r *http.Request) {
	_, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	if !requireR2(w, r) {
		return
	}

	var body mediaReadURLBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}

	url, err := common.R2.PresignGet(r.Context(), body.MediaKey)
	if err != nil {
		if errors.Is(err, r2storage.ErrInvalidMediaKey) {
			httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid media key.")
			return
		}
		writeServiceError(w, r, "media.read_url", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"viewUrl": url})
}
