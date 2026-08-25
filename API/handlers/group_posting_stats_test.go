package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5/pgtype"
)

type fakeGroupPostingStatsStore struct {
	db.Querier
	params db.ListFacebookGroupPostingStatsParams
	stats  []db.FacebookGroupPostingStat
	err    error
}

func (f *fakeGroupPostingStatsStore) ListFacebookGroupPostingStats(_ context.Context, params db.ListFacebookGroupPostingStatsParams) ([]db.FacebookGroupPostingStat, error) {
	f.params = params
	return f.stats, f.err
}

func TestNormalizeFacebookGroupIDs(t *testing.T) {
	got, err := normalizeFacebookGroupIDs([]string{" 12345 ", "67890", "12345"})
	if err != nil {
		t.Fatalf("normalize Group IDs: %v", err)
	}
	if len(got) != 2 || got[0] != "12345" || got[1] != "67890" {
		t.Fatalf("normalized Group IDs = %#v", got)
	}
	if _, err := normalizeFacebookGroupIDs([]string{"not-a-group"}); err == nil {
		t.Fatal("invalid Group ID was accepted")
	}
}

func TestNormalizeFacebookGroupName(t *testing.T) {
	if got := normalizeFacebookGroupName("  Nairobi Sellers  "); got != "Nairobi Sellers" {
		t.Fatalf("normalized Group name = %q", got)
	}
	if got := normalizeFacebookGroupName("   "); got != "" {
		t.Fatalf("blank Group name = %q", got)
	}
}

func TestCreateBalancedGroupPostingPlanUsesCurrentIdentity(t *testing.T) {
	userID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	store := &fakeGroupPostingStatsStore{stats: []db.FacebookGroupPostingStat{
		{GroupID: "12345", GroupName: "Nairobi Sellers", AcceptedCount: 9_000_000_000},
	}}
	secret := "a-secret-with-at-least-32-characters"
	handler := &APIHandler{store: store, config: utils.Config{FacebookActorHMACKey: secret}}
	body := bytes.NewBufferString(`{"facebook_actor_id":"61589104907206","groups":[{"id":"12345","name":"Nairobi Sellers"}],"maximum_posts":2,"failed_group_ids":[],"starter_excluded_group_ids":[]}`)
	request := httptest.NewRequest(http.MethodPost, "/api/group-posting-stats/plan", body)
	request = request.WithContext(context.WithValue(request.Context(), currentUserContextKey, db.User{ID: userID}))
	response := httptest.NewRecorder()

	handler.CreateBalancedGroupPostingPlan(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if store.params.UserID != userID {
		t.Fatalf("query user = %#v, want %#v", store.params.UserID, userID)
	}
	wantHash := hashFacebookActorID(secret, "61589104907206")
	if store.params.ActorHash != wantHash {
		t.Fatalf("actor hash = %q, want %q", store.params.ActorHash, wantHash)
	}
	var payload struct {
		Plan []balancedPostingGroup `json:"plan"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Plan) != 2 || payload.Plan[0].ID != "12345" || payload.Plan[1].ID != "12345" {
		t.Fatalf("plan = %#v", payload.Plan)
	}
}

func TestBuildBalancedPostingPlanPrioritizesCountsAndRepeatsByRound(t *testing.T) {
	groups := []balancedPostingGroup{
		{ID: "10001", Name: "Group A"},
		{ID: "10002", Name: "Group B"},
		{ID: "10003", Name: "Group C"},
	}
	stats := []db.FacebookGroupPostingStat{
		{GroupID: "10001", AcceptedCount: 0},
		{GroupID: "10002", AcceptedCount: 2},
		{GroupID: "10003", AcceptedCount: 5},
	}
	plan := buildBalancedPostingPlan(groups, stats, 5, nil, nil)
	want := []string{"10001", "10002", "10003", "10001", "10002"}
	if len(plan) != len(want) {
		t.Fatalf("plan length = %d, want %d", len(plan), len(want))
	}
	for index, groupID := range want {
		if plan[index].ID != groupID {
			t.Fatalf("plan[%d] = %q, want %q", index, plan[index].ID, groupID)
		}
	}
}

func TestBuildBalancedPostingPlanExcludesFailuresAndRotatesStarter(t *testing.T) {
	groups := []balancedPostingGroup{
		{ID: "10001", Name: "Group A"},
		{ID: "10002", Name: "Group B"},
		{ID: "10003", Name: "Group C"},
	}
	plan := buildBalancedPostingPlan(
		groups,
		nil,
		5,
		[]string{"10003"},
		[]string{"10001"},
	)
	want := []string{"10002", "10001", "10002", "10001", "10002"}
	for index, groupID := range want {
		if plan[index].ID != groupID {
			t.Fatalf("plan[%d] = %q, want %q", index, plan[index].ID, groupID)
		}
	}
}
