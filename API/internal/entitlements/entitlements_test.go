package entitlements

import (
	"testing"
	"time"
)

func TestEffectiveTier(t *testing.T) {
	now := time.Date(2026, time.August, 23, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name      string
		tier      string
		expiresAt time.Time
		hasExpiry bool
		want      string
	}{
		{name: "free", tier: TierFree, want: TierFree},
		{name: "lifetime Pro", tier: TierPro, want: TierPro},
		{name: "temporary Pro active", tier: TierPro, expiresAt: now.Add(time.Second), hasExpiry: true, want: TierPro},
		{name: "temporary Pro expires exactly now", tier: TierPro, expiresAt: now, hasExpiry: true, want: TierFree},
		{name: "temporary Pro expired", tier: TierPro, expiresAt: now.Add(-time.Second), hasExpiry: true, want: TierFree},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := EffectiveTier(test.tier, test.expiresAt, test.hasExpiry, now); got != test.want {
				t.Fatalf("EffectiveTier() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestTemporaryProExpiryUsesExactTwentyFourHourPeriods(t *testing.T) {
	grantedAt := time.Date(2026, time.August, 23, 17, 30, 0, 0, time.UTC)
	got, err := TemporaryProExpiry(grantedAt, 30)
	if err != nil {
		t.Fatalf("TemporaryProExpiry(): %v", err)
	}
	want := time.Date(2026, time.September, 22, 17, 30, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("TemporaryProExpiry() = %s, want %s", got, want)
	}
}

func TestTemporaryProExpiryRemainsExactlyFortyEightHoursAcrossDST(t *testing.T) {
	grantedAt := time.Date(2026, time.March, 7, 17, 0, 0, 0, time.UTC)
	got, err := TemporaryProExpiry(grantedAt, 2)
	if err != nil {
		t.Fatalf("TemporaryProExpiry(): %v", err)
	}
	want := time.Date(2026, time.March, 9, 17, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("TemporaryProExpiry() = %s, want %s", got, want)
	}
}

func TestTemporaryProExpiryRejectsInvalidInput(t *testing.T) {
	if _, err := TemporaryProExpiry(time.Now(), 0); err == nil {
		t.Fatal("zero days was accepted")
	}
}
