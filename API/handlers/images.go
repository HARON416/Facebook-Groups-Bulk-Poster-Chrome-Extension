package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"

	"facebook-groups-bulk-poster-api/storage"
	"facebook-groups-bulk-poster-api/utils"

	"golang.org/x/sync/errgroup"
)

const (
	maxImageBytes             = 12 << 20
	maxConcurrentImageUploads = 4
)

type uploadedImage struct {
	*storage.UploadResult
	Position int16
}

func (h *APIHandler) uploadImages(ctx context.Context, prefix string, headers []*multipart.FileHeader, limit int) ([]uploadedImage, error) {
	if len(headers) > limit {
		return nil, fmt.Errorf("only %d images are allowed", limit)
	}
	for _, header := range headers {
		if header.Size <= 0 || header.Size > maxImageBytes {
			return nil, fmt.Errorf("%s exceeds the 12 MB image limit", header.Filename)
		}
	}

	uploaded := make([]uploadedImage, len(headers))
	uploadGroup, uploadCtx := errgroup.WithContext(ctx)
	uploadGroup.SetLimit(maxConcurrentImageUploads)
	for index, header := range headers {
		index := index
		header := header
		uploadGroup.Go(func() error {
			if err := uploadCtx.Err(); err != nil {
				return err
			}
			image, err := h.uploadImage(uploadCtx, prefix, header, int16(index))
			if err != nil {
				return err
			}
			uploaded[index] = image
			return nil
		})
	}
	if err := uploadGroup.Wait(); err != nil {
		h.deleteUploadedImages(uploaded)
		return nil, err
	}
	return uploaded, nil
}

func (h *APIHandler) uploadImage(ctx context.Context, prefix string, header *multipart.FileHeader, position int16) (uploadedImage, error) {
	file, err := header.Open()
	if err != nil {
		return uploadedImage{}, fmt.Errorf("open %s: %w", header.Filename, err)
	}
	defer file.Close()

	buffer := make([]byte, 512)
	readCount, readErr := io.ReadFull(file, buffer)
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return uploadedImage{}, fmt.Errorf("inspect %s: %w", header.Filename, readErr)
	}
	contentType := http.DetectContentType(buffer[:readCount])
	extension := imageExtension(contentType)
	if extension == "" {
		return uploadedImage{}, fmt.Errorf("%s is not a supported image", header.Filename)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return uploadedImage{}, fmt.Errorf("rewind %s: %w", header.Filename, err)
	}
	imageID, err := newUUID()
	if err != nil {
		return uploadedImage{}, err
	}
	objectPath := prefix + "/" + formatUUID(imageID) + extension
	result, err := h.storage.Upload(ctx, objectPath, file, header.Size, contentType)
	if err != nil {
		return uploadedImage{}, fmt.Errorf("upload %s: %w", header.Filename, err)
	}
	return uploadedImage{UploadResult: result, Position: position}, nil
}

func (h *APIHandler) deleteUploadedImages(images []uploadedImage) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, image := range images {
		if image.UploadResult == nil {
			continue
		}
		if err := h.storage.Delete(ctx, image.ObjectPath); err != nil {
			utils.Errorf("clean up Bunny object %q: %v", image.ObjectPath, err)
		}
	}
}

func (h *APIHandler) deleteUploadedDirectory(directoryPath string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := h.storage.DeleteDirectory(ctx, directoryPath); err != nil {
		utils.Errorf("clean up Bunny directory %q: %v", directoryPath, err)
	}
}

func imageExtension(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ""
	}
}
