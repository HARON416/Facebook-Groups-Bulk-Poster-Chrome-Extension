package handlers

import (
	"testing"
	"time"
)

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
