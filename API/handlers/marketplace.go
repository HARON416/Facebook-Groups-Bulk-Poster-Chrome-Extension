package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/storage"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type marketplacePayload struct {
	ListingType string         `json:"listing_type"`
	Fields      map[string]any `json:"fields"`
}

type marketplaceListingImageResponse struct {
	URL      string `json:"url"`
	Position int16  `json:"position"`
}

type marketplaceListingResponse struct {
	ID          string                            `json:"id"`
	ListingType string                            `json:"listing_type"`
	Fields      map[string]any                    `json:"fields"`
	Images      []marketplaceListingImageResponse `json:"images"`
	CreatedAt   string                            `json:"created_at"`
	UpdatedAt   string                            `json:"updated_at"`
}

func (h *APIHandler) ListMarketplaceListings(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	listings, err := h.store.ListMarketplaceListings(r.Context(), user.ID)
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to load Marketplace listings")
		return
	}
	responses := make([]marketplaceListingResponse, 0, len(listings))
	for _, listing := range listings {
		response, err := h.marketplaceListingResponse(r, listing)
		if err != nil {
			utils.Errorf("load Marketplace listing %s: %v", formatUUID(listing.ID), err)
			utils.WriteError(w, http.StatusInternalServerError, "unable to load Marketplace listing details")
			return
		}
		responses = append(responses, response)
	}
	utils.WriteJSON(w, http.StatusOK, map[string]any{"listings": responses})
}

func (h *APIHandler) GetMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	listing, err := h.ownedMarketplaceListing(r)
	if err != nil {
		utils.WriteError(w, http.StatusNotFound, "Marketplace listing not found")
		return
	}
	response, err := h.marketplaceListingResponse(r, listing)
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to load Marketplace listing details")
		return
	}
	utils.WriteJSON(w, http.StatusOK, response)
}

func (h *APIHandler) CreateMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	if err := r.ParseMultipartForm(640 << 20); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid listing upload")
		return
	}
	var payload marketplacePayload
	if err := json.Unmarshal([]byte(r.FormValue("payload")), &payload); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid listing data")
		return
	}
	payload.ListingType = strings.TrimSpace(payload.ListingType)
	limit, valid := map[string]int{"item": 10, "vehicle": 20, "home": 50}[payload.ListingType]
	if !valid {
		utils.WriteError(w, http.StatusBadRequest, "invalid listing type")
		return
	}

	listing, err := h.createMarketplaceListingWithinAccess(r.Context(), user, db.CreateMarketplaceListingParams{
		UserID:      user.ID,
		ListingType: payload.ListingType,
		Price:       nullableInt8(fieldString(payload.Fields, "marketplace-price")),
		Description: nullableText(fieldString(payload.Fields, "marketplace-description")),
		Location:    nullableText(fieldString(payload.Fields, "marketplace-location")),
	})
	if err != nil {
		if errors.Is(err, errSavedListingLimit) {
			h.writeSavedContentLimitError(w, r, user, usageKindMarketplaceListing)
			return
		}
		utils.Errorf("create Marketplace listing: %v", err)
		utils.WriteError(w, http.StatusBadRequest, "unable to create listing")
		return
	}
	deleteListing := func() {
		_, _ = h.store.DeleteMarketplaceListing(r.Context(), db.DeleteMarketplaceListingParams{ID: listing.ID, UserID: user.ID})
	}
	prefix := "users/" + formatUUID(user.ID) + "/marketplace/" + formatUUID(listing.ID)
	uploaded, err := h.uploadImages(r.Context(), prefix, r.MultipartForm.File["images"], limit)
	if err != nil {
		deleteListing()
		go h.deleteUploadedDirectory(prefix)
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		deleteListing()
		go h.deleteUploadedDirectory(prefix)
		utils.WriteError(w, http.StatusInternalServerError, "unable to save listing")
		return
	}
	queries := db.New(tx)
	if err = createMarketplaceDetails(r, queries, listing.ID, payload); err == nil {
		for _, image := range uploaded {
			_, err = queries.CreateMarketplaceListingImage(r.Context(), db.CreateMarketplaceListingImageParams{ListingID: listing.ID, ImageUrl: image.URL, BunnyObjectPath: image.ObjectPath, Position: image.Position})
			if err != nil {
				break
			}
		}
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		deleteListing()
		go h.deleteUploadedDirectory(prefix)
		utils.Errorf("save Marketplace listing details: %v", err)
		utils.WriteError(w, http.StatusBadRequest, "unable to save listing details")
		return
	}

	response, responseErr := h.marketplaceListingResponse(r, listing)
	if responseErr != nil {
		utils.WriteError(w, http.StatusInternalServerError, "listing saved but could not be reloaded")
		return
	}
	utils.WriteJSON(w, http.StatusCreated, response)
}

