package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5/pgtype"
)

type fakeAdminAccessStore struct {
	user            db.User
	temporaryParams db.GrantTemporaryProParams
	lifetimeParams  db.GrantLifetimeProParams
	revokedID       pgtype.UUID
}

type fakeAdminUsersStore struct {
	users []db.User
}

func (f *fakeAdminUsersStore) ListUsers(context.Context) ([]db.User, error) {
	return f.users, nil
}

func (f *fakeAdminAccessStore) GetUserByEmail(context.Context, string) (db.User, error) {
	return f.user, nil
}

func (f *fakeAdminAccessStore) GrantTemporaryPro(_ context.Context, params db.GrantTemporaryProParams) (db.User, error) {
	f.temporaryParams = params
	user := f.user
	user.AccessTier = accessTierPro
	user.ProExpiresAt = params.ProExpiresAt
	return user, nil
}

func (f *fakeAdminAccessStore) GrantLifetimePro(_ context.Context, params db.GrantLifetimeProParams) (db.User, error) {
	f.lifetimeParams = params
	user := f.user
	user.AccessTier = accessTierPro
	user.ProExpiresAt = pgtype.Timestamptz{}
	return user, nil
}

func (f *fakeAdminAccessStore) RevokePro(_ context.Context, id pgtype.UUID) (db.User, error) {
	f.revokedID = id
	user := f.user
	user.AccessTier = accessTierFree
	user.ProExpiresAt = pgtype.Timestamptz{}
	return user, nil
}

func TestRequireAdminAPIKey(t *testing.T) {
	const secret = "an-admin-secret-with-at-least-32-characters"
	handler := &APIHandler{config: utils.Config{AdminAPIKey: secret}}
	protected := handler.RequireAdminAPIKey(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	tests := []struct {
		name          string
		authorization string
		wantStatus    int
	}{
		{name: "missing", wantStatus: http.StatusUnauthorized},
		{name: "wrong", authorization: "Bearer wrong-secret", wantStatus: http.StatusUnauthorized},
		{name: "valid", authorization: "Bearer " + secret, wantStatus: http.StatusNoContent},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/admin/access/temporary", nil)
			if test.authorization != "" {
				request.Header.Set("Authorization", test.authorization)
			}
			response := httptest.NewRecorder()
			protected.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}
}

func TestApplyAdminAccessTemporaryUsesDynamicDays(t *testing.T) {
	userID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	store := &fakeAdminAccessStore{user: db.User{
		ID: userID, Email: "user@example.com", Timezone: "Africa/Nairobi",
	}}
	now := time.Date(2026, time.August, 23, 17, 30, 0, 0, time.UTC)
	_, err := applyAdminAccess(context.Background(), store, adminAccessTemporary, adminAccessPayload{
		Email: "user@example.com", Days: 45, Note: "paid order",
	}, now)
	if err != nil {
		t.Fatalf("applyAdminAccess(): %v", err)
	}
	wantExpiry := time.Date(2026, time.October, 7, 17, 30, 0, 0, time.UTC)
	if !store.temporaryParams.ProExpiresAt.Valid || !store.temporaryParams.ProExpiresAt.Time.Equal(wantExpiry) {
		t.Fatalf("expiry = %v, want %s", store.temporaryParams.ProExpiresAt, wantExpiry)
	}
	if store.temporaryParams.ID != userID || store.temporaryParams.ProGrantNote != "paid order" {
		t.Fatalf("temporary params = %#v", store.temporaryParams)
	}
}

func TestApplyAdminAccessLifetimeAndRevoke(t *testing.T) {
	userID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	store := &fakeAdminAccessStore{user: db.User{
		ID: userID, Email: "user@example.com", Timezone: "UTC",
	}}
	if _, err := applyAdminAccess(context.Background(), store, adminAccessLifetime, adminAccessPayload{
		Email: "user@example.com", Note: "lifetime customer",
	}, time.Now()); err != nil {
		t.Fatalf("grant lifetime: %v", err)
	}
	if store.lifetimeParams.ID != userID || store.lifetimeParams.ProGrantNote != "lifetime customer" {
		t.Fatalf("lifetime params = %#v", store.lifetimeParams)
	}
	if _, err := applyAdminAccess(context.Background(), store, adminAccessRevoke, adminAccessPayload{
		Email: "user@example.com",
	}, time.Now()); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if store.revokedID != userID {
		t.Fatalf("revoked ID = %#v, want %#v", store.revokedID, userID)
	}
}

func TestLoadAdminUsersReturnsSafeEffectiveAccountDetails(t *testing.T) {
	now := time.Date(2026, time.August, 28, 9, 0, 0, 0, time.UTC)
	createdAt := now.Add(-48 * time.Hour)
	updatedAt := now.Add(-time.Hour)
	store := &fakeAdminUsersStore{users: []db.User{
		{
			ID:            pgtype.UUID{Bytes: [16]byte{3}, Valid: true},
			GoogleSubject: "private-google-subject",
			Email:         "pro@example.com",
			EmailVerified: true,
			DisplayName:   pgtype.Text{String: "Pro User", Valid: true},
			AvatarUrl:     pgtype.Text{String: "https://example.com/avatar.jpg", Valid: true},
			AccessTier:    accessTierPro,
			ProGrantedAt:  pgtype.Timestamptz{Time: updatedAt, Valid: true},
			ProGrantNote:  pgtype.Text{String: "Lifetime customer", Valid: true},
			Timezone:      "Africa/Nairobi",
			CreatedAt:     pgtype.Timestamptz{Time: createdAt, Valid: true},
			UpdatedAt:     pgtype.Timestamptz{Time: updatedAt, Valid: true},
		},
	}}

	response, err := loadAdminUsers(context.Background(), store, now)
	if err != nil {
		t.Fatalf("loadAdminUsers(): %v", err)
	}
	if response.Total != 1 || len(response.Users) != 1 {
		t.Fatalf("response counts = total %d, users %d", response.Total, len(response.Users))
	}
	user := response.Users[0]
	if user.Email != "pro@example.com" || user.Tier != accessTierPro || !user.ProLifetime {
		t.Fatalf("user = %#v", user)
	}
	if user.DisplayName != "Pro User" || user.Timezone != "Africa/Nairobi" || user.ProGrantNote != "Lifetime customer" {
		t.Fatalf("user details = %#v", user)
	}
	payload, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	if strings.Contains(string(payload), "private-google-subject") || strings.Contains(string(payload), "google_subject") {
		t.Fatalf("response exposed Google subject: %s", payload)
	}
}

func TestLoadAdminUsersReturnsEmptyArray(t *testing.T) {
	response, err := loadAdminUsers(context.Background(), &fakeAdminUsersStore{}, time.Now())
	if err != nil {
		t.Fatalf("loadAdminUsers(): %v", err)
	}
	if response.Total != 0 || response.Users == nil || len(response.Users) != 0 {
		t.Fatalf("response = %#v", response)
	}
}
