package handlers

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/internal/entitlements"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	accessTierFree                    = "free"
	accessTierPro                     = "pro"
	freeSavedGroupPostsLimit    int64 = 5
	freeSavedListingsLimit      int64 = 5
	freeDailyPostingLimit       int64 = 20
	usageKindGroupPost                = "group_post"
	usageKindMarketplaceListing       = "marketplace_listing"
)

var (
	errSavedGroupPostLimit              = errors.New("saved Group posts limit reached")
	errSavedListingLimit                = errors.New("saved Marketplace listings limit reached")
	errFacebookAccountAlreadyLinked     = errors.New("Facebook account is already linked to another Free account")
	errFreeAccountFacebookBindingLocked = errors.New("Free account is already linked to another Facebook account")
)

type accessLimitsResponse struct {
	SavedGroupPosts *int64 `json:"saved_group_posts"`
	SavedListings   *int64 `json:"saved_marketplace_listings"`
	GroupPostsToday *int64 `json:"group_posts_today"`
	ListingsToday   *int64 `json:"marketplace_listings_today"`
}

type accessUsageResponse struct {
	SavedGroupPosts int64 `json:"saved_group_posts"`
	SavedListings   int64 `json:"saved_marketplace_listings"`
	GroupPostsToday int64 `json:"group_posts_today"`
	ListingsToday   int64 `json:"marketplace_listings_today"`
}

type accessResetResponse struct {
	GroupPostsToday *time.Time `json:"group_posts_today,omitempty"`
	ListingsToday   *time.Time `json:"marketplace_listings_today,omitempty"`
}

type accessEntitlementsResponse struct {
	Tier         string               `json:"tier"`
	ProExpiresAt *time.Time           `json:"pro_expires_at,omitempty"`
	ProLifetime  bool                 `json:"pro_lifetime,omitempty"`
	Limits       accessLimitsResponse `json:"limits"`
	Usage        accessUsageResponse  `json:"usage"`
	Remaining    accessLimitsResponse `json:"remaining"`
	ResetAt      accessResetResponse  `json:"reset_at"`
}

type postingUsagePayload struct {
	Kind            string `json:"kind"`
	OperationID     string `json:"operation_id"`
	FacebookActorID string `json:"facebook_actor_id,omitempty"`
}

type postingUsageResponse struct {
	OperationID string                     `json:"operation_id"`
	Kind        string                     `json:"kind"`
	Status      string                     `json:"status"`
	Unlimited   bool                       `json:"unlimited"`
	Access      accessEntitlementsResponse `json:"access"`
}

type accessLimitErrorResponse struct {
	Error     string                      `json:"error"`
	Code      string                      `json:"code"`
	Limit     int64                       `json:"limit"`
	Used      int64                       `json:"used"`
	Remaining int64                       `json:"remaining"`
	ResetAt   *time.Time                  `json:"reset_at,omitempty"`
	Access    *accessEntitlementsResponse `json:"access,omitempty"`
}

type facebookBindingStore interface {
	GetFacebookAccountBindingByUser(context.Context, pgtype.UUID) (db.FacebookAccountBinding, error)
	BindFacebookAccountByActorHash(context.Context, db.BindFacebookAccountByActorHashParams) (db.FacebookAccountBinding, error)
	TouchFacebookAccountBinding(context.Context, pgtype.UUID) (db.FacebookAccountBinding, error)
}