func (h *APIHandler) UpdateMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	listing, err := h.ownedMarketplaceListing(r)
	if err != nil {
		utils.WriteError(w, http.StatusNotFound, "Marketplace listing not found")
		return
	}
	if err := r.ParseMultipartForm(640 << 20); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid listing upload")
		return
	}
	var payload marketplacePayload
	if err := json.Unmarshal([]byte(r.FormValue("payload")), &payload); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid listing data")
		return
	}
	payload.ListingType = strings.TrimSpace(payload.ListingType)
	if payload.ListingType != listing.ListingType {
		utils.WriteError(w, http.StatusBadRequest, "listing type cannot be changed")
		return
	}
	limit := map[string]int{"item": 10, "vehicle": 20, "home": 50}[listing.ListingType]
	oldImages, err := h.store.ListMarketplaceListingImages(r.Context(), listing.ID)
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to load listing images")
		return
	}
	prefix := "users/" + formatUUID(user.ID) + "/marketplace/" + formatUUID(listing.ID)
	uploaded, err := h.uploadImages(r.Context(), prefix, r.MultipartForm.File["images"], limit)
	if err != nil {
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		h.deleteUploadedImages(uploaded)
		utils.WriteError(w, http.StatusInternalServerError, "unable to update listing")
		return
	}
	queries := db.New(tx)
	updated, err := queries.UpdateMarketplaceListing(r.Context(), db.UpdateMarketplaceListingParams{
		ID: listing.ID, UserID: user.ID,
		Price:       nullableInt8(fieldString(payload.Fields, "marketplace-price")),
		Description: nullableText(fieldString(payload.Fields, "marketplace-description")),
		Location:    nullableText(fieldString(payload.Fields, "marketplace-location")),
	})
	if err == nil {
		err = updateMarketplaceDetails(r, queries, listing.ID, payload)
	}
	if err == nil {
		err = queries.DeleteMarketplaceListingImages(r.Context(), listing.ID)
	}
	if err == nil {
		for _, image := range uploaded {
			_, err = queries.CreateMarketplaceListingImage(r.Context(), db.CreateMarketplaceListingImageParams{ListingID: listing.ID, ImageUrl: image.URL, BunnyObjectPath: image.ObjectPath, Position: image.Position})
			if err != nil {
				break
			}
		}
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		h.deleteUploadedImages(uploaded)
		utils.Errorf("update Marketplace listing: %v", err)
		utils.WriteError(w, http.StatusBadRequest, "unable to update listing")
		return
	}
	cleanup := make([]uploadedImage, 0, len(oldImages))
	for _, image := range oldImages {
		cleanup = append(cleanup, uploadedImage{UploadResult: &storage.UploadResult{ObjectPath: image.BunnyObjectPath, URL: image.ImageUrl}})
	}
	if len(uploaded) == 0 {
		go h.deleteUploadedDirectory(prefix)
	} else {
		go h.deleteUploadedImages(cleanup)
	}
	response, responseErr := h.marketplaceListingResponse(r, updated)
	if responseErr != nil {
		utils.WriteError(w, http.StatusInternalServerError, "listing updated but could not be reloaded")
		return
	}
	utils.WriteJSON(w, http.StatusOK, response)
}

func (h *APIHandler) DeleteMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	listing, err := h.ownedMarketplaceListing(r)
	if err != nil {
		utils.WriteError(w, http.StatusNotFound, "Marketplace listing not found")
		return
	}
	rows, err := h.store.DeleteMarketplaceListing(r.Context(), db.DeleteMarketplaceListingParams{ID: listing.ID, UserID: user.ID})
	if err != nil || rows == 0 {
		utils.WriteError(w, http.StatusInternalServerError, "unable to delete Marketplace listing")
		return
	}
	directoryPath := "users/" + formatUUID(user.ID) + "/marketplace/" + formatUUID(listing.ID)
	go h.deleteUploadedDirectory(directoryPath)
	w.WriteHeader(http.StatusNoContent)
}

