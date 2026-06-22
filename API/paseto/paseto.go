package paseto

import (
	"errors"
	"facebook-groups-bulk-poster-api/utils"
	"strconv"
	"time"

	"aidanwoods.dev/go-paseto"
)

type Payload struct {
	Purpose  string    `json:"purpose"`
	UserID   string    `json:"user_id"`
	Email    string    `json:"email"`
	IssuedAt time.Time `json:"issued_at"`
	Expiry   time.Time `json:"expiry"`
}

func NewPayload(purpose string, userID int32, email string, issuedAt, expiry time.Time) *Payload {
	return &Payload{
		Purpose:  purpose,
		UserID:   strconv.FormatInt(int64(userID), 10),
		Email:    email,
		IssuedAt: issuedAt,
		Expiry:   expiry,
	}
}

func (payload *Payload) CreateToken() (string, error) {

	token := paseto.NewToken()

	token.SetExpiration(payload.Expiry)

	token.SetIssuedAt(payload.IssuedAt)

	token.Set("payload", payload)

	config, err := utils.LoadConfig(".")
	if err != nil {
		return "", err
	}

	secretKeyHex := config.PasetoPrivateKeyHex

	secretKey, err := paseto.NewV4AsymmetricSecretKeyFromHex(secretKeyHex)
	if err != nil {
		return "", err
	}

	signed := token.V4Sign(secretKey, nil)

	return signed, nil
}

func VerifyToken(signedToken string) (*Payload, error) {
	config, err := utils.LoadConfig(".")
	if err != nil {
		return nil, err
	}

	publicKeyHex := config.PasetoPublicKeyHex

	publicKey, err := paseto.NewV4AsymmetricPublicKeyFromHex(publicKeyHex)
	if err != nil {
		return nil, err
	}

	parser := paseto.NewParser()

	token, err := parser.ParseV4Public(publicKey, signedToken, nil)
	if err != nil {
		return nil, err
	}

	var payload Payload

	if err := token.Get("payload", &payload); err != nil {
		return nil, err
	}

	if time.Now().UTC().After(payload.Expiry) {
		return nil, errors.New("token is expired")
	}

	return &payload, nil
}
