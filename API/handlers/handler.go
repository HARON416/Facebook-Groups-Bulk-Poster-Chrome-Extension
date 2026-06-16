package handlers

import (
	"facebook-groups-bulk-poster-api/internal/db"

	"github.com/jackc/pgx/v5/pgxpool"
)

type APIHandler struct {
	store db.Querier
	pool  *pgxpool.Pool
}

func NewAPIHandler(store db.Querier, pool *pgxpool.Pool) *APIHandler {
	return &APIHandler{
		store: store,
		pool:  pool,
	}
}

func emptyIfNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}

	return items
}
