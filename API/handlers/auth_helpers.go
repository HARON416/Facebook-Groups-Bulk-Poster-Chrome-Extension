package handlers

import (
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/paseto"
)

const (
	tokenLifetime               = 7 * 24 * time.Hour
	extensionCodeLifetime       = 5 * time.Minute
	tokenPurposeAuth            = "auth"
)

type authUserResponse struct {
	ID        int32  `json:"id"`
	Email     string `json:"email"`
	CreatedAt any    `json:"created_at"`
}

type authResponse struct {
	User      authUserResponse `json:"user"`
	Token     string           `json:"token"`
	ExpiresAt time.Time        `json:"expires_at"`
}

func buildAuthResponse(user db.User) (authResponse, error) {
	issuedAt := time.Now().UTC()
	expiresAt := issuedAt.Add(tokenLifetime)

	token, err := paseto.NewPayload(tokenPurposeAuth, user.ID, user.Email, issuedAt, expiresAt).CreateToken()
	if err != nil {
		return authResponse{}, err
	}

	return authResponse{
		User: authUserResponse{
			ID:        user.ID,
			Email:     user.Email,
			CreatedAt: user.CreatedAt.Time,
		},
		Token:     token,
		ExpiresAt: expiresAt,
	}, nil
}
