package controllers

import (
	"net/http"

	"lib/stdid"

	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
	"serving/web/middlewares/bearer"
)

// GetUserProfile returns another user's public profile.
func GetUserProfile(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	userID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid user id.")
		return
	}
	p, err := common.Chats.PublicProfile(r.Context(), viewerID, userID)
	if err != nil {
		writeChatServiceError(w, r, "users.profile", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": p})
}

func BlockUser(w http.ResponseWriter, r *http.Request) {
	setBlocked(w, r, true)
}

func UnblockUser(w http.ResponseWriter, r *http.Request) {
	setBlocked(w, r, false)
}

func setBlocked(w http.ResponseWriter, r *http.Request, blocked bool) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	userID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid user id.")
		return
	}
	if blocked {
		err = common.Chats.Block(r.Context(), accountID, userID)
	} else {
		err = common.Chats.Unblock(r.Context(), accountID, userID)
	}
	if err != nil {
		writeChatServiceError(w, r, "users.block", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "blocked": blocked})
}

type reportBody struct {
	UserID    string `json:"userId"`
	ChatID    string `json:"chatId"`
	Reason    string `json:"reason"`
	Details   string `json:"details"`
	AlsoBlock bool   `json:"alsoBlock"`
}

// CreateReport files a moderation report (optionally blocking too).
func CreateReport(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	var body reportBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	userID, err := stdidParsePath(body.UserID)
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid user id.")
		return
	}
	var chatID *stdid.UUID
	if body.ChatID != "" {
		if id, err := stdidParsePath(body.ChatID); err == nil {
			chatID = &id
		}
	}
	if err := common.Chats.Report(r.Context(), accountID, userID, chatID, body.Reason, body.Details, body.AlsoBlock); err != nil {
		writeChatServiceError(w, r, "reports.create", err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"ok": true})
}
