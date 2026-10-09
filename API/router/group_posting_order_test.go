package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"facebook-groups-bulk-poster-api/handlers"
	"facebook-groups-bulk-poster-api/utils"
)

func TestRetiredGroupPostingHistoryRoutesAreNotExposed(t *testing.T) {
	router := Router(handlers.NewAPIHandler(nil, nil, nil, utils.Config{}))
	for _, path := range []string{"/api/group-posting-stats/plan", "/api/group-posting-stats/accepted"} {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want not found", response.Code)
			}
		})
	}
}
