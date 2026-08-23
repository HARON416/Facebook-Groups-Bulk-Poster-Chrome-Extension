package handlers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"facebook-groups-bulk-poster-api/storage"
)

type concurrentUploadStorage struct {
	mu        sync.Mutex
	active    int
	maxActive int
}

func (s *concurrentUploadStorage) Upload(ctx context.Context, objectPath string, content io.Reader, _ int64, _ string) (*storage.UploadResult, error) {
	data, err := io.ReadAll(content)
	if err != nil {
		return nil, err
	}
	label := string(data[8:])

	s.mu.Lock()
	s.active++
	if s.active > s.maxActive {
		s.maxActive = s.active
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.active--
		s.mu.Unlock()
	}()

	select {
	case <-time.After(time.Duration(12-len(label)) * time.Millisecond):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return &storage.UploadResult{ObjectPath: objectPath, URL: label}, nil
}

func (*concurrentUploadStorage) Delete(context.Context, string) error {
	return nil
}

func (*concurrentUploadStorage) DeleteDirectory(context.Context, string) error {
	return nil
}

func TestUploadImagesRunsConcurrentlyAndPreservesOrder(t *testing.T) {
	labels := []string{"first", "second", "third", "fourth", "fifth", "sixth"}
	headers := multipartImageHeaders(t, labels)
	fakeStorage := &concurrentUploadStorage{}
	handler := &APIHandler{storage: fakeStorage}

	uploaded, err := handler.uploadImages(context.Background(), "users/user-id/group-posts/post-id", headers, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(uploaded) != len(labels) {
		t.Fatalf("uploaded %d images, want %d", len(uploaded), len(labels))
	}
	for index, image := range uploaded {
		if image.Position != int16(index) {
			t.Fatalf("image %d has position %d", index, image.Position)
		}
		if image.URL != labels[index] {
			t.Fatalf("image %d has URL marker %q, want %q", index, image.URL, labels[index])
		}
	}
	if fakeStorage.maxActive < 2 {
		t.Fatalf("uploads did not overlap; maximum active uploads was %d", fakeStorage.maxActive)
	}
	if fakeStorage.maxActive > maxConcurrentImageUploads {
		t.Fatalf("maximum active uploads was %d, limit is %d", fakeStorage.maxActive, maxConcurrentImageUploads)
	}
}

func multipartImageHeaders(t *testing.T, labels []string) []*multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for index, label := range labels {
		part, err := writer.CreateFormFile("images", fmt.Sprintf("image-%d.png", index))
		if err != nil {
			t.Fatal(err)
		}
		_, err = part.Write(append([]byte("\x89PNG\r\n\x1a\n"), []byte(label)...))
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest("POST", "/", strings.NewReader(body.String()))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = request.MultipartForm.RemoveAll() })
	return request.MultipartForm.File["images"]
}
