package handlers

import (
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/jackc/pgx/v5"
)

const maximumGroupStatsQuerySize = 2000
const maximumBalancedPostingPlanSize = 10000

type balancedPostingGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type balancedPostingPlanPayload struct {
	FacebookActorID         string                 `json:"facebook_actor_id"`
	Groups                  []balancedPostingGroup `json:"groups"`
	MaximumPosts            int                    `json:"maximum_posts"`
	FailedGroupIDs          []string               `json:"failed_group_ids"`
	StarterExcludedGroupIDs []string               `json:"starter_excluded_group_ids"`
}

type acceptedGroupPostPayload struct {
	FacebookActorID string `json:"facebook_actor_id"`
	GroupID         string `json:"group_id"`
	GroupName       string `json:"group_name"`
	OperationID     string `json:"operation_id"`
}

type groupPostingStatResponse struct {
	GroupID        string     `json:"group_id"`
	GroupName      string     `json:"group_name"`
	AcceptedCount  int64      `json:"accepted_count"`
	LastAcceptedAt *time.Time `json:"last_accepted_at,omitempty"`
}

func (h *APIHandler) CreateBalancedGroupPostingPlan(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	var payload balancedPostingPlanPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid balanced Group posting request")
		return
	}
	actorID := normalizeFacebookActorID(payload.FacebookActorID)
	if actorID == "" {
		utils.WriteError(w, http.StatusBadRequest, "a valid Facebook account is required")
		return
	}
	groups, err := normalizeBalancedPostingGroups(payload.Groups)
	if err != nil {
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if payload.MaximumPosts < 1 || payload.MaximumPosts > maximumBalancedPostingPlanSize {
		utils.WriteError(w, http.StatusBadRequest, "maximum posts must be between 1 and 10000")
		return
	}
	failedGroupIDs, err := normalizeFacebookGroupIDs(payload.FailedGroupIDs)
	if err != nil {
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	starterExcludedGroupIDs, err := normalizeFacebookGroupIDs(payload.StarterExcludedGroupIDs)
	if err != nil {
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	groupIDs := make([]string, 0, len(groups))
	for _, group := range groups {
		groupIDs = append(groupIDs, group.ID)
	}
	stats, err := h.store.ListFacebookGroupPostingStats(r.Context(), db.ListFacebookGroupPostingStatsParams{
		UserID: user.ID, ActorHash: hashFacebookActorID(h.config.FacebookActorHMACKey, actorID), GroupIds: groupIDs,
	})
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to load Group posting statistics")
		return
	}
	plan := buildBalancedPostingPlan(
		groups,
		stats,
		payload.MaximumPosts,
		failedGroupIDs,
		starterExcludedGroupIDs,
	)
	if len(plan) == 0 {
		utils.WriteJSON(w, http.StatusConflict, map[string]any{
			"error": "No eligible selected Group can initialize balanced posting. Change the selected Groups or use selected-order posting.",
			"code":  "no_eligible_balanced_group",
		})
		return
	}
	utils.WriteJSON(w, http.StatusOK, map[string]any{"plan": plan})
}

func (h *APIHandler) RecordAcceptedGroupPost(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	var payload acceptedGroupPostPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid accepted Group post request")
		return
	}
	actorID := normalizeFacebookActorID(payload.FacebookActorID)
	groupID := normalizeFacebookGroupID(payload.GroupID)
	groupName := normalizeFacebookGroupName(payload.GroupName)
	operationID, operationErr := parseUUID(payload.OperationID)
	if actorID == "" || groupID == "" || groupName == "" || operationErr != nil {
		utils.WriteError(w, http.StatusBadRequest, "valid Facebook account, Group, and operation identifiers are required")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to record accepted Group post")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	queries := db.New(tx)
	actorHash := hashFacebookActorID(h.config.FacebookActorHMACKey, actorID)
	acceptedAt := time.Now().UTC()
	inserted, err := queries.InsertFacebookGroupPostingEvent(r.Context(), db.InsertFacebookGroupPostingEventParams{
		UserID: user.ID, ActorHash: actorHash, GroupID: groupID,
		OperationID: operationID, AcceptedAt: timestamptz(acceptedAt),
	})
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to record accepted Group post")
		return
	}

	var stat db.FacebookGroupPostingStat
	if inserted == 1 {
		stat, err = queries.IncrementFacebookGroupPostingStat(r.Context(), db.IncrementFacebookGroupPostingStatParams{
			UserID: user.ID, ActorHash: actorHash, GroupID: groupID,
			GroupName: groupName, AcceptedAt: timestamptz(acceptedAt),
		})
	} else {
		event, eventErr := queries.GetFacebookGroupPostingEvent(r.Context(), db.GetFacebookGroupPostingEventParams{
			UserID: user.ID, ActorHash: actorHash, OperationID: operationID,
		})
		if eventErr != nil {
			err = eventErr
		} else if event.GroupID != groupID {
			utils.WriteError(w, http.StatusConflict, "posting operation belongs to another Group")
			return
		} else {
			stat, err = queries.GetFacebookGroupPostingStat(r.Context(), db.GetFacebookGroupPostingStatParams{
				UserID: user.ID, ActorHash: actorHash, GroupID: groupID,
			})
		}
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			utils.WriteError(w, http.StatusConflict, "accepted Group post has no matching statistic")
			return
		}
		utils.WriteError(w, http.StatusInternalServerError, "unable to update Group posting statistics")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to save Group posting statistics")
		return
	}
	utils.WriteJSON(w, http.StatusOK, map[string]any{
		"recorded": inserted == 1,
		"stat":     groupPostingStatResponseFromModel(stat),
	})
}

