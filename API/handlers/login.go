package handlers

import (
	"errors"
	"net/http"
	"strings"

	"facebook-groups-bulk-poster-api/password"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *APIHandler) Login(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeCredentialsRequest(w, r)
	if !ok {
		return
	}

	user, err := h.store.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			utils.WriteError(w, http.StatusUnauthorized, "invalid email or password")
			return
		}

		utils.Errorf("get user by email: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to log in")
		return
	}

	if !password.CompareHash(req.Password, user.PasswordHash) {
		utils.WriteError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	response, err := buildAuthResponse(user)
	if err != nil {
		utils.Errorf("create login token: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create login token")
		return
	}

	utils.WriteJSON(w, http.StatusOK, response)
}

func decodeCredentialsRequest(w http.ResponseWriter, r *http.Request) (loginRequest, bool) {
	var req loginRequest
	if err := decodeJSONBody(r, &req); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid request body")
		return loginRequest{}, false
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Password = strings.TrimSpace(req.Password)

	switch {
	case req.Email == "":
		utils.WriteError(w, http.StatusBadRequest, "email is required")
		return loginRequest{}, false
	case req.Password == "":
		utils.WriteError(w, http.StatusBadRequest, "password is required")
		return loginRequest{}, false
	case len(req.Password) < 8:
		utils.WriteError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return loginRequest{}, false
	}

	return req, true
}
