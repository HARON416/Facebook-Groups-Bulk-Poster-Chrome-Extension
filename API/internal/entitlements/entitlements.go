package entitlements

import (
	"errors"
	"strings"
	"time"
)

const (
	TierFree = "free"
	TierPro  = "pro"
)

func NormalizeTier(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), TierPro) {
		return TierPro
	}
	return TierFree
}

func EffectiveTier(value string, expiresAt time.Time, hasExpiry bool, now time.Time) string {
	if NormalizeTier(value) != TierPro {
		return TierFree
	}
	if hasExpiry && !now.Before(expiresAt) {
		return TierFree
	}
	return TierPro
}

// TemporaryProExpiry returns the exact instant reached after days consecutive
// 24-hour periods from the grant timestamp.
func TemporaryProExpiry(grantedAt time.Time, days int) (time.Time, error) {
	if days <= 0 {
		return time.Time{}, errors.New("days must be greater than zero")
	}
	const maximumDays = int64(^uint64(0)>>1) / int64(24*time.Hour)
	if int64(days) > maximumDays {
		return time.Time{}, errors.New("days is too large")
	}
	return grantedAt.UTC().Add(time.Duration(days) * 24 * time.Hour), nil
}
