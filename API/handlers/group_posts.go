package handlers

import (
	"errors"
	"net/http"
	"strings"

	"facebook-groups-bulk-poster-api/internal/db"
	"facebook-groups-bulk-poster-api/storage"
	"facebook-groups-bulk-poster-api/utils"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type groupPostImageResponse struct {
	URL      string `json:"url"`
	Position int16  `json:"position"`
}

type groupPostResponse struct {
	ID     string                   `json:"id"`
	Body   string                   `json:"body"`
	Images []groupPostImageResponse `json:"images"`
}

func (h *APIHandler) ListGroupPosts(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	posts, err := h.store.ListGroupPosts(r.Context(), user.ID)
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to load prepared posts")
		return
	}
	responses := make([]groupPostResponse, 0, len(posts))
	for _, post := range posts {
		response, err := h.groupPostResponse(r, post)
		if err != nil {
			utils.WriteError(w, http.StatusInternalServerError, "unable to load prepared post images")
			return
		}
		responses = append(responses, response)
	}
	utils.WriteJSON(w, http.StatusOK, map[string]any{"posts": responses})
}

func (h *APIHandler) CreateGroupPost(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid post upload")
		return
	}
	body := strings.TrimSpace(r.FormValue("body"))
	headers := r.MultipartForm.File["images"]
	if body == "" {
		utils.WriteError(w, http.StatusBadRequest, "post body is required")
		return
	}
	if len(headers) == 0 {
		utils.WriteError(w, http.StatusBadRequest, "at least one post image is required")
		return
	}
	post, err := h.createGroupPostWithinAccess(r.Context(), user, body)
	if err != nil {
		if errors.Is(err, errSavedGroupPostLimit) {
			h.writeSavedContentLimitError(w, r, user, usageKindGroupPost)
			return
		}
		utils.WriteError(w, http.StatusInternalServerError, "unable to create prepared post")
		return
	}
	prefix := "users/" + formatUUID(user.ID) + "/group-posts/" + formatUUID(post.ID)
	uploaded, err := h.uploadImages(r.Context(), prefix, headers, 50)
	if err != nil {
		_, _ = h.store.DeleteGroupPost(r.Context(), db.DeleteGroupPostParams{ID: post.ID, UserID: user.ID})
		go h.deleteUploadedDirectory(prefix)
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	for _, image := range uploaded {
		_, err = h.store.CreateGroupPostImage(r.Context(), db.CreateGroupPostImageParams{GroupPostID: post.ID, ImageUrl: image.URL, BunnyObjectPath: image.ObjectPath, Position: image.Position})
		if err != nil {
			_, _ = h.store.DeleteGroupPost(r.Context(), db.DeleteGroupPostParams{ID: post.ID, UserID: user.ID})
			go h.deleteUploadedDirectory(prefix)
			utils.WriteError(w, http.StatusInternalServerError, "unable to save prepared post images")
			return
		}
	}
	response, _ := h.groupPostResponse(r, post)
	utils.WriteJSON(w, http.StatusCreated, response)
}

func (h *APIHandler) UpdateGroupPost(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	id, err := parseUUID(chi.URLParam(r, "postID"))
	if err != nil {
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		utils.WriteError(w, http.StatusBadRequest, "invalid post upload")
		return
	}
	body := strings.TrimSpace(r.FormValue("body"))
	headers := r.MultipartForm.File["images"]
	if body == "" {
		utils.WriteError(w, http.StatusBadRequest, "post body is required")
		return
	}
	if len(headers) == 0 {
		utils.WriteError(w, http.StatusBadRequest, "at least one post image is required")
		return
	}
	post, err := h.store.GetGroupPost(r.Context(), db.GetGroupPostParams{ID: id, UserID: user.ID})
	if err != nil {
		utils.WriteError(w, http.StatusNotFound, "prepared post not found")
		return
	}
	oldImages, err := h.store.ListGroupPostImages(r.Context(), post.ID)
	if err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to load prepared post images")
		return
	}
	prefix := "users/" + formatUUID(user.ID) + "/group-posts/" + formatUUID(post.ID)
	uploaded, err := h.uploadImages(r.Context(), prefix, headers, 50)
	if err != nil {
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		h.deleteUploadedImages(uploaded)
		utils.WriteError(w, http.StatusInternalServerError, "unable to update prepared post")
		return
	}
	queries := db.New(tx)
	updated, err := queries.UpdateGroupPost(r.Context(), db.UpdateGroupPostParams{ID: id, UserID: user.ID, Body: body})
	if err == nil {
		err = queries.DeleteGroupPostImages(r.Context(), id)
	}
	if err == nil {
		for _, image := range uploaded {
			_, err = queries.CreateGroupPostImage(r.Context(), db.CreateGroupPostImageParams{GroupPostID: id, ImageUrl: image.URL, BunnyObjectPath: image.ObjectPath, Position: image.Position})
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
		utils.Errorf("update prepared post: %v", err)
		utils.WriteError(w, http.StatusInternalServerError, "unable to update prepared post")
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
	response, _ := h.groupPostResponse(r, updated)
	utils.WriteJSON(w, http.StatusOK, response)
}

func (h *APIHandler) DeleteGroupPost(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r.Context())
	id, err := parseUUID(chi.URLParam(r, "postID"))
	if err != nil {
		utils.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	post, err := h.store.GetGroupPost(r.Context(), db.GetGroupPostParams{ID: id, UserID: user.ID})
	if err != nil {
		utils.WriteError(w, http.StatusNotFound, "prepared post not found")
		return
	}
	if _, err := h.store.DeleteGroupPost(r.Context(), db.DeleteGroupPostParams{ID: id, UserID: user.ID}); err != nil {
		utils.WriteError(w, http.StatusInternalServerError, "unable to delete prepared post")
		return
	}
	directoryPath := "users/" + formatUUID(user.ID) + "/group-posts/" + formatUUID(post.ID)
	go h.deleteUploadedDirectory(directoryPath)
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) groupPostResponse(r *http.Request, post db.GroupPost) (groupPostResponse, error) {
	images, err := h.store.ListGroupPostImages(r.Context(), post.ID)
	if err != nil && err != pgx.ErrNoRows {
		return groupPostResponse{}, err
	}
	responseImages := make([]groupPostImageResponse, 0, len(images))
	for _, image := range images {
		responseImages = append(responseImages, groupPostImageResponse{URL: image.ImageUrl, Position: image.Position})
	}
	return groupPostResponse{ID: formatUUID(post.ID), Body: post.Body, Images: responseImages}, nil
}