func normalizeFacebookGroupIDs(values []string) ([]string, error) {
	if len(values) > maximumGroupStatsQuerySize {
		return nil, errors.New("too many Groups were supplied")
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		groupID := normalizeFacebookGroupID(value)
		if groupID == "" {
			return nil, errors.New("every Group must have a valid numeric identifier")
		}
		if _, exists := seen[groupID]; exists {
			continue
		}
		seen[groupID] = struct{}{}
		result = append(result, groupID)
	}
	return result, nil
}

func normalizeBalancedPostingGroups(values []balancedPostingGroup) ([]balancedPostingGroup, error) {
	if len(values) == 0 {
		return nil, errors.New("at least one selected Group is required")
	}
	if len(values) > maximumGroupStatsQuerySize {
		return nil, errors.New("too many Groups were supplied")
	}
	seen := make(map[string]struct{}, len(values))
	groups := make([]balancedPostingGroup, 0, len(values))
	for _, value := range values {
		groupID := normalizeFacebookGroupID(value.ID)
		groupName := normalizeFacebookGroupName(value.Name)
		if groupID == "" || groupName == "" {
			return nil, errors.New("every Group must have a valid identifier and name")
		}
		if _, exists := seen[groupID]; exists {
			continue
		}
		seen[groupID] = struct{}{}
		groups = append(groups, balancedPostingGroup{ID: groupID, Name: groupName})
	}
	return groups, nil
}

func buildBalancedPostingPlan(
	groups []balancedPostingGroup,
	stats []db.FacebookGroupPostingStat,
	maximumPosts int,
	failedGroupIDs []string,
	starterExcludedGroupIDs []string,
) []balancedPostingGroup {
	failed := stringSet(failedGroupIDs)
	starterExcluded := stringSet(starterExcludedGroupIDs)
	statsByGroupID := make(map[string]db.FacebookGroupPostingStat, len(stats))
	for _, stat := range stats {
		statsByGroupID[stat.GroupID] = stat
	}
	eligible := make([]balancedPostingGroup, 0, len(groups))
	for _, group := range groups {
		if _, excluded := failed[group.ID]; !excluded {
			eligible = append(eligible, group)
		}
	}
	sort.SliceStable(eligible, func(leftIndex, rightIndex int) bool {
		left, leftExists := statsByGroupID[eligible[leftIndex].ID]
		right, rightExists := statsByGroupID[eligible[rightIndex].ID]
		leftCount, rightCount := int64(0), int64(0)
		if leftExists {
			leftCount = left.AcceptedCount
		}
		if rightExists {
			rightCount = right.AcceptedCount
		}
		if leftCount != rightCount {
			return leftCount < rightCount
		}
		leftTime, rightTime := time.Time{}, time.Time{}
		if leftExists && left.LastAcceptedAt.Valid {
			leftTime = left.LastAcceptedAt.Time
		}
		if rightExists && right.LastAcceptedAt.Valid {
			rightTime = right.LastAcceptedAt.Time
		}
		if !leftTime.Equal(rightTime) {
			return leftTime.Before(rightTime)
		}
		return eligible[leftIndex].ID < eligible[rightIndex].ID
	})
	if len(eligible) == 0 || maximumPosts < 1 {
		return nil
	}
	starterIndex := -1
	for index, group := range eligible {
		if _, excluded := starterExcluded[group.ID]; !excluded {
			starterIndex = index
			break
		}
	}
	if starterIndex < 0 {
		return nil
	}
	if starterIndex > 0 {
		eligible[0], eligible[starterIndex] = eligible[starterIndex], eligible[0]
	}
	plan := make([]balancedPostingGroup, 0, maximumPosts)
	for len(plan) < maximumPosts {
		remaining := maximumPosts - len(plan)
		if remaining >= len(eligible) {
			plan = append(plan, eligible...)
		} else {
			plan = append(plan, eligible[:remaining]...)
		}
	}
	return plan
}

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func normalizeFacebookGroupID(value string) string {
	return normalizeFacebookActorID(value)
}

func normalizeFacebookGroupName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 500 {
		return ""
	}
	return value
}

func groupPostingStatResponseFromModel(stat db.FacebookGroupPostingStat) groupPostingStatResponse {
	return groupPostingStatResponse{
		GroupID: stat.GroupID, GroupName: stat.GroupName,
		AcceptedCount: stat.AcceptedCount, LastAcceptedAt: timestamptzPointer(stat.LastAcceptedAt),
	}
}
