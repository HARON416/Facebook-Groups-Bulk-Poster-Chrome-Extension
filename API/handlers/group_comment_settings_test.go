package handlers

import (
	"context"
	"encoding/json"
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

type fakeCommentSettingsStore struct {
	db.Querier
	userID   pgtype.UUID
	settings db.GroupCommentSetting
	exists   bool
	err      error
	writes   int
}

func (s *fakeCommentSettingsStore) GetGroupCommentSettings(_ context.Context, userID pgtype.UUID) (db.GroupCommentSetting, error) {
	s.userID = userID
	if s.err != nil {
		return db.GroupCommentSetting{}, s.err
	}
	if !s.exists {
		return db.GroupCommentSetting{}, pgx.ErrNoRows
	}
	return s.settings, nil
}

func (s *fakeCommentSettingsStore) CreateGroupCommentSettings(_ context.Context, p db.CreateGroupCommentSettingsParams) error {
	s.userID = p.UserID
	s.writes++
	if s.err != nil {
		return s.err
	}
	if !s.exists {
		s.settings = db.GroupCommentSetting{UserID: p.UserID, Enabled: p.Enabled, Options: p.Options}
		s.exists = true
	}
	return nil
}

func (s *fakeCommentSettingsStore) UpsertGroupCommentSettings(_ context.Context, p db.UpsertGroupCommentSettingsParams) (db.GroupCommentSetting, error) {
	s.userID = p.UserID
	s.writes++
	s.settings = db.GroupCommentSetting{UserID: p.UserID, Enabled: p.Enabled, Options: p.Options}
	s.exists = true
	return s.settings, s.err
}

func commentSettingsRequest(method, body string, userID pgtype.UUID) *http.Request {
	r := httptest.NewRequest(method, "/api/group-comment-settings", strings.NewReader(body))
	return r.WithContext(context.WithValue(r.Context(), currentUserContextKey, db.User{ID: userID}))
}

func TestCommentSettingsRoundTripUsesAuthenticatedUser(t *testing.T) {
	userID := pgtype.UUID{Bytes: [16]byte{8}, Valid: true}
	store := &fakeCommentSettingsStore{}
	handler := &APIHandler{store: store}
	body := `{"enabled":true,"options":["First 🚗","", "Third"]}`
	saved := httptest.NewRecorder()
	handler.SaveGroupCommentSettings(saved, commentSettingsRequest(http.MethodPut, body, userID))
	if saved.Code != http.StatusOK || store.userID != userID {
		t.Fatalf("save status = %d, user = %v, body = %s", saved.Code, store.userID, saved.Body)
	}
	loaded := httptest.NewRecorder()
	handler.GetGroupCommentSettings(loaded, commentSettingsRequest(http.MethodGet, "", userID))
	var payload struct {
		Settings struct {
			Enabled bool     `json:"enabled"`
			Options []string `json:"options"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(loaded.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Settings.Enabled || !reflect.DeepEqual(payload.Settings.Options, []string{"First 🚗", "", "Third"}) {
		t.Fatalf("settings did not preserve order and blanks: %s", loaded.Body)
	}
}

func TestCommentSettingsInitializationPreservesExistingBrowserSettings(t *testing.T) {
	store := &fakeCommentSettingsStore{exists: true, settings: db.GroupCommentSetting{Options: []string{"Already saved"}}}
	response := httptest.NewRecorder()
	(&APIHandler{store: store}).SaveGroupCommentSettings(response, commentSettingsRequest(http.MethodPost,
		`{"enabled":true,"options":["Old local comment"]}`, pgtype.UUID{Valid: true}))
	if response.Code != http.StatusOK || store.settings.Enabled || store.settings.Options[0] != "Already saved" {
		t.Fatalf("initialization overwrote cloud settings: %s", response.Body)
	}
}

func TestCommentSettingsMissingAndStorageError(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
	}{
		{"missing", nil, http.StatusOK},
		{"storage error", errors.New("unavailable"), http.StatusInternalServerError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeCommentSettingsStore{err: tc.err}
			response := httptest.NewRecorder()
			(&APIHandler{store: store}).GetGroupCommentSettings(response, commentSettingsRequest(http.MethodGet, "", pgtype.UUID{Valid: true}))
			if response.Code != tc.status {
				t.Fatalf("status = %d", response.Code)
			}
			if tc.err == nil && !strings.Contains(response.Body.String(), `"settings":null`) {
				t.Fatal(response.Body.String())
			}
		})
	}
}

func TestCommentSettingsRejectsInvalidPayloadWithoutWriting(t *testing.T) {
	tooMany, _ := json.Marshal(map[string]any{"enabled": true, "options": make([]string, 51)})
	tooLong, _ := json.Marshal(map[string]any{"enabled": true, "options": []string{strings.Repeat("🚗", 10001)}})
	for _, body := range []string{
		`{}`, `{"enabled":true}`, `{"enabled":true,"options":null}`,
		`{"enabled":true,"options":[12]}`, `{"enabled":true,"options":[],"user_id":"someone-else"}`,
		`{"enabled":true,"options":[]} {}`, `{"enabled":true,"options":[]} trailing`,
		string(tooMany), string(tooLong),
	} {
		store := &fakeCommentSettingsStore{}
		response := httptest.NewRecorder()
		(&APIHandler{store: store}).SaveGroupCommentSettings(response, commentSettingsRequest(http.MethodPut, body, pgtype.UUID{Valid: true}))
		if response.Code != http.StatusBadRequest || store.writes != 0 {
			t.Fatalf("invalid payload status = %d, writes = %d", response.Code, store.writes)
		}
	}
}
