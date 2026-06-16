package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/paseto"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

type createUserRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type createUserResponse struct {
	User      createUserUserResponse `json:"user"`
	Token     string                 `json:"token"`
	ExpiresAt time.Time              `json:"expires_at"`
}

type createUserUserResponse struct {
	ID        int32  `json:"id"`
	Email     string `json:"email"`
	CreatedAt any    `json:"created_at"`
}

func (h *APIHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	email := strings.TrimSpace(strings.ToLower(req.Email))
	password := strings.TrimSpace(req.Password)

	switch {
	case email == "":
		utils.WriteError(w, http.StatusBadRequest, "email is required")
		return
	case password == "":
		utils.WriteError(w, http.StatusBadRequest, "password is required")
		return
	case len(password) < 8:
		utils.WriteError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		utils.Errorf("hash password: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create user")
		return
	}

	user, err := h.store.CreateUser(r.Context(), db.CreateUserParams{
		Email:        email,
		PasswordHash: string(passwordHash),
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

	issuedAt := time.Now().UTC()
	expiresAt := issuedAt.Add(7 * 24 * time.Hour)
	token, err := paseto.NewPayload(user.ID, user.Email, issuedAt, expiresAt).CreateToken()
	if err != nil {
		utils.Errorf("create token: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create user token")
		return
	}

	utils.WriteJSON(w, http.StatusCreated, createUserResponse{
		User: createUserUserResponse{
			ID:        user.ID,
			Email:     user.Email,
			CreatedAt: user.CreatedAt.Time,
		},
		Token:     token,
		ExpiresAt: expiresAt,
	})
}
