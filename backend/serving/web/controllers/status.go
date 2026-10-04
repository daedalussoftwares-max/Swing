package controllers

import (
	"context"
	"errors"
	"net/http"

	"serving/app/cmd/common"
	"serving/app/cmd/status"
	"serving/app/pkg/httpx"
	"serving/app/pkg/r2storage"
	"serving/web/middlewares/bearer"
)

type statusUploadURLBody struct {
	ContentType string `json:"contentType"`
}

type statusCreateBody struct {
	MediaKey    string `json:"mediaKey"`
	ContentType string `json:"contentType"`
	Kind        string `json:"kind"`
}

func requireR2(w http.ResponseWriter, r *http.Request) bool {
	if common.R2 == nil {
		httpx.Error(
			w,
			r,
			http.StatusServiceUnavailable,
			"STORAGE_NOT_CONFIGURED",
			"Media upload is not configured on the server.",
		)
		return false
	}
	return true
}

func attachStatusViewURLs(ctx context.Context, items []status.Item) ([]status.Item, error) {
	if common.R2 == nil {
		return items, nil
	}
	out := make([]status.Item, len(items))
	for i, it := range items {
		url, err := common.R2.PresignGet(ctx, it.MediaKey)
		if err != nil {
			return nil, err
		}
		it.ViewURL = url
		out[i] = it
	}
	return out, nil
}

func StatusUploadURL(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	if !requireR2(w, r) {
		return
	}

	var body statusUploadURLBody
	_ = httpx.DecodeJSONLenient(r, &body)

	slot, err := common.R2.PresignStatusPut(r.Context(), accountID, body.ContentType)
	if err != nil {
		if errors.Is(err, r2storage.ErrInvalidMIME) {
			httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Use a JPEG, PNG, WebP image or MP4 video.")
			return
		}
		writeServiceError(w, r, "status.upload_url", err)
		return
	}
	httpx.JSON(w, http.StatusOK, slot)
}

func ListMyStatus(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	items, err := common.Status.ListMine(r.Context(), accountID)
	if err != nil {
		writeServiceError(w, r, "status.list_mine", err)
		return
	}
	items, err = attachStatusViewURLs(r.Context(), items)
	if err != nil {
		writeServiceError(w, r, "status.list_mine.urls", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func ListAccountStatus(w http.ResponseWriter, r *http.Request) {
	viewerID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	accountID, err := stdidParsePath(r.PathValue("accountId"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid account id.")
		return
	}
	items, err := common.Status.ListForAccount(r.Context(), viewerID, accountID)
	if err != nil {
		if errors.Is(err, status.ErrNotFound) {
			httpx.Error(w, r, http.StatusNotFound, "NOT_FOUND", "Not found.")
			return
		}
		writeServiceError(w, r, "status.list_account", err)
		return
	}
	items, err = attachStatusViewURLs(r.Context(), items)
	if err != nil {
		writeServiceError(w, r, "status.list_account.urls", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func CreateStatus(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	var body statusCreateBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}
	item, err := common.Status.Create(r.Context(), accountID, status.CreateInput{
		MediaKey:    body.MediaKey,
		ContentType: body.ContentType,
		Kind:        body.Kind,
	})
	if err != nil {
		if errors.Is(err, status.ErrInvalidInput) {
			httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid status media.")
			return
		}
		writeServiceError(w, r, "status.create", err)
		return
	}
	if common.R2 != nil {
		url, uerr := common.R2.PresignGet(r.Context(), item.MediaKey)
		if uerr == nil {
			item.ViewURL = url
		}
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"item": item})
}

func DeleteStatus(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	itemID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid status id.")
		return
	}
	if err := common.Status.Delete(r.Context(), accountID, itemID); err != nil {
		if errors.Is(err, status.ErrNotFound) {
			httpx.Error(w, r, http.StatusNotFound, "NOT_FOUND", "Status not found.")
			return
		}
		writeServiceError(w, r, "status.delete", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
