package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	errAmbiguousUserEmail = errors.New("multiple users match this email")
	errUserAssetCleanup   = errors.New("unable to delete user assets")
)

type adminUserDeletionStore interface {
	ListUsersByEmailForUpdate(context.Context, string) ([]db.User, error)
	DeleteUser(context.Context, pgtype.UUID) (int64, error)
}

type adminUserAssetStorage interface {
	DeleteDirectory(context.Context, string) error
}

type adminDeleteUserPayload struct {
	Email string `json:"email"`
}

type adminDeleteUserResponse struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Deleted bool   `json:"deleted"`
}

func (h *APIHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	var payload adminDeleteUserPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		if errors.Is(err, io.EOF) {
			utils.WriteError(w, http.StatusBadRequest, "JSON request body is required; provide an email field")
		} else {
			utils.WriteError(w, http.StatusBadRequest, "invalid user deletion request: "+err.Error())
		}
		return
	}
	payload.Email = strings.TrimSpace(payload.Email)
	if payload.Email == "" {
		utils.WriteError(w, http.StatusBadRequest, "email is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		utils.Errorf("begin administrator user deletion: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to delete user")
		return
	}
	defer tx.Rollback(context.Background())

	user, err := deleteAdminUser(ctx, db.New(tx), h.storage, payload.Email)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			utils.WriteError(w, http.StatusNotFound, "user was not found")
		case errors.Is(err, errAmbiguousUserEmail):
			utils.WriteError(w, http.StatusConflict, "multiple users match this email; no users were deleted")
		case errors.Is(err, errUserAssetCleanup):
			utils.Errorf("administrator user asset deletion: %v", err)
			utils.WriteError(w, http.StatusBadGateway, "unable to delete user assets; user deletion was rolled back, retry the request")
		default:
			utils.Errorf("administrator user deletion: %v", err)
			utils.WriteError(w, http.StatusInternalServerError, "unable to delete user")
		}
		return
	}
	if err := tx.Commit(ctx); err != nil {
		utils.Errorf("commit administrator user deletion: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to confirm user deletion; assets may already be removed, retry the request")
		return
	}
	utils.WriteJSON(w, http.StatusOK, adminDeleteUserResponse{
		ID: formatUUID(user.ID), Email: user.Email, Deleted: true,
	})
}

// The caller must use a transaction: the user and dependent rows are locked
// and deleted before storage cleanup, but committed only after it succeeds.
// Bunny cannot participate in the transaction; removed assets cannot be restored
// by a database rollback. Keeping the user row on failure permits a retry.
func deleteAdminUser(ctx context.Context, store adminUserDeletionStore, storage adminUserAssetStorage, email string) (db.User, error) {
	users, err := store.ListUsersByEmailForUpdate(ctx, email)
	if err != nil {
		return db.User{}, err
	}
	if len(users) == 0 {
		return db.User{}, pgx.ErrNoRows
	}
	if len(users) != 1 {
		return db.User{}, errAmbiguousUserEmail
	}
	user := users[0]
	if !user.ID.Valid {
		return db.User{}, errors.New("user has an invalid ID")
	}
	if storage == nil {
		return db.User{}, errUserAssetCleanup
	}
	deleted, err := store.DeleteUser(ctx, user.ID)
	if err != nil {
		return db.User{}, err
	}
	if deleted != 1 {
		return db.User{}, fmt.Errorf("expected to delete one user, deleted %d", deleted)
	}
	if err := storage.DeleteDirectory(ctx, "users/"+formatUUID(user.ID)); err != nil {
		return db.User{}, fmt.Errorf("%w: %w", errUserAssetCleanup, err)
	}
	return user, nil
}
