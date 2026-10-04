package httpx

import (
	"encoding/json"
	"net/http"

	"serving/app/pkg/requestid"
)

type APIError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id,omitempty"`
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Error(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	reqID := ""
	if r != nil {
		reqID = requestid.FromContext(r.Context())
		if reqID != "" {
			w.Header().Set(requestid.Header, reqID)
		}
	}
	JSON(w, status, map[string]any{
		"error": APIError{Code: code, Message: message, RequestID: reqID},
	})
}

func DecodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// DecodeJSONLenient allows unknown fields (use for PATCH bodies).
func DecodeJSONLenient(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}
