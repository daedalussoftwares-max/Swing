package controllers

import (
	"errors"
	"net/http"

	"serving/app/cmd/common"
	"serving/app/cmd/notifications"
	"serving/app/pkg/httpx"
	"serving/web/middlewares/bearer"
)

func ListNotifications(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	items, err := common.Notifications.List(r.Context(), accountID, 50)
	if err != nil {
		writeServiceError(w, r, "notifications.list", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"notifications": items})
}

func MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	id, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid notification id.")
		return
	}
	if err := common.Notifications.MarkRead(r.Context(), accountID, id); err != nil {
		if errors.Is(err, notifications.ErrNotFound) {
			httpx.Error(w, r, http.StatusNotFound, "NOT_FOUND", "Notification not found.")
			return
		}
		writeServiceError(w, r, "notifications.read", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func MarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	if err := common.Notifications.MarkAllRead(r.Context(), accountID); err != nil {
		writeServiceError(w, r, "notifications.read_all", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
