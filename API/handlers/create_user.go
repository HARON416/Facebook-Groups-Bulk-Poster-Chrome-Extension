package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/password"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5/pgconn"
)

func (h *APIHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeCredentialsRequest(w, r)
	if !ok {
		return
	}

	passwordHash, err := password.HashPassword(req.Password)
	if err != nil {
		utils.Errorf("hash password: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create user")
		return
	}

	user, err := h.store.CreateUser(r.Context(), db.CreateUserParams{
		Email:        req.Email,
		PasswordHash: passwordHash,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			utils.WriteError(w, http.StatusConflict, "user with this email already exists")
			return
		}

		utils.Errorf("create user: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create user")
		return
	}

	response, err := buildAuthResponse(user)
	if err != nil {
		utils.Errorf("create token: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create user token")
		return
	}

	utils.WriteJSON(w, http.StatusCreated, response)
}

func decodeJSONBody(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}
