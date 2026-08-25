package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/internal/entitlements"
	"facebook-groups-bulk-poster-api/internal/postgres"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5/pgtype"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "access:", err)
		os.Exit(1)
	}
}

func run() error {
	email := flag.String("email", "", "Google account email to update")
	days := flag.Int("days", 0, "temporary Pro term in consecutive 24-hour periods")
	lifetime := flag.Bool("lifetime", false, "grant lifetime Pro")
	revoke := flag.Bool("revoke", false, "revoke Pro access")
	note := flag.String("note", "", "optional internal grant note")
	configDir := flag.String("config-dir", ".", "directory containing .env")
	flag.Parse()

	*email = strings.TrimSpace(*email)
	if *email == "" {
		return fmt.Errorf("--email is required")
	}
	actions := 0
	if *days > 0 {
		actions++
	}
	if *lifetime {
		actions++
	}
	if *revoke {
		actions++
	}
	if actions != 1 {
		return fmt.Errorf("choose exactly one of --days, --lifetime, or --revoke")
	}
	if *days < 0 {
		return fmt.Errorf("--days must be greater than zero")
	}

	config, err := utils.LoadConfig(*configDir)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	ctx := context.Background()
	pool, err := postgres.NewPoolFromConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer pool.Close()
	queries := db.New(pool)
	user, err := queries.GetUserByEmail(ctx, *email)
	if err != nil {
		return fmt.Errorf("find user: %w", err)
	}

	switch {
	case *lifetime:
		_, err = queries.GrantLifetimePro(ctx, db.GrantLifetimeProParams{
			ID: user.ID, ProGrantNote: strings.TrimSpace(*note),
		})
		if err == nil {
			fmt.Printf("Granted lifetime Pro to %s.\n", user.Email)
		}
	case *revoke:
		_, err = queries.RevokePro(ctx, user.ID)
		if err == nil {
			fmt.Printf("Revoked Pro access for %s.\n", user.Email)
		}
	default:
		var expiresAt time.Time
		expiresAt, err = entitlements.TemporaryProExpiry(time.Now(), *days)
		if err == nil {
			_, err = queries.GrantTemporaryPro(ctx, db.GrantTemporaryProParams{
				ID:           user.ID,
				ProExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
				ProGrantNote: strings.TrimSpace(*note),
			})
		}
		if err == nil {
			fmt.Printf("Granted Pro to %s through %s (%s).\n", user.Email, expiresAt.In(mustLocation(user.Timezone)).Format(time.RFC1123), user.Timezone)
		}
	}
	if err != nil {
		return fmt.Errorf("update access: %w", err)
	}
	return nil
}

func mustLocation(name string) *time.Location {
	location, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return location
}
