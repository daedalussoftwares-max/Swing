package controllers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"lib/stdid"

	"serving/app/cmd/chats"
	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
	"serving/app/pkg/logx"
	"serving/web/middlewares/bearer"
)

type sendMessageBody struct {
	Text        string           `json:"text"`
	ClientMsgID string           `json:"client_msg_id"`
	Type        string           `json:"type"`
	Media       *chats.MediaMeta `json:"media"`
	ReplyToID   string           `json:"reply_to_id"`
	Forwarded   bool             `json:"forwarded"`
	ViewOnce    bool             `json:"view_once"`
}

type markReadBody struct {
	UpToSeq int64 `json:"up_to_seq"`
}

type deliveredBody struct {
	MessageIDs []string `json:"message_ids"`
}

type typingBody struct {
	IsTyping bool `json:"is_typing"`
}

type reactionBody struct {
	Emoji string `json:"emoji"`
}

type editMessageBody struct {
	Body string `json:"body"`
}

func ListChats(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	items, err := common.Chats.List(r.Context(), accountID)
	if err != nil {
		writeChatServiceError(w, r, "chats.list", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"chats": items})
}

func ListChatMessages(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	opts := chats.ListMessagesOpts{Limit: parseIntQuery(r, "limit", 50)}
	if v := strings.TrimSpace(r.URL.Query().Get("before_seq")); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid before_seq.")
			return
		}
		opts.BeforeSeq = &n
	}
	if v := strings.TrimSpace(r.URL.Query().Get("after_seq")); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid after_seq.")
			return
		}
		opts.AfterSeq = &n
	}
	items, err := common.Chats.ListMessages(r.Context(), accountID, chatID, opts)
	if err != nil {
		writeChatServiceError(w, r, "chats.messages", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"messages": items})
}

func SendChatMessage(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	var body sendMessageBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	in := chats.SendInput{
		ClientMsgID: body.ClientMsgID,
		Type:        body.Type,
		Body:        body.Text,
		Media:       body.Media,
		Forwarded:   body.Forwarded,
		ViewOnce:    body.ViewOnce,
	}
	if body.ReplyToID != "" {
		rid, err := stdid.Parse(body.ReplyToID)
		if err != nil {
			httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid reply_to_id.")
			return
		}
		in.ReplyToID = &rid
	}
	msg, err := common.Chats.Send(r.Context(), accountID, chatID, in)
	if err != nil {
		writeChatServiceError(w, r, "chats.send", err)
		return
	}
	logx.Info(
		"chat message sent",
		"chat_id", chatID.String(),
		"message_id", msg.ID.String(),
		"seq", msg.Seq,
		"user_id", accountID.String(),
		"request_id", r.Header.Get("X-Request-Id"),
	)
	httpx.JSON(w, http.StatusCreated, map[string]any{"message": msg})
}