func createMarketplaceDetails(r *http.Request, queries *db.Queries, listingID pgtype.UUID, payload marketplacePayload) error {
	fields := payload.Fields
	switch payload.ListingType {
	case "item":
		_, err := queries.CreateMarketplaceItemDetails(r.Context(), db.CreateMarketplaceItemDetailsParams{
			ListingID: listingID, Title: nullableText(fieldString(fields, "marketplace-title")), CategoryGroup: nullableText(fieldString(fields, "marketplace-category-group")), Category: nullableText(fieldString(fields, "marketplace-category")), Condition: nullableText(fieldString(fields, "marketplace-condition")),
		})
		return err
	case "vehicle":
		transmission := fieldString(fields, "marketplace-transmission")
		if transmission == "" {
			transmission = "automatic_transmission"
		}
		_, err := queries.CreateMarketplaceVehicleDetails(r.Context(), db.CreateMarketplaceVehicleDetailsParams{
			ListingID: listingID, VehicleType: nullableText(fieldString(fields, "marketplace-vehicle-type")), Year: nullableInt2(fieldString(fields, "marketplace-year")), Make: nullableText(fieldString(fields, "marketplace-vehicle-make")), Model: nullableText(fieldString(fields, "marketplace-vehicle-model")), MileageKm: nullableInt4(fieldString(fields, "marketplace-vehicle-mileage")), BodyStyle: nullableText(fieldString(fields, "marketplace-body-style")), CleanTitle: fieldBool(fields, "marketplace-clean-title"), Condition: nullableText(fieldString(fields, "marketplace-vehicle-condition")), FuelType: nullableText(fieldString(fields, "marketplace-fuel-type")), Transmission: transmission, ExteriorColor: nullableText(fieldString(fields, "marketplace-exterior-color")), InteriorColor: nullableText(fieldString(fields, "marketplace-interior-color")),
		})
		return err
	case "home":
		_, err := queries.CreateMarketplaceHomeDetails(r.Context(), db.CreateMarketplaceHomeDetailsParams{
			ListingID: listingID, Title: nullableText(fieldString(fields, "marketplace-title")), CategoryGroup: nullableText(fieldString(fields, "marketplace-category-group")), Category: nullableText(fieldString(fields, "marketplace-category")), Condition: nullableText(fieldString(fields, "marketplace-condition")), RentalType: nullableText(fieldString(fields, "marketplace-rental-type")), Bedrooms: nullableInt4(fieldString(fields, "marketplace-bedrooms")), Bathrooms: nullableInt4(fieldString(fields, "marketplace-bathrooms")),
		})
		return err
	default:
		return fmt.Errorf("unsupported listing type")
	}
}

func updateMarketplaceDetails(r *http.Request, queries *db.Queries, listingID pgtype.UUID, payload marketplacePayload) error {
	fields := payload.Fields
	switch payload.ListingType {
	case "item":
		_, err := queries.UpdateMarketplaceItemDetails(r.Context(), db.UpdateMarketplaceItemDetailsParams{
			ListingID: listingID, Title: nullableText(fieldString(fields, "marketplace-title")), CategoryGroup: nullableText(fieldString(fields, "marketplace-category-group")), Category: nullableText(fieldString(fields, "marketplace-category")), Condition: nullableText(fieldString(fields, "marketplace-condition")),
		})
		return err
	case "vehicle":
		transmission := fieldString(fields, "marketplace-transmission")
		if transmission == "" {
			transmission = "automatic_transmission"
		}
		_, err := queries.UpdateMarketplaceVehicleDetails(r.Context(), db.UpdateMarketplaceVehicleDetailsParams{
			ListingID: listingID, VehicleType: nullableText(fieldString(fields, "marketplace-vehicle-type")), Year: nullableInt2(fieldString(fields, "marketplace-year")), Make: nullableText(fieldString(fields, "marketplace-vehicle-make")), Model: nullableText(fieldString(fields, "marketplace-vehicle-model")), MileageKm: nullableInt4(fieldString(fields, "marketplace-vehicle-mileage")), BodyStyle: nullableText(fieldString(fields, "marketplace-body-style")), CleanTitle: fieldBool(fields, "marketplace-clean-title"), Condition: nullableText(fieldString(fields, "marketplace-vehicle-condition")), FuelType: nullableText(fieldString(fields, "marketplace-fuel-type")), Transmission: transmission, ExteriorColor: nullableText(fieldString(fields, "marketplace-exterior-color")), InteriorColor: nullableText(fieldString(fields, "marketplace-interior-color")),
		})
		return err
	case "home":
		_, err := queries.UpdateMarketplaceHomeDetails(r.Context(), db.UpdateMarketplaceHomeDetailsParams{
			ListingID: listingID, Title: nullableText(fieldString(fields, "marketplace-title")), CategoryGroup: nullableText(fieldString(fields, "marketplace-category-group")), Category: nullableText(fieldString(fields, "marketplace-category")), Condition: nullableText(fieldString(fields, "marketplace-condition")), RentalType: nullableText(fieldString(fields, "marketplace-rental-type")), Bedrooms: nullableInt4(fieldString(fields, "marketplace-bedrooms")), Bathrooms: nullableInt4(fieldString(fields, "marketplace-bathrooms")),
		})
		return err
	default:
		return fmt.Errorf("unsupported listing type")
	}
}

