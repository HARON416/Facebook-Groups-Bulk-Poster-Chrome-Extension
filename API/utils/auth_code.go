package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

func GenerateSecureCode(byteLength int) (string, error) {
	if byteLength <= 0 {
		return "", fmt.Errorf("invalid code length: %d", byteLength)
	}

	buffer := make([]byte, byteLength)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate secure code: %w", err)
	}

	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func HashTokenValue(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
