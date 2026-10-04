package controllers

import (
	"errors"
	"net/http"

	"serving/app/cmd/common"
	"serving/app/cmd/planes"
	"serving/app/pkg/httpx"
	"serving/web/middlewares/bearer"
)

type putLocationBody struct {
	Lat *float64 `json:"lat"`
	Lng *float64 `json:"lng"`
}

// PutMyLocation stores the caller's coarse (~1 km) device location, used by
// the plane radius filter and distance scoring.
func PutMyLocation(w http.ResponseWriter, r *http.Request) {
	accountID, ok := bearer.UserIDFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Not signed in.")
		return
	}
	var body putLocationBody
	if err := httpx.DecodeJSONLenient(r, &body); err != nil || body.Lat == nil || body.Lng == nil {
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_BODY", "Send {lat, lng}.")
		return
	}
	loc, err := common.Planes.UpdateLocation(r.Context(), accountID, *body.Lat, *body.Lng)
	switch {
	case errors.Is(err, planes.ErrInvalidInput):
		httpx.Error(w, r, http.StatusBadRequest, "INVALID_INPUT", "Invalid coordinates.")
		return
	case errors.Is(err, planes.ErrNotFound):
		httpx.Error(w, r, http.StatusNotFound, "NOT_FOUND", "Profile not found.")
		return
	case err != nil:
		writeServiceError(w, r, "planes.location", err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"location": loc})
}
