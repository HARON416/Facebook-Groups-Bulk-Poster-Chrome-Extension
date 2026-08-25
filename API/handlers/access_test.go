package handlers

import (
	"context"
	"errors"
	"testing"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type fakeFacebookBindingStore struct {
	bindingByUser db.FacebookAccountBinding
	getErr        error
	bound         db.FacebookAccountBinding
	bindErr       error
	touched       db.FacebookAccountBinding
	touchErr      error
}

func (f *fakeFacebookBindingStore) GetFacebookAccountBindingByUser(context.Context, pgtype.UUID) (db.FacebookAccountBinding, error) {
	return f.bindingByUser, f.getErr
}

func (f *fakeFacebookBindingStore) BindFacebookAccountByActorHash(context.Context, db.BindFacebookAccountByActorHashParams) (db.FacebookAccountBinding, error) {
	return f.bound, f.bindErr
}

func (f *fakeFacebookBindingStore) TouchFacebookAccountBinding(context.Context, pgtype.UUID) (db.FacebookAccountBinding, error) {
	return f.touched, f.touchErr
}

func TestNormalizedAccessTier(t *testing.T) {
	tests := []struct {
		value string
		want  string
	}{
		{value: "pro", want: accessTierPro},
		{value: " PRO ", want: accessTierPro},
		{value: "free", want: accessTierFree},
		{value: "", want: accessTierFree},
		{value: "unknown", want: accessTierFree},
	}
	for _, test := range tests {
		if got := normalizedAccessTier(test.value); got != test.want {
			t.Fatalf("normalizedAccessTier(%q) = %q, want %q", test.value, got, test.want)
		}
	}
}

func TestRemainingLimit(t *testing.T) {
	tests := []struct {
		limit int64
		used  int64
		want  int64
	}{
		{limit: 20, used: 0, want: 20},
		{limit: 20, used: 7, want: 13},
		{limit: 20, used: 20, want: 0},
		{limit: 20, used: 25, want: 0},
	}
	for _, test := range tests {
		if got := remainingLimit(test.limit, test.used); got != test.want {
			t.Fatalf("remainingLimit(%d, %d) = %d, want %d", test.limit, test.used, got, test.want)
		}
	}
}

func TestNormalizeFacebookActorID(t *testing.T) {
	tests := []struct {
		value string
		want  string
	}{
		{value: " 61589104907206 ", want: "61589104907206"},
		{value: "12345", want: "12345"},
		{value: "1234", want: ""},
		{value: "61589abc", want: ""},
		{value: "", want: ""},
	}
	for _, test := range tests {
		if got := normalizeFacebookActorID(test.value); got != test.want {
			t.Fatalf("normalizeFacebookActorID(%q) = %q, want %q", test.value, got, test.want)
		}
	}
}

func TestHashFacebookActorIDIsStableAndSeparated(t *testing.T) {
	first := hashFacebookActorID("a-secret-with-at-least-32-characters", "61589104907206")
	if len(first) != 64 {
		t.Fatalf("hash length = %d, want 64", len(first))
	}
	if repeated := hashFacebookActorID("a-secret-with-at-least-32-characters", "61589104907206"); repeated != first {
		t.Fatal("same secret and actor ID produced different hashes")
	}
	if changedActor := hashFacebookActorID("a-secret-with-at-least-32-characters", "61589104907207"); changedActor == first {
		t.Fatal("different actor IDs produced the same hash")
	}
	if changedSecret := hashFacebookActorID("another-secret-with-32-characters", "61589104907206"); changedSecret == first {
		t.Fatal("different secrets produced the same hash")
	}
}

func TestDualIdentityUsageUsesHigherCounter(t *testing.T) {
	if got := dualIdentityUsage(12, 17); got != 17 {
		t.Fatalf("dualIdentityUsage(12, 17) = %d, want 17", got)
	}
	if got := dualIdentityUsage(19, 4); got != 19 {
		t.Fatalf("dualIdentityUsage(19, 4) = %d, want 19", got)
	}
}

func TestResolveFacebookAccountBinding(t *testing.T) {
	userID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	otherUserID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	bindingID := pgtype.UUID{Bytes: [16]byte{3}, Valid: true}
	secret := "a-secret-with-at-least-32-characters"
	actorID := "61589104907206"
	actorHash := hashFacebookActorID(secret, actorID)
	user := db.User{ID: userID}
	handler := &APIHandler{config: utils.Config{FacebookActorHMACKey: secret}}

	t.Run("returns existing matching binding", func(t *testing.T) {
		want := db.FacebookAccountBinding{ID: bindingID, UserID: userID, ActorHash: actorHash}
		store := &fakeFacebookBindingStore{
			bindingByUser: want,
			touched:       want,
		}
		got, err := handler.resolveFacebookAccountBinding(context.Background(), store, user, actorID)
		if err != nil {
			t.Fatalf("resolve binding: %v", err)
		}
		if got != want {
			t.Fatalf("binding = %#v, want %#v", got, want)
		}
	})

	t.Run("rejects different actor for existing Free account", func(t *testing.T) {
		store := &fakeFacebookBindingStore{bindingByUser: db.FacebookAccountBinding{
			ID: bindingID, UserID: userID, ActorHash: hashFacebookActorID(secret, "61589104907207"),
		}}
		_, err := handler.resolveFacebookAccountBinding(context.Background(), store, user, actorID)
		if !errors.Is(err, errFreeAccountFacebookBindingLocked) {
			t.Fatalf("error = %v, want %v", err, errFreeAccountFacebookBindingLocked)
		}
	})

	t.Run("creates an unclaimed actor binding", func(t *testing.T) {
		want := db.FacebookAccountBinding{ID: bindingID, UserID: userID, ActorHash: actorHash}
		store := &fakeFacebookBindingStore{getErr: pgx.ErrNoRows, bound: want}
		got, err := handler.resolveFacebookAccountBinding(context.Background(), store, user, actorID)
		if err != nil {
			t.Fatalf("resolve binding: %v", err)
		}
		if got != want {
			t.Fatalf("binding = %#v, want %#v", got, want)
		}
	})

	t.Run("rejects actor bound to another Google account", func(t *testing.T) {
		store := &fakeFacebookBindingStore{
			getErr: pgx.ErrNoRows,
			bound:  db.FacebookAccountBinding{ID: bindingID, UserID: otherUserID, ActorHash: actorHash},
		}
		_, err := handler.resolveFacebookAccountBinding(context.Background(), store, user, actorID)
		if !errors.Is(err, errFacebookAccountAlreadyLinked) {
			t.Fatalf("error = %v, want %v", err, errFacebookAccountAlreadyLinked)
		}
	})
}

func TestPostingLimitMessage(t *testing.T) {
	if got := postingLimitMessage(usageKindGroupPost); got == "" {
		t.Fatal("Group posting limit message is empty")
	}
	if got := postingLimitMessage(usageKindMarketplaceListing); got == "" {
		t.Fatal("Marketplace posting limit message is empty")
	}
}

func TestNormalizeUserTimezone(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  string
	}{
		{name: "IANA timezone", value: "Africa/Nairobi", want: "Africa/Nairobi"},
		{name: "trimmed", value: " America/New_York ", want: "America/New_York"},
		{name: "missing", value: "", want: "UTC"},
		{name: "invalid", value: "Mars/Olympus_Mons", want: "UTC"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeUserTimezone(test.value); got != test.want {
				t.Fatalf("normalizeUserTimezone(%q) = %q, want %q", test.value, got, test.want)
			}
		})
	}
}