func (h *APIHandler) accessEntitlements(ctx context.Context, user db.User) (accessEntitlementsResponse, error) {
	window := postingUsageDayWindow(user.Timezone, time.Now())
	groupPosts, err := h.store.CountGroupPostsByUser(ctx, user.ID)
	if err != nil {
		return accessEntitlementsResponse{}, err
	}
	listings, err := h.store.CountMarketplaceListingsByUser(ctx, user.ID)
	if err != nil {
		return accessEntitlementsResponse{}, err
	}
	groupUsage, err := h.store.GetPostingUsageSummary(ctx, db.GetPostingUsageSummaryParams{
		UserID:      user.ID,
		Kind:        usageKindGroupPost,
		WindowStart: timestamptz(window.Start),
		WindowEnd:   timestamptz(window.End),
	})
	if err != nil {
		return accessEntitlementsResponse{}, err
	}
	listingUsage, err := h.store.GetPostingUsageSummary(ctx, db.GetPostingUsageSummaryParams{
		UserID:      user.ID,
		Kind:        usageKindMarketplaceListing,
		WindowStart: timestamptz(window.Start),
		WindowEnd:   timestamptz(window.End),
	})
	if err != nil {
		return accessEntitlementsResponse{}, err
	}

	response := accessEntitlementsResponse{
		Tier: effectiveAccessTier(user, time.Now()),
		Usage: accessUsageResponse{
			SavedGroupPosts: groupPosts,
			SavedListings:   listings,
			GroupPostsToday: groupUsage.Used,
			ListingsToday:   listingUsage.Used,
		},
		ResetAt: accessResetResponse{
			GroupPostsToday: timestamptzPointer(groupUsage.ResetAt),
			ListingsToday:   timestamptzPointer(listingUsage.ResetAt),
		},
	}
	if response.Tier == accessTierPro {
		response.ProExpiresAt = timestamptzPointer(user.ProExpiresAt)
		response.ProLifetime = !user.ProExpiresAt.Valid
		return response, nil
	}

	response.Limits = accessLimitsResponse{
		SavedGroupPosts: int64Pointer(freeSavedGroupPostsLimit),
		SavedListings:   int64Pointer(freeSavedListingsLimit),
		GroupPostsToday: int64Pointer(freeDailyPostingLimit),
		ListingsToday:   int64Pointer(freeDailyPostingLimit),
	}
	response.Remaining = accessLimitsResponse{
		SavedGroupPosts: int64Pointer(remainingLimit(freeSavedGroupPostsLimit, groupPosts)),
		SavedListings:   int64Pointer(remainingLimit(freeSavedListingsLimit, listings)),
		GroupPostsToday: int64Pointer(remainingLimit(freeDailyPostingLimit, groupUsage.Used)),
		ListingsToday:   int64Pointer(remainingLimit(freeDailyPostingLimit, listingUsage.Used)),
	}
	return response, nil
}

