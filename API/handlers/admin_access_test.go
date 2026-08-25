package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
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
