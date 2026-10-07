package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"facebook-groups-bulk-poster-api/handlers"
	"facebook-groups-bulk-poster-api/utils"
)

func TestAdminUserDeletionRequiresAdministratorKey(t *testing.T) {
	const key = "administrator-secret-at-least-32-characters"
	router := Router(handlers.NewAPIHandler(nil, nil, nil, utils.Config{AdminAPIKey: key}))
	for _, tt := range []struct {
		name, authorization string
		wantStatus          int
	}{
		{name: "missing key", wantStatus: http.StatusUnauthorized},
		{name: "user session is not an admin key", authorization: "Bearer ordinary-user-session", wantStatus: http.StatusUnauthorized},
		{name: "admin key reaches deletion validation", authorization: "Bearer " + key, wantStatus: http.StatusBadRequest},
	} {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodDelete, "/api/admin/users", strings.NewReader(`{}`))
			request.Header.Set("Authorization", tt.authorization)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, tt.wantStatus)
			}
		})
	}
}