func (h *APIHandler) ownedMarketplaceListing(r *http.Request) (db.MarketplaceListing, error) {
	user, _ := currentUser(r.Context())
	id, err := parseUUID(chi.URLParam(r, "listingID"))
	if err != nil {
		return db.MarketplaceListing{}, err
	}
	listing, err := h.store.GetMarketplaceListing(r.Context(), db.GetMarketplaceListingParams{ID: id, UserID: user.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MarketplaceListing{}, err
	}
	return listing, err
}

func (h *APIHandler) marketplaceListingResponse(r *http.Request, listing db.MarketplaceListing) (marketplaceListingResponse, error) {
	fields := map[string]any{
		"marketplace-listing-type": listing.ListingType,
		"marketplace-price":        int8String(listing.Price),
		"marketplace-description":  textString(listing.Description),
		"marketplace-location":     textString(listing.Location),
	}
	switch listing.ListingType {
	case "item":
		details, err := h.store.GetMarketplaceItemDetails(r.Context(), listing.ID)
		if err != nil {
			return marketplaceListingResponse{}, err
		}
		fields["marketplace-title"] = textString(details.Title)
		fields["marketplace-category-group"] = textString(details.CategoryGroup)
		fields["marketplace-category"] = textString(details.Category)
		fields["marketplace-condition"] = textString(details.Condition)
	case "vehicle":
		details, err := h.store.GetMarketplaceVehicleDetails(r.Context(), listing.ID)
		if err != nil {
			return marketplaceListingResponse{}, err
		}
		fields["marketplace-vehicle-type"] = textString(details.VehicleType)
		fields["marketplace-year"] = int2String(details.Year)
		fields["marketplace-vehicle-make"] = textString(details.Make)
		fields["marketplace-vehicle-model"] = textString(details.Model)
		fields["marketplace-vehicle-mileage"] = int4String(details.MileageKm)
		fields["marketplace-body-style"] = textString(details.BodyStyle)
		fields["marketplace-clean-title"] = details.CleanTitle
		fields["marketplace-vehicle-condition"] = textString(details.Condition)
		fields["marketplace-fuel-type"] = textString(details.FuelType)
		fields["marketplace-transmission"] = details.Transmission
		fields["marketplace-exterior-color"] = textString(details.ExteriorColor)
		fields["marketplace-interior-color"] = textString(details.InteriorColor)
	case "home":
		details, err := h.store.GetMarketplaceHomeDetails(r.Context(), listing.ID)
		if err != nil {
			return marketplaceListingResponse{}, err
		}
		fields["marketplace-title"] = textString(details.Title)
		fields["marketplace-category-group"] = textString(details.CategoryGroup)
		fields["marketplace-category"] = textString(details.Category)
		fields["marketplace-condition"] = textString(details.Condition)
		fields["marketplace-rental-type"] = textString(details.RentalType)
		fields["marketplace-bedrooms"] = int4String(details.Bedrooms)
		fields["marketplace-bathrooms"] = int4String(details.Bathrooms)
	default:
		return marketplaceListingResponse{}, fmt.Errorf("unsupported listing type %q", listing.ListingType)
	}

	images, err := h.store.ListMarketplaceListingImages(r.Context(), listing.ID)
	if err != nil {
		return marketplaceListingResponse{}, err
	}
	responseImages := make([]marketplaceListingImageResponse, 0, len(images))
	for _, image := range images {
		responseImages = append(responseImages, marketplaceListingImageResponse{URL: image.ImageUrl, Position: image.Position})
	}
	return marketplaceListingResponse{
		ID: formatUUID(listing.ID), ListingType: listing.ListingType, Fields: fields,
		Images: responseImages, CreatedAt: listing.CreatedAt.Time.Format(time.RFC3339), UpdatedAt: listing.UpdatedAt.Time.Format(time.RFC3339),
	}, nil
}

func textString(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func int8String(value pgtype.Int8) string {
	if !value.Valid {
		return ""
	}
	return strconv.FormatInt(value.Int64, 10)
}

func int4String(value pgtype.Int4) string {
	if !value.Valid {
		return ""
	}
	return strconv.FormatInt(int64(value.Int32), 10)
}

func int2String(value pgtype.Int2) string {
	if !value.Valid {
		return ""
	}
	return strconv.FormatInt(int64(value.Int16), 10)
}

func fieldString(fields map[string]any, key string) string {
	value, _ := fields[key].(string)
	return strings.TrimSpace(value)
}

func fieldBool(fields map[string]any, key string) bool {
	value, _ := fields[key].(bool)
	return value
}

func nullableInt8(value string) pgtype.Int8 {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return pgtype.Int8{Int64: parsed, Valid: err == nil && value != ""}
}

func nullableInt4(value string) pgtype.Int4 {
	parsed, err := strconv.ParseInt(value, 10, 32)
	return pgtype.Int4{Int32: int32(parsed), Valid: err == nil && value != ""}
}

func nullableInt2(value string) pgtype.Int2 {
	parsed, err := strconv.ParseInt(value, 10, 16)
	return pgtype.Int2{Int16: int16(parsed), Valid: err == nil && value != ""}
}