func MarkChatDelivered(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	var body deliveredBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	ids := make([]stdid.UUID, 0, len(body.MessageIDs))
	for _, s := range body.MessageIDs {
		id, err := stdid.Parse(s)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	if err := common.Chats.MarkDelivered(r.Context(), accountID, chatID, ids); err != nil {
		writeChatServiceError(w, r, "chats.delivered", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func MarkChatRead(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	var body markReadBody
	_ = httpx.DecodeJSONLenient(r, &body)
	if err := common.Chats.MarkRead(r.Context(), accountID, chatID, body.UpToSeq); err != nil {
		writeChatServiceError(w, r, "chats.read", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func SetChatReaction(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	messageID, err := stdidParsePath(r.PathValue("mid"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid message id.")
		return
	}
	var body reactionBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	if err := common.Chats.SetReaction(r.Context(), accountID, chatID, messageID, body.Emoji); err != nil {
		writeChatServiceError(w, r, "chats.reaction", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func RemoveChatReaction(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	messageID, err := stdidParsePath(r.PathValue("mid"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid message id.")
		return
	}
	if err := common.Chats.RemoveReaction(r.Context(), accountID, chatID, messageID); err != nil {
		writeChatServiceError(w, r, "chats.reaction", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func EditChatMessage(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	messageID, err := stdidParsePath(r.PathValue("mid"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid message id.")
		return
	}
	var body editMessageBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	msg, err := common.Chats.Edit(r.Context(), accountID, chatID, messageID, body.Body)
	if err != nil {
		writeChatServiceError(w, r, "chats.edit", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"message": msg})
}

func DeleteChatMessage(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	messageID, err := stdidParsePath(r.PathValue("mid"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid message id.")
		return
	}
	scope := r.URL.Query().Get("scope")
	if err := common.Chats.Delete(r.Context(), accountID, chatID, messageID, scope); err != nil {
		writeChatServiceError(w, r, "chats.delete", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func ChatTyping(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	var body typingBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	if err := common.Chats.Typing(r.Context(), accountID, chatID, body.IsTyping); err != nil {
		writeChatServiceError(w, r, "chats.typing", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// OpenViewOnceMessage burns a view-once message and returns its media URL.
func OpenViewOnceMessage(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	messageID, err := stdidParsePath(r.PathValue("mid"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid message id.")
		return
	}
	url, viewedAt, err := common.Chats.OpenViewOnce(r.Context(), accountID, chatID, messageID)
	if err != nil {
		writeChatServiceError(w, r, "chats.view_once", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"url": url, "viewedAt": viewedAt})
}

func PinChat(w http.ResponseWriter, r *http.Request)   { setChatPinned(w, r, true) }
func UnpinChat(w http.ResponseWriter, r *http.Request) { setChatPinned(w, r, false) }

func setChatPinned(w http.ResponseWriter, r *http.Request, pinned bool) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	at, err := common.Chats.SetPinned(r.Context(), accountID, chatID, pinned)
	if err != nil {
		writeChatServiceError(w, r, "chats.pin", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "pinnedAt": at})
}

// DeleteChat removes the conversation for both participants.
func DeleteChat(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	chatID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid chat id.")
		return
	}
	if err := common.Chats.DeleteChat(r.Context(), accountID, chatID); err != nil {
		writeChatServiceError(w, r, "chats.delete_chat", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func RegisterDevice(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	var body struct {
		Token    string `json:"token"`
		Platform string `json:"platform"`
	}
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	if err := common.Chats.RegisterDevice(r.Context(), accountID, body.Token, body.Platform); err != nil {
		writeChatServiceError(w, r, "devices.register", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func parseIntQuery(r *http.Request, key string, def int) int {
	v := strings.TrimSpace(r.URL.Query().Get(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

func writeChatServiceError(w http.ResponseWriter, r *http.Request, op string, err error) {
	switch {
	case errors.Is(err, chats.ErrAlreadyViewed):
		httpx.Error(w, r, http.StatusGone, "ALREADY_VIEWED", "This was view-once and has already been opened.")
	case errors.Is(err, chats.ErrBlocked):
		httpx.Error(w, r, http.StatusForbidden, "BLOCKED", "You blocked this person. Unblock to send messages.")
	case errors.Is(err, chats.ErrForbidden):
		httpx.Error(w, r, http.StatusForbidden, "FORBIDDEN", "You can't access this chat.")
	case errors.Is(err, chats.ErrNotFound):
		httpx.Error(w, r, http.StatusNotFound, "NOT_FOUND", "Chat not found.")
	case errors.Is(err, chats.ErrMessageNotFound):
		httpx.Error(w, r, http.StatusNotFound, "NOT_FOUND", "Message not found.")
	case errors.Is(err, chats.ErrEmptyMessage):
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Write a message first.")
	case errors.Is(err, chats.ErrInvalidInput):
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid message.")
	case errors.Is(err, chats.ErrEditNotAllowed), errors.Is(err, chats.ErrDeleteNotAllowed):
		httpx.Error(w, r, http.StatusForbidden, "FORBIDDEN", "Not allowed.")
	default:
		logx.Error("chats handler error", err, append(logx.RequestAttrs(r), "op", op)...)
		httpx.Error(w, r, http.StatusInternalServerError, "INTERNAL", "Something went wrong. Try again.")
	}
}
