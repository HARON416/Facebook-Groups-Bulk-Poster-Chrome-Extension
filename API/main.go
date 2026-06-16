package main

import (
	"context"
	"net/http"
	"time"

	"facebook-groups-bulk-poster-api/handlers"
	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/internal/postgres"
	"facebook-groups-bulk-poster-api/router"
	"facebook-groups-bulk-poster-api/utils"
)

func main() {
	config, err := utils.LoadConfig(".")
	if err != nil {
		utils.Errorf("load config: %v", err)
		return
	}
	utils.Infof("loaded %s", config.Summary())

	ctx := context.Background()
	pool, err := postgres.NewPoolFromConfig(ctx, config)
	if err != nil {
		utils.Errorf("connect database: %v", err)
		return
	}
	defer pool.Close()

	store := db.New(pool)
	apiHandler := handlers.NewAPIHandler(store, pool)

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
