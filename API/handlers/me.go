package handlers

import (
	"errors"
	"net/http"

	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
)

func (h *APIHandler) Me(w http.ResponseWriter, r *http.Request) {
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

		utils.Errorf("get current user: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to load current user")
		return
	}

	utils.WriteJSON(w, http.StatusOK, authUserResponse{
		ID:        user.ID,
		Email:     user.Email,
		CreatedAt: user.CreatedAt.Time,
	})
}
