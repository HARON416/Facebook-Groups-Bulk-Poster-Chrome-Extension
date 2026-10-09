package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"unicode/utf8"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
)

type groupCommentSettingsPayload struct {
	Enabled *bool    `json:"enabled"`
	Options []string `json:"options"`
}

func writeGroupCommentSettings(w http.ResponseWriter, settings db.GroupCommentSetting) {
	utils.WriteJSON(w, http.StatusOK, map[string]any{
		"settings": map[string]any{
			"enabled": settings.Enabled,
			"options": emptyIfNil(settings.Options),
		},
	})
}

func (h *APIHandler) GetGroupCommentSettings(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	settings, err := h.store.GetGroupCommentSettings(r.Context(), user.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		utils.WriteJSON(w, http.StatusOK, map[string]any{"settings": nil})
		return
	}
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to load comment settings")
		return
	}
	writeGroupCommentSettings(w, settings)
}

// POST initializes a new account without overwriting settings from another browser.
// PUT replaces the authenticated user's settings.
func (h *APIHandler) SaveGroupCommentSettings(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	var payload groupCommentSettingsPayload
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || payload.Enabled == nil || payload.Options == nil {
		utils.WriteError(w, http.StatusBadRequest, "enabled and comment options are required")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		utils.WriteError(w, http.StatusBadRequest, "invalid comment settings payload")
		return
	}
	if len(payload.Options) > 50 {
		utils.WriteError(w, http.StatusBadRequest, "a maximum of 50 comment options is allowed")
		return
	}
	for _, option := range payload.Options {
		if utf8.RuneCountInString(option) > 10000 {
			utils.WriteError(w, http.StatusBadRequest, "each comment option must be at most 10000 characters")
			return
		}
	}

	var settings db.GroupCommentSetting
	var err error
	if r.Method == http.MethodPost {
		err = h.store.CreateGroupCommentSettings(r.Context(), db.CreateGroupCommentSettingsParams{
			UserID: user.ID, Enabled: *payload.Enabled, Options: payload.Options,
		})
		if err == nil {
			settings, err = h.store.GetGroupCommentSettings(r.Context(), user.ID)
		}
	} else {
		settings, err = h.store.UpsertGroupCommentSettings(r.Context(), db.UpsertGroupCommentSettingsParams{
			UserID: user.ID, Enabled: *payload.Enabled, Options: payload.Options,
		})
	}
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to save comment settings")
		return
	}
	writeGroupCommentSettings(w, settings)
}
