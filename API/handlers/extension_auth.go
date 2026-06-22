package handlers

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type extensionCodeResponse struct {
	Code      string `json:"code"`
	ExpiresAt any    `json:"expires_at"`
}

type extensionExchangeRequest struct {
	Code string `json:"code"`
}

func (h *APIHandler) GenerateExtensionCode(w http.ResponseWriter, r *http.Request) {
	payload, ok := authPayloadFromContext(r.Context())
	if !ok {
		utils.WriteError(w, http.StatusUnauthorized, "missing auth context")
		return
	}

	user, err := h.store.GetUserByEmail(r.Context(), payload.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			utils.WriteError(w, http.StatusUnauthorized, "user not found")
			return
		}

		utils.Errorf("get user for extension code: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create extension code")
		return
	}

	rawCode, err := utils.GenerateSecureCode(32)
	if err != nil {
		utils.Errorf("generate extension code: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create extension code")
		return
	}

	expiresAt := time.Now().UTC().Add(extensionCodeLifetime)
	codeRecord, err := h.store.CreateExtensionAuthCode(r.Context(), db.CreateExtensionAuthCodeParams{
		UserID:    user.ID,
		CodeHash:  utils.HashTokenValue(rawCode),
		ExpiresAt: toPgTimestamptz(expiresAt),
	})
	if err != nil {
		utils.Errorf("store extension code: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create extension code")
		return
	}

	utils.WriteJSON(w, http.StatusOK, extensionCodeResponse{
		Code:      rawCode,
		ExpiresAt: codeRecord.ExpiresAt.Time,
	})
}

func (h *APIHandler) ExchangeExtensionCode(w http.ResponseWriter, r *http.Request) {
	var req extensionExchangeRequest
	if err := decodeJSONBody(r, &req); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Code = strings.TrimSpace(req.Code)
	if req.Code == "" {
		utils.WriteError(w, http.StatusBadRequest, "code is required")
		return
	}

	codeRecord, err := h.store.ConsumeExtensionAuthCode(r.Context(), utils.HashTokenValue(req.Code))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			utils.WriteError(w, http.StatusUnauthorized, "invalid or expired extension code")
			return
		}

		utils.Errorf("consume extension code: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to exchange extension code")
		return
	}

	user, err := h.store.GetUserByID(r.Context(), codeRecord.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			utils.WriteError(w, http.StatusUnauthorized, "user not found")
			return
		}

		utils.Errorf("get user for extension exchange: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to exchange extension code")
		return
	}

	response, err := buildAuthResponse(user)
	if err != nil {
		utils.Errorf("build extension auth response: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create extension token")
		return
	}

	utils.WriteJSON(w, http.StatusOK, response)
}

func toPgTimestamptz(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{
		Time:  value,
		Valid: true,
	}
}
