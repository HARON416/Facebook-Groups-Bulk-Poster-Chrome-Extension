package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"facebook-groups-bulk-poster-api/internal/db"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type fakeAdminDeletionStore struct {
	users       []db.User
	lookupErr   error
	deleteErr   error
	deletedRows int64
	email       string
	deletedID   pgtype.UUID
	events      *[]string
}

func (f *fakeAdminDeletionStore) ListUsersByEmailForUpdate(_ context.Context, email string) ([]db.User, error) {
	f.email = email
	return f.users, f.lookupErr
}

func (f *fakeAdminDeletionStore) DeleteUser(_ context.Context, id pgtype.UUID) (int64, error) {
	f.deletedID = id
	*f.events = append(*f.events, "database deletion")
	return f.deletedRows, f.deleteErr
}

type fakeAdminAssetStorage struct {
	directory string
	err       error
	events    *[]string
}

func (f *fakeAdminAssetStorage) DeleteDirectory(_ context.Context, directory string) error {
	f.directory = directory
	*f.events = append(*f.events, "storage deletion")
	return f.err
}

func TestDeleteAdminUser(t *testing.T) {
	id := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	user := db.User{ID: id, Email: "User@example.com"}
	databaseErr := errors.New("database unavailable")
	storageErr := errors.New("Bunny unavailable")
	tests := []struct {
		name                                      string
		users                                     []db.User
		lookupErr, deleteErr, storageErr, wantErr error
		deletedRows                               int64
		wantEvents                                []string
	}{
		{name: "success", users: []db.User{user}, deletedRows: 1, wantEvents: []string{"database deletion", "storage deletion"}},
		{name: "missing", wantErr: pgx.ErrNoRows},
		{name: "ambiguous email", users: []db.User{user, user}, wantErr: errAmbiguousUserEmail},
		{name: "lookup failure", lookupErr: databaseErr, wantErr: databaseErr},
		{name: "invalid ID cannot target users root", users: []db.User{{Email: user.Email}}, wantErr: errors.New("invalid ID")},
		{name: "database failure preserves assets", users: []db.User{user}, deleteErr: databaseErr, wantErr: databaseErr, wantEvents: []string{"database deletion"}},
		{name: "unexpected row count preserves assets", users: []db.User{user}, wantErr: errors.New("row count"), wantEvents: []string{"database deletion"}},
		{name: "storage failure propagates for rollback", users: []db.User{user}, deletedRows: 1, storageErr: storageErr, wantErr: errUserAssetCleanup, wantEvents: []string{"database deletion", "storage deletion"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var events []string
			store := &fakeAdminDeletionStore{users: tt.users, lookupErr: tt.lookupErr, deleteErr: tt.deleteErr, deletedRows: tt.deletedRows, events: &events}
			assets := &fakeAdminAssetStorage{err: tt.storageErr, events: &events}
			got, err := deleteAdminUser(context.Background(), store, assets, "user@example.com")
			if tt.wantErr == nil && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr != nil && err == nil {
				t.Fatal("expected error")
			}
			if tt.wantErr == pgx.ErrNoRows || tt.wantErr == errAmbiguousUserEmail || tt.wantErr == errUserAssetCleanup || tt.wantErr == databaseErr {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("error = %v, want %v", err, tt.wantErr)
				}
			}
			if !reflect.DeepEqual(events, tt.wantEvents) {
				t.Fatalf("events = %v, want %v", events, tt.wantEvents)
			}
			if assets.directory != "" && assets.directory != "users/01000000-0000-0000-0000-000000000000" {
				t.Fatalf("unexpected storage directory: %q", assets.directory)
			}
			if err == nil && (got.ID != id || store.deletedID != id || got.Email != user.Email) {
				t.Fatalf("wrong deleted user: %+v", got)
			}
		})
	}
}

func TestDeleteUserRejectsInvalidPayload(t *testing.T) {
	handler := &APIHandler{}
	for _, body := range []string{`{}`, `{"email":"  "}`, `{"email":123}`, `{"email":"user@example.com","unexpected":true}`, `invalid`} {
		request := httptest.NewRequest(http.MethodDelete, "/api/admin/users", strings.NewReader(body))
		response := httptest.NewRecorder()
		handler.DeleteUser(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400", body, response.Code)
		}
	}
}

func TestAdminDeletionPayloadAcceptsCurlJSON(t *testing.T) {
	request := httptest.NewRequest(http.MethodDelete, "/api/admin/users", strings.NewReader(`{"email":"nicesharon141@gmail.com"}`))
	request.Header.Set("Content-Type", "application/json")
	var payload adminDeleteUserPayload
	if err := decodeJSONBody(request, &payload); err != nil {
		t.Fatalf("valid curl payload rejected: %v", err)
	}
	if payload.Email != "nicesharon141@gmail.com" {
		t.Fatalf("unexpected email: %q", payload.Email)
	}
}

func TestDeleteUserReportsBodyParsingFailure(t *testing.T) {
	for _, tt := range []struct {
		body, wantMessage string
	}{
		{body: "", wantMessage: "JSON request body is required"},
		{body: `{"email":`, wantMessage: "unexpected EOF"},
		{body: `{"email":42}`, wantMessage: "cannot unmarshal number"},
	} {
		request := httptest.NewRequest(http.MethodDelete, "/api/admin/users", strings.NewReader(tt.body))
		response := httptest.NewRecorder()
		(&APIHandler{}).DeleteUser(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), tt.wantMessage) {
			t.Fatalf("body %q: status %d, response %s", tt.body, response.Code, response.Body.String())
		}
	}
}
