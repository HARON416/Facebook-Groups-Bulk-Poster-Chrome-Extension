package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"facebook-groups-bulk-poster-api/handlers"
	"facebook-groups-bulk-poster-api/utils"
)

func TestCommentSettingsRoutesRequireAuthentication(t *testing.T) {
	router := Router(handlers.NewAPIHandler(nil, nil, nil, utils.Config{}))
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(method, "/api/group-comment-settings", nil))
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want unauthorized", response.Code)
			}
		})
	}
}
