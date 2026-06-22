package handlers

import (
	"context"
	"net/http"
	"strings"

	"facebook-groups-bulk-poster-api/paseto"
	"facebook-groups-bulk-poster-api/utils"
)

type authContextKey string

const authPayloadContextKey authContextKey = "auth_payload"

func (h *APIHandler) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		if header == "" {
			utils.WriteError(w, http.StatusUnauthorized, "authorization header is required")
			return
		}

		const bearerPrefix = "Bearer "
		if !strings.HasPrefix(header, bearerPrefix) {
			utils.WriteError(w, http.StatusUnauthorized, "authorization header must use bearer token")
			return
		}

		token := strings.TrimSpace(strings.TrimPrefix(header, bearerPrefix))
		if token == "" {
			utils.WriteError(w, http.StatusUnauthorized, "bearer token is required")
			return
		}

		payload, err := paseto.VerifyToken(token)
		if err != nil {
			utils.WriteError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		if payload.Purpose != tokenPurposeAuth {
			utils.WriteError(w, http.StatusUnauthorized, "invalid token purpose")
			return
		}

		ctx := context.WithValue(r.Context(), authPayloadContextKey, payload)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func authPayloadFromContext(ctx context.Context) (*paseto.Payload, bool) {
	payload, ok := ctx.Value(authPayloadContextKey).(*paseto.Payload)
	return payload, ok
}