func TestPostingUsageDayWindowUsesLocalMidnight(t *testing.T) {
	now := time.Date(2026, time.August, 22, 12, 0, 0, 0, time.UTC)
	window := postingUsageDayWindow("Africa/Nairobi", now)
	wantStart := time.Date(2026, time.August, 21, 21, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.August, 22, 21, 0, 0, 0, time.UTC)
	if !window.Start.Equal(wantStart) || !window.End.Equal(wantEnd) {
		t.Fatalf("postingUsageDayWindow() = %s to %s, want %s to %s", window.Start, window.End, wantStart, wantEnd)
	}
}

func TestPostingUsageDayWindowHandlesDaylightSavingTime(t *testing.T) {
	now := time.Date(2026, time.March, 8, 16, 0, 0, 0, time.UTC)
	window := postingUsageDayWindow("America/New_York", now)
	wantStart := time.Date(2026, time.March, 8, 5, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, time.March, 9, 4, 0, 0, 0, time.UTC)
	if !window.Start.Equal(wantStart) || !window.End.Equal(wantEnd) {
		t.Fatalf("postingUsageDayWindow() = %s to %s, want %s to %s", window.Start, window.End, wantStart, wantEnd)
	}
	if duration := window.End.Sub(window.Start); duration != 23*time.Hour {
		t.Fatalf("DST calendar day duration = %s, want 23h", duration)
	}
}
