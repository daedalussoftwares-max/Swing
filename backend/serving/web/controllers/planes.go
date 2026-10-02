package controllers

import (
	"errors"
	"net/http"

	"serving/app/cmd/common"
	"serving/app/cmd/planes"
	"serving/app/pkg/httpx"
	"serving/web/middlewares/bearer"
)

type sendPlaneBody struct {
	Message string         `json:"message"`
	Filters planes.Filters `json:"filters"`
}

func SendPlane(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}

	var body sendPlaneBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "INVALID_BODY", "Invalid request body.")
		return
	}

	plane, err := common.Planes.Send(r.Context(), accountID, planes.SendInput{
		Message: body.Message,
		Filters: body.Filters,
	})
	if err != nil {
		writePlaneServiceError(w, r, "planes.send", err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"plane": plane})
}

func ListInboxPlanes(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	items, err := common.Planes.ListInbox(r.Context(), accountID)
	if err != nil {
		writePlaneServiceError(w, r, "planes.inbox", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"planes": items})
}

func ListOutboxPlanes(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	items, err := common.Planes.ListOutbox(r.Context(), accountID)
	if err != nil {
		writePlaneServiceError(w, r, "planes.outbox", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"planes": items})
}

func AcceptPlane(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	planeID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "INVALID_INPUT", "Invalid plane id.")
		return
	}
	plane, err := common.Planes.Accept(r.Context(), accountID, planeID)
	if err != nil {
		writePlaneServiceError(w, r, "planes.accept", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"plane": plane})
}

func RejectPlane(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	planeID, err := stdidParsePath(r.PathValue("id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "INVALID_INPUT", "Invalid plane id.")
		return
	}
	plane, err := common.Planes.Reject(r.Context(), accountID, planeID)
	if err != nil {
		writePlaneServiceError(w, r, "planes.reject", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"plane": plane})
}

func writePlaneServiceError(w http.ResponseWriter, r *http.Request, op string, err error) {
	switch {
	case errors.Is(err, planes.ErrInvalidInput):
		httpx.Error(w, http.StatusBadRequest, "INVALID_INPUT", "Write a message up to 200 characters.")
	case errors.Is(err, planes.ErrNoCandidates):
		httpx.Error(w, http.StatusConflict, "NO_CANDIDATES", "No one matches those filters right now. Try again later.")
	case errors.Is(err, planes.ErrInsufficientPlanes):
		httpx.Error(w, http.StatusConflict, "NO_PLANES", "You're out of planes. Watch an ad or come back later.")
	case errors.Is(err, planes.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "NOT_FOUND", "Plane not found.")
	case errors.Is(err, planes.ErrForbidden):
		httpx.Error(w, http.StatusForbidden, "FORBIDDEN", "You can't act on this plane.")
	case errors.Is(err, planes.ErrExpired):
		httpx.Error(w, http.StatusGone, "EXPIRED", "This plane has expired.")
	default:
		writeServiceError(w, r, op, err)
	}
}
