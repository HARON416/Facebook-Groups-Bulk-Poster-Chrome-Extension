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
		AllowedOrigins:   []string{"http://localhost:5173", "https://bookmarkmonster.xyz", "https://*.bookmarkmonster.xyz"},
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

	r.Route("/api", func(r chi.Router) {

		r.Route("/users", func(r chi.Router) {
			r.Post("/", apiHandler.CreateUser)
		})
	})

	return r
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	utils.WriteJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}
