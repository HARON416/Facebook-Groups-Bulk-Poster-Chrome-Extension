package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const authSessionLifetime = 7 * 24 * time.Hour

type authContextKey string

const (
	currentUserContextKey        authContextKey = "current_user"
	currentSessionHashContextKey authContextKey = "current_session_hash"
)

type googleTokenInfo struct {
	Audience  string          `json:"audience"`
	Aud       string          `json:"aud"`
	IssuedTo  string          `json:"issued_to"`
	UserID    string          `json:"user_id"`
	ExpiresIn json.RawMessage `json:"expires_in"`
	Error     string          `json:"error"`
	ErrorDesc string          `json:"error_description"`
}

type googleUserInfo struct {
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

type authenticatedUserResponse struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	DisplayName   string `json:"display_name,omitempty"`
	AvatarURL     string `json:"avatar_url,omitempty"`
	AccessTier    string `json:"access_tier"`
	Timezone      string `json:"timezone"`
}

type googleAuthPayload struct {
	Timezone string `json:"timezone"`
}

type googleAuthResponse struct {
	SessionToken string                     `json:"session_token"`
	ExpiresAt    time.Time                  `json:"expires_at"`
	User         authenticatedUserResponse  `json:"user"`
	Access       accessEntitlementsResponse `json:"access"`
}

func (h *APIHandler) AuthenticateGoogle(w http.ResponseWriter, r *http.Request) {
	googleToken, ok := bearerToken(r)
	if !ok {
		utils.WriteError(w, http.StatusUnauthorized, "Google access token is required")
		return
	}
	var payload googleAuthPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		utils.WriteError(w, http.StatusBadRequest, "invalid Google authentication request")
		return
	}
	timezone := normalizeUserTimezone(payload.Timezone)

	profile, err := h.verifyGoogleAccessToken(r.Context(), googleToken)
	if err != nil {
		utils.Errorf("verify Google access token: %v", err)
		utils.WriteError(w, http.StatusUnauthorized, "Google authentication failed")
		return
	}

	user, err := h.store.UpsertGoogleUser(r.Context(), db.UpsertGoogleUserParams{
		GoogleSubject: profile.Subject,
		Email:         strings.TrimSpace(profile.Email),
		EmailVerified: profile.EmailVerified,
		DisplayName:   nullableText(profile.Name),
		AvatarUrl:     nullableText(profile.Picture),
		Timezone:      timezone,
	})
	if err != nil {
		utils.Errorf("upsert Google user: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create user session")
		return
	}
	user = h.refreshExpiredProAccess(r.Context(), user)
	_ = h.store.DeleteExpiredAuthSessions(r.Context())

	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		utils.Errorf("generate auth session: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create user session")
		return
	}
	expiresAt := time.Now().UTC().Add(authSessionLifetime)
	if _, err := h.store.CreateAuthSession(r.Context(), db.CreateAuthSessionParams{
		UserID:    user.ID,
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	}); err != nil {
		utils.Errorf("save auth session: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to create user session")
		return
	}

	access, err := h.accessEntitlements(r.Context(), user)
	if err != nil {
		utils.Errorf("load user access: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "user session created but access could not be loaded")
		return
	}
	utils.WriteJSON(w, http.StatusOK, googleAuthResponse{
		SessionToken: rawToken,
		ExpiresAt:    expiresAt,
		User:         userResponse(user),
		Access:       access,
	})
}

func (h *APIHandler) RequireAuthenticatedUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawToken, ok := bearerToken(r)
		if !ok {
			utils.WriteError(w, http.StatusUnauthorized, "authentication is required")
			return
		}
		tokenHash := hashSessionToken(rawToken)
		session, err := h.store.GetAuthSessionByTokenHash(r.Context(), tokenHash)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				utils.Errorf("load auth session: %v", err)
			}
			utils.WriteError(w, http.StatusUnauthorized, "session is invalid or expired")
			return
		}
		user, err := h.store.GetUserByID(r.Context(), session.UserID)
		if err != nil {
			utils.WriteError(w, http.StatusUnauthorized, "user account is unavailable")
			return
		}
		user = h.refreshExpiredProAccess(r.Context(), user)
		_ = h.store.TouchAuthSession(r.Context(), session.ID)
		ctx := context.WithValue(r.Context(), currentUserContextKey, user)
		ctx = context.WithValue(ctx, currentSessionHashContextKey, tokenHash)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h *APIHandler) CurrentUser(w http.ResponseWriter, r *http.Request) {
	user, ok := currentUser(r.Context())
	if !ok {
		utils.WriteError(w, http.StatusUnauthorized, "authentication is required")
		return
	}
	access, err := h.accessEntitlements(r.Context(), user)
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to load account access")
		return
	}
	utils.WriteJSON(w, http.StatusOK, map[string]any{
		"user":   userResponse(user),
		"access": access,
	})
}