func (h *APIHandler) ClaimPostingUsage(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	payload, operationID, ok := decodePostingUsagePayload(w, r)
	if !ok {
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to reserve posting allowance")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	queries := db.New(tx)
	lockedUser, err := queries.LockUserForUsage(r.Context(), user.ID)
	if err != nil {
		utils.WriteError(w, http.StatusUnauthorized, "user account is unavailable")
		return
	}
	if effectiveAccessTier(lockedUser, time.Now()) == accessTierPro {
		if err := tx.Commit(r.Context()); err != nil {
			utils.WriteError(w, http.StatusInternalServerError, "unable to reserve posting allowance")
			return
		}
		h.writePostingUsageResponse(w, r, lockedUser, payload, "unlimited", true)
		return
	}
	facebookActorID := normalizeFacebookActorID(payload.FacebookActorID)
	if facebookActorID == "" {
		utils.WriteError(w, http.StatusBadRequest, "a valid Facebook account is required to publish")
		return
	}
	facebookBinding, err := h.resolveFacebookAccountBinding(r.Context(), queries, lockedUser, facebookActorID)
	if err != nil {
		switch {
		case errors.Is(err, errFacebookAccountAlreadyLinked):
			utils.WriteJSON(w, http.StatusConflict, map[string]any{
				"error": "This Facebook account is already connected to another Free KundiPost account. Sign in with the original Google account or contact support.",
				"code":  "facebook_account_already_linked",
			})
		case errors.Is(err, errFreeAccountFacebookBindingLocked):
			utils.WriteJSON(w, http.StatusConflict, map[string]any{
				"error": "This Free KundiPost account is already connected to another Facebook account. Sign back in to the original Facebook account or contact support.",
				"code":  "free_account_facebook_binding_locked",
			})
		default:
			utils.WriteError(w, http.StatusInternalServerError, "unable to verify the Facebook account binding")
		}
		return
	}

	existing, err := queries.GetPostingUsageClaim(r.Context(), db.GetPostingUsageClaimParams{
		UserID: user.ID, Kind: payload.Kind, OperationID: operationID,
	})
	if err == nil {
		if existing.Status == "released" {
			utils.WriteJSON(w, http.StatusConflict, map[string]any{
				"error": "posting operation was already released",
				"code":  "posting_operation_released",
			})
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			utils.WriteError(w, http.StatusInternalServerError, "unable to reserve posting allowance")
			return
		}
		h.writePostingUsageResponse(w, r, lockedUser, payload, existing.Status, false)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		utils.WriteError(w, http.StatusInternalServerError, "unable to reserve posting allowance")
		return
	}

	claimTime := time.Now().UTC()
	window := postingUsageDayWindow(lockedUser.Timezone, claimTime)
	summary, err := queries.GetPostingUsageSummary(r.Context(), db.GetPostingUsageSummaryParams{
		UserID:      user.ID,
		Kind:        payload.Kind,
		WindowStart: timestamptz(window.Start),
		WindowEnd:   timestamptz(window.End),
	})
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to check posting allowance")
		return
	}
	facebookSummary, err := queries.GetFacebookPostingUsageSummary(r.Context(), db.GetFacebookPostingUsageSummaryParams{
		FacebookAccountBindingID: facebookBinding.ID,
		Kind:                     payload.Kind,
		WindowStart:              timestamptz(window.Start),
		WindowEnd:                timestamptz(window.End),
	})
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to check Facebook account allowance")
		return
	}
	used := dualIdentityUsage(summary.Used, facebookSummary.Used)
	if used >= freeDailyPostingLimit {
		utils.WriteJSON(w, http.StatusTooManyRequests, accessLimitErrorResponse{
			Error:     postingLimitMessage(payload.Kind),
			Code:      "daily_posting_limit_reached",
			Limit:     freeDailyPostingLimit,
			Used:      used,
			Remaining: 0,
			ResetAt:   timestamptzPointer(facebookSummary.ResetAt),
		})
		return
	}

	_, err = queries.CreatePostingUsageClaim(r.Context(), db.CreatePostingUsageClaimParams{
		UserID:                   user.ID,
		FacebookAccountBindingID: facebookBinding.ID,
		Kind:                     payload.Kind,
		OperationID:              operationID,
		ClaimedAt:                timestamptz(claimTime),
		ExpiresAt:                timestamptz(window.End),
	})
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to reserve posting allowance")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to reserve posting allowance")
		return
	}
	h.writePostingUsageResponse(w, r, lockedUser, payload, "claimed", false)
}

func (h *APIHandler) resolveFacebookAccountBinding(ctx context.Context, queries facebookBindingStore, user db.User, actorID string) (db.FacebookAccountBinding, error) {
	actorHash := hashFacebookActorID(h.config.FacebookActorHMACKey, actorID)
	existing, err := queries.GetFacebookAccountBindingByUser(ctx, user.ID)
	if err == nil {
		if !hmac.Equal([]byte(existing.ActorHash), []byte(actorHash)) {
			return db.FacebookAccountBinding{}, errFreeAccountFacebookBindingLocked
		}
		return queries.TouchFacebookAccountBinding(ctx, existing.ID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.FacebookAccountBinding{}, err
	}

	binding, err := queries.BindFacebookAccountByActorHash(ctx, db.BindFacebookAccountByActorHashParams{
		UserID:    user.ID,
		ActorHash: actorHash,
	})
	if err != nil {
		return db.FacebookAccountBinding{}, err
	}
	if binding.UserID != user.ID {
		return db.FacebookAccountBinding{}, errFacebookAccountAlreadyLinked
	}
	return binding, nil
}

func normalizeFacebookActorID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) < 5 || len(value) > 32 {
		return ""
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return ""
		}
	}
	return value
}

func hashFacebookActorID(secret, actorID string) string {
	digest := hmac.New(sha256.New, []byte(strings.TrimSpace(secret)))
	_, _ = digest.Write([]byte(actorID))
	return hex.EncodeToString(digest.Sum(nil))
}

