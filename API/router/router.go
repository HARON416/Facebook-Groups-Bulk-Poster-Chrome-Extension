package router

import (
	"net/http"

	"facebook-groups-bulk-poster-api/handlers"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func Router(apiHandler *handlers.APIHandler) *chi.Mux {
	r := chi.NewRouter()

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"chrome-extension://lphjckpophfkedacijahclaoenhikcgo", "http://localhost:5173", "https://facebook-groups-bulk-poster-chrome-extension.softwrhq.com", "https://*.facebook-groups-bulk-poster-chrome-extension.softwrhq.com"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"},
		AllowedHeaders:   []string{"User-Agent", "Content-Type", "Accept", "Accept-Encoding", "Accept-Language", "Cache-Control", "Connection", "DNT", "Host", "Origin", "Pragma", "Referer", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300, // Maximum value not ignored by any of major browsers
		Debug:            false,
	}))

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.CleanPath)
	r.Use(middleware.RedirectSlashes)

	r.Get("/health", healthHandler)
	r.Post("/api/auth/google", apiHandler.AuthenticateGoogle)
	r.Group(func(r chi.Router) {
		r.Use(apiHandler.RequireAdminAPIKey)
		r.Post("/api/admin/access/temporary", apiHandler.GrantTemporaryPro)
		r.Post("/api/admin/access/lifetime", apiHandler.GrantLifetimePro)
		r.Post("/api/admin/access/revoke", apiHandler.RevokePro)
	})

	r.Group(func(r chi.Router) {
		r.Use(apiHandler.RequireAuthenticatedUser)
		r.Get("/api/me", apiHandler.CurrentUser)
		r.Post("/api/auth/logout", apiHandler.Logout)
		r.Post("/api/posting-usage/claim", apiHandler.ClaimPostingUsage)
		r.Post("/api/posting-usage/complete", apiHandler.CompletePostingUsage)
		r.Post("/api/posting-usage/release", apiHandler.ReleasePostingUsage)
		r.Post("/api/group-posting-stats/plan", apiHandler.CreateBalancedGroupPostingPlan)
		r.Post("/api/group-posting-stats/accepted", apiHandler.RecordAcceptedGroupPost)
		r.Get("/api/group-posts", apiHandler.ListGroupPosts)
		r.Post("/api/group-posts", apiHandler.CreateGroupPost)
		r.Put("/api/group-posts/{postID}", apiHandler.UpdateGroupPost)
		r.Delete("/api/group-posts/{postID}", apiHandler.DeleteGroupPost)
		r.Get("/api/marketplace-listings", apiHandler.ListMarketplaceListings)
		r.Post("/api/marketplace-listings", apiHandler.CreateMarketplaceListing)
		r.Get("/api/marketplace-listings/{listingID}", apiHandler.GetMarketplaceListing)
		r.Put("/api/marketplace-listings/{listingID}", apiHandler.UpdateMarketplaceListing)
		r.Delete("/api/marketplace-listings/{listingID}", apiHandler.DeleteMarketplaceListing)
	})

	return r
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	utils.WriteJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}
