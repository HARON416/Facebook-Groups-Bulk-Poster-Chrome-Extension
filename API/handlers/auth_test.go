package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestHasPositiveJSONInteger(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{name: "number", raw: `3599`, want: true},
		{name: "string", raw: `"3599"`, want: true},
		{name: "zero", raw: `0`, want: false},
		{name: "invalid", raw: `"soon"`, want: false},
		{name: "missing", raw: ``, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := hasPositiveJSONInteger(json.RawMessage(test.raw)); got != test.want {
				t.Fatalf("hasPositiveJSONInteger(%q) = %v, want %v", test.raw, got, test.want)
			}
		})
	}
}

func TestBearerToken(t *testing.T) {
	request := httptest.NewRequest("GET", "/", nil)
	request.Header.Set("Authorization", "Bearer application-session")
	token, ok := bearerToken(request)
	if !ok || token != "application-session" {
		t.Fatalf("bearerToken() = %q, %v", token, ok)
	}
}

func TestSessionTokenHashIsDeterministicAndDoesNotExposeToken(t *testing.T) {
	raw, hash, err := newSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if raw == hash {
		t.Fatal("stored hash must not equal the raw session token")
	}
	if len(raw) != 64 || len(hash) != 64 {
		t.Fatalf("unexpected token lengths: raw=%d hash=%d", len(raw), len(hash))
	}
	if hashSessionToken(raw) != hash {
		t.Fatal("session token hash is not deterministic")
	}
}

func TestVerifyGoogleAccessTokenDoesNotExposeTokenInRequestError(t *testing.T) {
	const googleToken = "ya29.regression-test-secret-token"
	handler := &APIHandler{
		httpClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			return nil, errors.New("request failed for " + request.URL.String())
		})},
	}

	_, err := handler.verifyGoogleAccessToken(context.Background(), googleToken)
	if err == nil {
		t.Fatal("verifyGoogleAccessToken() unexpectedly succeeded")
	}
	if strings.Contains(err.Error(), googleToken) {
		t.Fatalf("verifyGoogleAccessToken() exposed the Google access token: %q", err)
	}
	if strings.Contains(err.Error(), "access_token=") {
		t.Fatalf("verifyGoogleAccessToken() exposed the token query parameter: %q", err)
	}
}

func TestSanitizedGoogleRequestErrorPreservesCancellationWithoutSensitiveDetails(t *testing.T) {
	const googleToken = "ya29.regression-test-secret-token"
	rawError := errors.New("context canceled while requesting https://oauth2.googleapis.com/tokeninfo?access_token=" + googleToken)
	err := sanitizedGoogleRequestError("Google token verification request", errors.Join(context.Canceled, rawError))

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("sanitizedGoogleRequestError() = %v, want context cancellation", err)
	}
	if strings.Contains(err.Error(), googleToken) || strings.Contains(err.Error(), "access_token=") {
		t.Fatalf("sanitizedGoogleRequestError() exposed sensitive request data: %q", err)
	}
}
