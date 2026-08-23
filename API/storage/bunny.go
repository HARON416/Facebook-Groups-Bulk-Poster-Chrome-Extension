package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"facebook-groups-bulk-poster-api/utils"
)

const defaultBunnyTimeout = 90 * time.Second

type BunnyService struct {
	httpClient      *http.Client
	storageZone     string
	storageEndpoint string
	publicBaseURL   string
	accessKey       string
}

type UploadResult struct {
	ObjectPath string `json:"object_path"`
	URL        string `json:"url"`
}

func NewBunnyService(config utils.Config) (*BunnyService, error) {
	if strings.TrimSpace(config.BunnyStorageZone) == "" ||
		strings.TrimSpace(config.BunnyStorageEndpoint) == "" ||
		strings.TrimSpace(config.BunnyPublicBaseURL) == "" ||
		strings.TrimSpace(config.BunnyStorageAccessKey) == "" {
		return nil, errors.New("complete Bunny Storage configuration is required")
	}

	return &BunnyService{
		httpClient:      &http.Client{Timeout: defaultBunnyTimeout},
		storageZone:     strings.Trim(strings.TrimSpace(config.BunnyStorageZone), "/"),
		storageEndpoint: strings.TrimRight(strings.TrimSpace(config.BunnyStorageEndpoint), "/"),
		publicBaseURL:   strings.TrimRight(strings.TrimSpace(config.BunnyPublicBaseURL), "/"),
		accessKey:       strings.TrimSpace(config.BunnyStorageAccessKey),
	}, nil
}

func (s *BunnyService) Upload(ctx context.Context, objectPath string, content io.Reader, contentLength int64, contentType string) (*UploadResult, error) {
	cleanPath, err := cleanObjectPath(objectPath)
	if err != nil {
		return nil, err
	}
	if content == nil || contentLength <= 0 {
		return nil, errors.New("upload content is empty")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.storageURL(cleanPath), content)
	if err != nil {
		return nil, fmt.Errorf("build Bunny upload request: %w", err)
	}
	req.ContentLength = contentLength
	req.Header.Set("AccessKey", s.accessKey)
	req.Header.Set("Content-Type", contentType)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upload to Bunny: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Bunny upload failed: %s", readResponseError(resp.Body))
	}

	return &UploadResult{ObjectPath: cleanPath, URL: s.publicBaseURL + "/" + cleanPath}, nil
}

func (s *BunnyService) Delete(ctx context.Context, objectPath string) error {
	return s.delete(ctx, objectPath, false)
}

func (s *BunnyService) DeleteDirectory(ctx context.Context, directoryPath string) error {
	return s.delete(ctx, directoryPath, true)
}

func (s *BunnyService) delete(ctx context.Context, objectPath string, directory bool) error {
	cleanPath, err := cleanObjectPath(objectPath)
	if err != nil {
		return err
	}
	requestURL := s.storageURL(cleanPath)
	if directory {
		requestURL += "/"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, requestURL, nil)
	if err != nil {
		return fmt.Errorf("build Bunny delete request: %w", err)
	}
	req.Header.Set("AccessKey", s.accessKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete Bunny object: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Bunny delete failed: %s", readResponseError(resp.Body))
	}
	return nil
}

func (s *BunnyService) storageURL(objectPath string) string {
	return fmt.Sprintf("%s/%s/%s", s.storageEndpoint, s.storageZone, escapePath(objectPath))
}

func cleanObjectPath(objectPath string) (string, error) {
	cleaned := strings.TrimPrefix(path.Clean(strings.TrimSpace(objectPath)), "/")
	if cleaned == "" || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", errors.New("invalid Bunny object path")
	}
	return cleaned, nil
}

func escapePath(objectPath string) string {
	parts := strings.Split(objectPath, "/")
	for index := range parts {
		parts[index] = url.PathEscape(parts[index])
	}
	return strings.Join(parts, "/")
}

func readResponseError(body io.Reader) string {
	data, err := io.ReadAll(io.LimitReader(body, 4096))
	if err != nil {
		return err.Error()
	}
	if message := strings.TrimSpace(string(data)); message != "" {
		return message
	}
	return "empty response body"
}
