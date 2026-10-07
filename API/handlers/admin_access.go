package handlers

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/internal/entitlements"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	adminAccessTemporary = "temporary"
	adminAccessLifetime  = "lifetime"
	adminAccessRevoke    = "revoke"
)

type adminAccessPayload struct {
	Email string `json:"email"`
	Days  int    `json:"days,omitempty"`
	Note  string `json:"note,omitempty"`
}

type adminAccessResponse struct {
	Email        string     `json:"email"`
	Tier         string     `json:"tier"`
	Timezone     string     `json:"timezone"`
	ProExpiresAt *time.Time `json:"pro_expires_at,omitempty"`
	ProLifetime  bool       `json:"pro_lifetime"`
}

type adminUserResponse struct {
	ID            string     `json:"id"`
	Email         string     `json:"email"`
	EmailVerified bool       `json:"email_verified"`
	DisplayName   string     `json:"display_name,omitempty"`
	AvatarURL     string     `json:"avatar_url,omitempty"`
	Tier          string     `json:"tier"`
	Timezone      string     `json:"timezone"`
	ProExpiresAt  *time.Time `json:"pro_expires_at,omitempty"`
	ProGrantedAt  *time.Time `json:"pro_granted_at,omitempty"`
	ProGrantNote  string     `json:"pro_grant_note,omitempty"`
	ProLifetime   bool       `json:"pro_lifetime"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type adminUsersResponse struct {
	Users []adminUserResponse `json:"users"`
	Total int                 `json:"total"`
}

type adminAccessStore interface {
	GetUserByEmail(context.Context, string) (db.User, error)
	GrantTemporaryPro(context.Context, db.GrantTemporaryProParams) (db.User, error)
	GrantLifetimePro(context.Context, db.GrantLifetimeProParams) (db.User, error)
	RevokePro(context.Context, pgtype.UUID) (db.User, error)
}

type adminUsersStore interface {
	ListUsers(context.Context) ([]db.User, error)
}

func (h *APIHandler) RequireAdminAPIKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided, ok := bearerToken(r)
		if !ok || !constantTimeSecretEqual(provided, h.config.AdminAPIKey) {
			utils.WriteError(w, http.StatusUnauthorized, "valid administrator credentials are required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func constantTimeSecretEqual(provided, expected string) bool {
	providedHash := sha256.Sum256([]byte(strings.TrimSpace(provided)))
	expectedHash := sha256.Sum256([]byte(strings.TrimSpace(expected)))
	return subtle.ConstantTimeCompare(providedHash[:], expectedHash[:]) == 1
}

func (h *APIHandler) GrantTemporaryPro(w http.ResponseWriter, r *http.Request) {
	h.updateAdminAccess(w, r, adminAccessTemporary)
}

func (h *APIHandler) GrantLifetimePro(w http.ResponseWriter, r *http.Request) {
	h.updateAdminAccess(w, r, adminAccessLifetime)
}

func (h *APIHandler) RevokePro(w http.ResponseWriter, r *http.Request) {
	h.updateAdminAccess(w, r, adminAccessRevoke)
}

func (h *APIHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	response, err := loadAdminUsers(r.Context(), h.store, time.Now())
	if err != nil {
		utils.Errorf("list administrator users: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to load users")
		return
	}
	utils.WriteJSON(w, http.StatusOK, response)
}

func loadAdminUsers(ctx context.Context, store adminUsersStore, now time.Time) (adminUsersResponse, error) {
	users, err := store.ListUsers(ctx)
	if err != nil {
		return adminUsersResponse{}, err
	}
	responses := adminUserResponses(users, now)
	return adminUsersResponse{Users: responses, Total: len(responses)}, nil
}

func adminUserResponses(users []db.User, now time.Time) []adminUserResponse {
	responses := make([]adminUserResponse, 0, len(users))
	for _, user := range users {
		tier := effectiveAccessTier(user, now)
		responses = append(responses, adminUserResponse{
			ID:            formatUUID(user.ID),
			Email:         user.Email,
			EmailVerified: user.EmailVerified,
			DisplayName:   textString(user.DisplayName),
			AvatarURL:     textString(user.AvatarUrl),
			Tier:          tier,
			Timezone:      normalizeUserTimezone(user.Timezone),
			ProExpiresAt:  timestamptzPointer(user.ProExpiresAt),
			ProGrantedAt:  timestamptzPointer(user.ProGrantedAt),
			ProGrantNote:  textString(user.ProGrantNote),
			ProLifetime:   tier == accessTierPro && !user.ProExpiresAt.Valid,
			CreatedAt:     user.CreatedAt.Time.UTC(),
			UpdatedAt:     user.UpdatedAt.Time.UTC(),
		})
	}
	return responses
}

func (h *APIHandler) updateAdminAccess(w http.ResponseWriter, r *http.Request, action string) {
	var payload adminAccessPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid access request")
		return
	}
	payload.Email = strings.TrimSpace(payload.Email)
	payload.Note = strings.TrimSpace(payload.Note)
	if payload.Email == "" {
		utils.WriteError(w, http.StatusBadRequest, "email is required")
		return
	}
	if action == adminAccessTemporary && payload.Days <= 0 {
		utils.WriteError(w, http.StatusBadRequest, "days must be greater than zero")
		return
	}
	if action != adminAccessTemporary && payload.Days != 0 {
		utils.WriteError(w, http.StatusBadRequest, "days is only accepted for temporary Pro access")
		return
	}

	user, err := applyAdminAccess(r.Context(), h.store, action, payload, time.Now())
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			utils.WriteError(w, http.StatusNotFound, "user was not found")
			return
		}
		if errors.Is(err, errInvalidAdminAccessAction) {
			utils.WriteError(w, http.StatusBadRequest, "invalid access action")
			return
		}
		utils.Errorf("update administrator-managed access: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to update user access")
		return
	}
	response := adminAccessResponse{
		Email:        user.Email,
		Tier:         effectiveAccessTier(user, time.Now()),
		Timezone:     normalizeUserTimezone(user.Timezone),
		ProExpiresAt: timestamptzPointer(user.ProExpiresAt),
		ProLifetime:  user.AccessTier == accessTierPro && !user.ProExpiresAt.Valid,
	}
	utils.WriteJSON(w, http.StatusOK, response)
}

var errInvalidAdminAccessAction = errors.New("invalid administrator access action")

func applyAdminAccess(ctx context.Context, store adminAccessStore, action string, payload adminAccessPayload, now time.Time) (db.User, error) {
	user, err := store.GetUserByEmail(ctx, payload.Email)
	if err != nil {
		return db.User{}, err
	}
	switch action {
	case adminAccessTemporary:
		expiresAt, err := entitlements.TemporaryProExpiry(now, payload.Days)
		if err != nil {
			return db.User{}, err
		}
		return store.GrantTemporaryPro(ctx, db.GrantTemporaryProParams{
			ID:           user.ID,
			ProExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
			ProGrantNote: payload.Note,
		})
	case adminAccessLifetime:
		return store.GrantLifetimePro(ctx, db.GrantLifetimeProParams{
			ID: user.ID, ProGrantNote: payload.Note,
		})
	case adminAccessRevoke:
		return store.RevokePro(ctx, user.ID)
	default:
		return db.User{}, errInvalidAdminAccessAction
	}
}
