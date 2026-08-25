package main

import (
	"context"
	"net/http"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/handlers"
	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/internal/postgres"
	"facebook-groups-bulk-poster-api/router"
	"facebook-groups-bulk-poster-api/storage"
	"facebook-groups-bulk-poster-api/utils"
)

func main() {
	config, err := utils.LoadConfig(".")
	if err != nil {
		utils.Errorf("load config: %v", err)
		return
	}
	utils.Infof("loaded %s", config.Summary())
	if strings.TrimSpace(config.GoogleOAuthClientID) == "" {
		utils.Errorf("GOOGLE_OAUTH_CLIENT_ID is required")
		return
	}
	if len(strings.TrimSpace(config.AdminAPIKey)) < 32 {
		utils.Errorf("ADMIN_API_KEY must contain at least 32 characters")
		return
	}
	if len(strings.TrimSpace(config.FacebookActorHMACKey)) < 32 {
		utils.Errorf("FACEBOOK_ACTOR_HMAC_KEY must contain at least 32 characters")
		return
	}

	ctx := context.Background()
	pool, err := postgres.NewPoolFromConfig(ctx, config)
	if err != nil {
		utils.Errorf("connect database: %v", err)
		return
	}
	defer pool.Close()

	objectStorage, err := storage.NewBunnyService(config)
	if err != nil {
		utils.Errorf("configure Bunny storage: %v", err)
		return
	}

	store := db.New(pool)
	apiHandler := handlers.NewAPIHandler(store, pool, objectStorage, config)

	r := router.Router(apiHandler)

	server := &http.Server{
		Addr:              config.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	utils.Infof("server listening on %s", config.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		utils.Errorf("server error: %v", err)
		return
	}
}