func dualIdentityUsage(googleUsage, facebookUsage int64) int64 {
	if googleUsage >= facebookUsage {
		return googleUsage
	}
	return facebookUsage
}

func (h *APIHandler) CompletePostingUsage(w http.ResponseWriter, r *http.Request) {
	h.transitionPostingUsage(w, r, "succeeded")
}

func (h *APIHandler) ReleasePostingUsage(w http.ResponseWriter, r *http.Request) {
	h.transitionPostingUsage(w, r, "released")
}

func (h *APIHandler) transitionPostingUsage(w http.ResponseWriter, r *http.Request, target string) {
	user, _ := currentUser(r.Context())
	payload, operationID, ok := decodePostingUsagePayload(w, r)
	if !ok {
		return
	}
	if effectiveAccessTier(user, time.Now()) == accessTierPro {
		h.writePostingUsageResponse(w, r, user, payload, "unlimited", true)
		return
	}

	existing, err := h.store.GetPostingUsageClaim(r.Context(), db.GetPostingUsageClaimParams{
		UserID: user.ID, Kind: payload.Kind, OperationID: operationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			utils.WriteJSON(w, http.StatusNotFound, map[string]any{
				"error": "posting allowance claim was not found",
				"code":  "posting_claim_not_found",
			})
			return
		}
		utils.WriteError(w, http.StatusInternalServerError, "unable to update posting allowance")
		return
	}
	if existing.Status == target {
		h.writePostingUsageResponse(w, r, user, payload, target, false)
		return
	}
	if existing.Status != "claimed" {
		utils.WriteJSON(w, http.StatusConflict, map[string]any{
			"error": "posting allowance claim cannot be changed",
			"code":  "posting_claim_already_finalized",
		})
		return
	}

	if target == "succeeded" {
		_, err = h.store.MarkPostingUsageClaimSucceeded(r.Context(), db.MarkPostingUsageClaimSucceededParams{
			UserID: user.ID, Kind: payload.Kind, OperationID: operationID,
		})
	} else {
		_, err = h.store.ReleasePostingUsageClaim(r.Context(), db.ReleasePostingUsageClaimParams{
			UserID: user.ID, Kind: payload.Kind, OperationID: operationID,
		})
	}
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to update posting allowance")
		return
	}
	h.writePostingUsageResponse(w, r, user, payload, target, false)
}

func (h *APIHandler) writePostingUsageResponse(w http.ResponseWriter, r *http.Request, user db.User, payload postingUsagePayload, status string, unlimited bool) {
	access, err := h.accessEntitlements(r.Context(), user)
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "posting allowance updated but access could not be reloaded")
		return
	}
	utils.WriteJSON(w, http.StatusOK, postingUsageResponse{
		OperationID: payload.OperationID,
		Kind:        payload.Kind,
		Status:      status,
		Unlimited:   unlimited,
		Access:      access,
	})
}

func decodePostingUsagePayload(w http.ResponseWriter, r *http.Request) (postingUsagePayload, pgtype.UUID, bool) {
	var payload postingUsagePayload
	if err := decodeJSONBody(r, &payload); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid posting allowance request")
		return payload, pgtype.UUID{}, false
	}
	payload.Kind = strings.TrimSpace(payload.Kind)
	if payload.Kind != usageKindGroupPost && payload.Kind != usageKindMarketplaceListing {
		utils.WriteError(w, http.StatusBadRequest, "invalid posting allowance kind")
		return payload, pgtype.UUID{}, false
	}
	operationID, err := parseUUID(payload.OperationID)
	if err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid posting operation id")
		return payload, pgtype.UUID{}, false
	}
	payload.OperationID = formatUUID(operationID)
	return payload, operationID, true
}

func normalizedAccessTier(value string) string {
	return entitlements.NormalizeTier(value)
}

func effectiveAccessTier(user db.User, now time.Time) string {
	return entitlements.EffectiveTier(
		user.AccessTier,
		user.ProExpiresAt.Time,
		user.ProExpiresAt.Valid,
		now,
	)
}

