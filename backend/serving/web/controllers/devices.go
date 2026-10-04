package controllers

import (
	"net/http"

	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
	"serving/web/middlewares/bearer"
)

// UnregisterDevice handles DELETE /v1/devices {token}: removes the push
// token so a signed-out device stops receiving this account's pushes.
func UnregisterDevice(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	if err := common.Chats.UnregisterDevice(r.Context(), accountID, body.Token); err != nil {
		writeChatServiceError(w, r, "devices.unregister", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
