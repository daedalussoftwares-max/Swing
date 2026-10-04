package controllers

import (
	"errors"
	"net/http"
	"strings"

	"lib/stdid"

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
	chatID, err := stdid.Parse(strings.TrimSpace(body.ChatID))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "chatId is required.")
		return
	}
	// Only members may upload into a chat's folder.
	if !common.Chats.IsMember(r.Context(), accountID, chatID) {
		httpx.Error(w, r, http.StatusForbidden, "FORBIDDEN", "You can't access this chat.")
		return
	}

	slot, err := common.R2.PresignChatPut(r.Context(), accountID, chatID.String(), body.ContentType)
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
	accountID, ok := bearer.UserIDFromContext(r.Context())
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

	// Signs only media the caller is allowed to see (chat member with a
	// visible message, story friend, own upload). 404 otherwise — don't
	// reveal whether the key exists.
	allowed, err := common.Chats.CanReadMedia(r.Context(), accountID, body.MediaKey)
	if err != nil {
		writeServiceError(w, r, "media.read_url", err)
		return
	}
	if !allowed {
		httpx.Error(w, r, http.StatusNotFound, "NOT_FOUND", "Media not found.")
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
