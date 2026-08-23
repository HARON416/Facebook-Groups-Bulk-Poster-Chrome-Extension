package handlers

import (
	"context"
	"io"
	"net/http"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/storage"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5/pgxpool"
)

type APIHandler struct {
	store      db.Querier
	pool       *pgxpool.Pool
	storage    objectStorage
	config     utils.Config
	httpClient *http.Client
}

type objectStorage interface {
	Upload(context.Context, string, io.Reader, int64, string) (*storage.UploadResult, error)
	Delete(context.Context, string) error
	DeleteDirectory(context.Context, string) error
}

func NewAPIHandler(store db.Querier, pool *pgxpool.Pool, storage objectStorage, config utils.Config) *APIHandler {
	return &APIHandler{
		store:      store,
		pool:       pool,
		storage:    storage,
		config:     config,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func emptyIfNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}

	return items
}