func remainingLimit(limit, used int64) int64 {
	if used >= limit {
		return 0
	}
	return limit - used
}

func int64Pointer(value int64) *int64 {
	return &value
}

func timestamptzPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	timestamp := value.Time.UTC()
	return &timestamp
}

func postingLimitMessage(kind string) string {
	if kind == usageKindMarketplaceListing {
		return "Free accounts can publish up to 20 Marketplace listings per calendar day."
	}
	return "Free accounts can publish up to 20 Group posts per calendar day."
}

type postingDayWindow struct {
	Start time.Time
	End   time.Time
}

func postingUsageDayWindow(timezone string, now time.Time) postingDayWindow {
	location, err := time.LoadLocation(normalizeUserTimezone(timezone))
	if err != nil {
		location = time.UTC
	}
	localNow := now.In(location)
	start := time.Date(
		localNow.Year(),
		localNow.Month(),
		localNow.Day(),
		0, 0, 0, 0,
		location,
	)
	return postingDayWindow{
		Start: start.UTC(),
		End:   start.AddDate(0, 0, 1).UTC(),
	}
}

func timestamptz(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value.UTC(), Valid: true}
}

func (h *APIHandler) createGroupPostWithinAccess(ctx context.Context, user db.User, body string) (db.GroupPost, error) {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return db.GroupPost{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := db.New(tx)
	lockedUser, err := queries.LockUserForUsage(ctx, user.ID)
	if err != nil {
		return db.GroupPost{}, err
	}
	if effectiveAccessTier(lockedUser, time.Now()) == accessTierFree {
		count, err := queries.CountGroupPostsByUser(ctx, user.ID)
		if err != nil {
			return db.GroupPost{}, err
		}
		if count >= freeSavedGroupPostsLimit {
			return db.GroupPost{}, errSavedGroupPostLimit
		}
	}
	post, err := queries.CreateGroupPost(ctx, db.CreateGroupPostParams{UserID: user.ID, Body: body})
	if err != nil {
		return db.GroupPost{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.GroupPost{}, err
	}
	return post, nil
}

func (h *APIHandler) createMarketplaceListingWithinAccess(ctx context.Context, user db.User, params db.CreateMarketplaceListingParams) (db.MarketplaceListing, error) {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return db.MarketplaceListing{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := db.New(tx)
	lockedUser, err := queries.LockUserForUsage(ctx, user.ID)
	if err != nil {
		return db.MarketplaceListing{}, err
	}
	if effectiveAccessTier(lockedUser, time.Now()) == accessTierFree {
		count, err := queries.CountMarketplaceListingsByUser(ctx, user.ID)
		if err != nil {
			return db.MarketplaceListing{}, err
		}
		if count >= freeSavedListingsLimit {
			return db.MarketplaceListing{}, errSavedListingLimit
		}
	}
	listing, err := queries.CreateMarketplaceListing(ctx, params)
	if err != nil {
		return db.MarketplaceListing{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.MarketplaceListing{}, err
	}
	return listing, nil
}

func (h *APIHandler) writeSavedContentLimitError(w http.ResponseWriter, r *http.Request, user db.User, kind string) {
	access, err := h.accessEntitlements(r.Context(), user)
	if err != nil {
		utils.WriteError(w, http.StatusConflict, "Free account saved-content limit reached")
		return
	}
	limit := freeSavedGroupPostsLimit
	used := access.Usage.SavedGroupPosts
	code := "saved_group_posts_limit_reached"
	message := "Free accounts can save up to 5 Group posts. Delete one or upgrade to Pro."
	if kind == usageKindMarketplaceListing {
		limit = freeSavedListingsLimit
		used = access.Usage.SavedListings
		code = "saved_marketplace_listings_limit_reached"
		message = "Free accounts can save up to 5 Marketplace listings. Delete one or upgrade to Pro."
	}
	utils.WriteJSON(w, http.StatusConflict, accessLimitErrorResponse{
		Error:     message,
		Code:      code,
		Limit:     limit,
		Used:      used,
		Remaining: remainingLimit(limit, used),
		Access:    &access,
	})
}