func (h *APIHandler) Logout(w http.ResponseWriter, r *http.Request) {
	tokenHash, _ := r.Context().Value(currentSessionHashContextKey).(string)
	if tokenHash != "" {
		if err := h.store.DeleteAuthSessionByTokenHash(r.Context(), tokenHash); err != nil {
			utils.WriteError(w, http.StatusInternalServerError, "unable to end session")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) verifyGoogleAccessToken(ctx context.Context, token string) (googleUserInfo, error) {
	tokenInfoRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://oauth2.googleapis.com/tokeninfo", nil)
	if err != nil {
		return googleUserInfo{}, err
	}
	tokenInfoQuery := tokenInfoRequest.URL.Query()
	tokenInfoQuery.Set("access_token", token)
	tokenInfoRequest.URL.RawQuery = tokenInfoQuery.Encode()
	tokenInfoResponse, err := h.httpClient.Do(tokenInfoRequest)
	if err != nil {
		return googleUserInfo{}, sanitizedGoogleRequestError("Google token verification request", err)
	}
	defer tokenInfoResponse.Body.Close()
	var tokenInfo googleTokenInfo
	if err := json.NewDecoder(tokenInfoResponse.Body).Decode(&tokenInfo); err != nil {
		return googleUserInfo{}, err
	}
	if tokenInfoResponse.StatusCode != http.StatusOK || tokenInfo.Error != "" {
		return googleUserInfo{}, fmt.Errorf("Google token verification rejected with HTTP %d", tokenInfoResponse.StatusCode)
	}
	audience := firstNonEmpty(tokenInfo.Audience, tokenInfo.Aud, tokenInfo.IssuedTo)
	if audience != strings.TrimSpace(h.config.GoogleOAuthClientID) {
		return googleUserInfo{}, errors.New("Google token audience does not match this extension")
	}
	if !hasPositiveJSONInteger(tokenInfo.ExpiresIn) {
		return googleUserInfo{}, errors.New("Google token has expired")
	}

	profileRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://openidconnect.googleapis.com/v1/userinfo", nil)
	if err != nil {
		return googleUserInfo{}, err
	}
	profileRequest.Header.Set("Authorization", "Bearer "+token)
	profileResponse, err := h.httpClient.Do(profileRequest)
	if err != nil {
		return googleUserInfo{}, sanitizedGoogleRequestError("Google user profile request", err)
	}
	defer profileResponse.Body.Close()
	if profileResponse.StatusCode != http.StatusOK {
		return googleUserInfo{}, fmt.Errorf("userinfo rejected with HTTP %d", profileResponse.StatusCode)
	}
	var profile googleUserInfo
	if err := json.NewDecoder(profileResponse.Body).Decode(&profile); err != nil {
		return googleUserInfo{}, err
	}
	if strings.TrimSpace(profile.Subject) == "" || strings.TrimSpace(profile.Email) == "" || !profile.EmailVerified {
		return googleUserInfo{}, errors.New("Google account is missing a verified identity")
	}
	if tokenInfo.UserID != "" && tokenInfo.UserID != profile.Subject {
		return googleUserInfo{}, errors.New("Google token and user profile do not match")
	}
	return profile, nil
}

func sanitizedGoogleRequestError(operation string, err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return fmt.Errorf("%s: %w", operation, context.Canceled)
	case errors.Is(err, context.DeadlineExceeded):
		return fmt.Errorf("%s: %w", operation, context.DeadlineExceeded)
	default:
		return fmt.Errorf("%s failed", operation)
	}
}

func hasPositiveJSONInteger(raw json.RawMessage) bool {
	var number int64
	if json.Unmarshal(raw, &number) == nil {
		return number > 0
	}
	var text string
	if json.Unmarshal(raw, &text) != nil {
		return false
	}
	number, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	return err == nil && number > 0
}

func currentUser(ctx context.Context) (db.User, bool) {
	user, ok := ctx.Value(currentUserContextKey).(db.User)
	return user, ok
}

func userResponse(user db.User) authenticatedUserResponse {
	return authenticatedUserResponse{
		ID:            formatUUID(user.ID),
		Email:         user.Email,
		EmailVerified: user.EmailVerified,
		DisplayName:   textString(user.DisplayName),
		AvatarURL:     textString(user.AvatarUrl),
		AccessTier:    effectiveAccessTier(user, time.Now()),
		Timezone:      normalizeUserTimezone(user.Timezone),
	}
}

func (h *APIHandler) refreshExpiredProAccess(ctx context.Context, user db.User) db.User {
	if normalizedAccessTier(user.AccessTier) != accessTierPro ||
		effectiveAccessTier(user, time.Now()) == accessTierPro {
		return user
	}
	updated, err := h.store.ExpireProAccess(ctx, user.ID)
	if err == nil {
		return updated
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if current, loadErr := h.store.GetUserByID(ctx, user.ID); loadErr == nil {
			return current
		}
	}
	utils.Errorf("expire Pro access: %v", err)
	// Enforcement must not depend on the cleanup write succeeding.
	user.AccessTier = accessTierFree
	user.ProExpiresAt = pgtype.Timestamptz{}
	user.ProGrantedAt = pgtype.Timestamptz{}
	user.ProGrantNote = pgtype.Text{}
	return user
}

func normalizeUserTimezone(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return "UTC"
	}
	if _, err := time.LoadLocation(value); err != nil {
		return "UTC"
	}
	return value
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
	return token, token != ""
}

func newSessionToken() (string, string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(bytes)
	return raw, hashSessionToken(raw), nil
}

func hashSessionToken(raw string) string {
	digest := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(digest[:])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
