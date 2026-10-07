package storage

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"facebook-groups-bulk-poster-api/utils"
)

func TestDeleteDirectoryUsesStorageDirectoryPath(t *testing.T) {
	var method, requestPath, accessKey string
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		method = r.Method
		requestPath = r.URL.EscapedPath()
		accessKey = r.Header.Get("AccessKey")
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("")),
			Header:     make(http.Header),
			Request:    r,
		}, nil
	})

	service, err := NewBunnyService(utils.Config{
		BunnyStorageZone:      "test-zone",
		BunnyStorageEndpoint:  "https://storage.bunnycdn.com",
		BunnyPublicBaseURL:    "https://test-zone.b-cdn.net",
		BunnyStorageAccessKey: "storage-password",
	})
	if err != nil {
		t.Fatalf("NewBunnyService() error = %v", err)
	}
	service.httpClient.Transport = transport

	err = service.DeleteDirectory(context.Background(), "users/user-id/marketplace/listing-id")
	if err != nil {
		t.Fatalf("DeleteDirectory() error = %v", err)
	}
	if method != http.MethodDelete {
		t.Fatalf("method = %q, want DELETE", method)
	}
	if requestPath != "/test-zone/users/user-id/marketplace/listing-id/" {
		t.Fatalf("path = %q", requestPath)
	}
	if accessKey != "storage-password" {
		t.Fatalf("AccessKey = %q", accessKey)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func TestDeleteUserDirectoryResponses(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusNotFound, http.StatusUnauthorized, http.StatusInternalServerError} {
		service := &BunnyService{
			storageZone: "test-zone", storageEndpoint: "https://storage.bunnycdn.com",
			httpClient: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != "/test-zone/users/01000000-0000-0000-0000-000000000000/" {
					t.Fatalf("unexpected deletion path: %s", r.URL.Path)
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("response"))}, nil
			})},
		}
		err := service.DeleteDirectory(context.Background(), "users/01000000-0000-0000-0000-000000000000")
		wantError := status != http.StatusOK && status != http.StatusNotFound
		if (err != nil) != wantError {
			t.Fatalf("status %d: error = %v, want error = %v", status, err, wantError)
		}
	}
}

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
