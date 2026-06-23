package handlers

import (
	"errors"
	"net/http"
	"strings"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type extensionAccessRequest struct {
	InstallID    string `json:"install_id"`
	ActivationID string `json:"activation_id"`
}

type extensionAccessResponse struct {
	Active         bool   `json:"active"`
	AccessType     string `json:"access_type"`
	ActivationID   string `json:"activation_id"`
	TrialExpiresAt any    `json:"trial_expires_at"`
	LifetimeActive bool   `json:"lifetime_active"`
	ActivatedAt    any    `json:"activated_at,omitempty"`
}

type activateLifetimeRequest struct {
	ActivationID string `json:"activation_id"`
	Note         string `json:"note"`
}

func (h *APIHandler) StartExtensionAccess(w http.ResponseWriter, r *http.Request) {
	var req extensionAccessRequest
	if err := decodeJSONBody(r, &req); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.InstallID = strings.TrimSpace(req.InstallID)
	req.ActivationID = normalizeActivationID(req.ActivationID)

	if len(req.InstallID) < 16 {
		utils.WriteError(w, http.StatusBadRequest, "install_id is required")
		return
	}
	if req.ActivationID == "" {
		utils.WriteError(w, http.StatusBadRequest, "activation_id is required")
		return
	}

	access, err := h.store.UpsertExtensionAccess(
		r.Context(),
		db.UpsertExtensionAccessParams{
			InstallIDHash: utils.HashTokenValue(req.InstallID),
			ActivationID:  req.ActivationID,
		},
	)
	if err != nil {
		utils.Errorf("upsert extension access: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to load extension access")
		return
	}

	writeExtensionAccessResponse(w, extensionAccessPayload{
		Active:         access.Active.Bool,
		ActivationID:   access.ActivationID,
		TrialExpiresAt: access.TrialExpiresAt,
		LifetimeActive: access.LifetimeActive,
		ActivatedAt:    access.ActivatedAt,
	})
}

func (h *APIHandler) ActivateLifetimeExtensionAccess(w http.ResponseWriter, r *http.Request) {
	if !h.authorizeAdminRequest(w, r) {
		return
	}

	var req activateLifetimeRequest
	if err := decodeJSONBody(r, &req); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.ActivationID = normalizeActivationID(req.ActivationID)
	req.Note = strings.TrimSpace(req.Note)
	if req.ActivationID == "" {
		utils.WriteError(w, http.StatusBadRequest, "activation_id is required")
		return
	}

	access, err := h.store.ActivateLifetimeExtensionAccess(
		r.Context(),
		db.ActivateLifetimeExtensionAccessParams{
			ActivationID: req.ActivationID,
			AdminNote:    stringToNullableText(req.Note),
		},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			utils.WriteError(w, http.StatusNotFound, "activation id not found")
			return
		}

		utils.Errorf("activate lifetime extension access: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to activate lifetime access")
		return
	}

	writeExtensionAccessResponse(w, extensionAccessPayload{
		Active:         access.Active.Bool,
		ActivationID:   access.ActivationID,
		TrialExpiresAt: access.TrialExpiresAt,
		LifetimeActive: access.LifetimeActive,
		ActivatedAt:    access.ActivatedAt,
	})
}

func (h *APIHandler) authorizeAdminRequest(w http.ResponseWriter, r *http.Request) bool {
	config, err := utils.LoadConfig(".")
	if err != nil {
		utils.Errorf("load config for admin auth: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "admin access is not configured")
		return false
	}

	adminKey := strings.TrimSpace(config.AdminAPIKey)
	if adminKey == "" {
		utils.WriteError(w, http.StatusInternalServerError, "admin access is not configured")
		return false
	}

	const bearerPrefix = "Bearer "
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(header, bearerPrefix) ||
		strings.TrimSpace(strings.TrimPrefix(header, bearerPrefix)) != adminKey {
		utils.WriteError(w, http.StatusUnauthorized, "invalid admin token")
		return false
	}

	return true
}

type extensionAccessPayload struct {
	Active         bool
	ActivationID   string
	TrialExpiresAt pgtype.Timestamptz
	LifetimeActive bool
	ActivatedAt    pgtype.Timestamptz
}

func writeExtensionAccessResponse(w http.ResponseWriter, access extensionAccessPayload) {
	accessType := "expired"
	if access.LifetimeActive {
		accessType = "lifetime"
	} else if access.Active {
		accessType = "trial"
	}

	response := extensionAccessResponse{
		Active:         access.Active,
		AccessType:     accessType,
		ActivationID:   access.ActivationID,
		TrialExpiresAt: access.TrialExpiresAt.Time,
		LifetimeActive: access.LifetimeActive,
	}

	if access.ActivatedAt.Valid {
		response.ActivatedAt = access.ActivatedAt.Time
	}

	utils.WriteJSON(w, http.StatusOK, response)
}

func normalizeActivationID(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func stringToNullableText(value string) pgtype.Text {
	if value == "" {
		return pgtype.Text{}
	}

	return pgtype.Text{
		String: value,
		Valid:  true,
	}
}
