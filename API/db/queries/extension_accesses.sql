-- name: UpsertExtensionAccess :one
INSERT INTO extension_accesses (
    install_id_hash,
    activation_id,
    trial_expires_at
) VALUES (
    $1,
    $2,
    NOW() + INTERVAL '7 days'
)
ON CONFLICT (install_id_hash)
DO UPDATE SET last_seen_at = NOW()
RETURNING
    id,
    install_id_hash,
    activation_id,
    trial_expires_at,
    lifetime_active,
    activated_at,
    admin_note,
    last_seen_at,
    created_at,
    (lifetime_active OR trial_expires_at > NOW()) AS active;

-- name: ActivateLifetimeExtensionAccess :one
UPDATE extension_accesses
SET
    lifetime_active = TRUE,
    activated_at = NOW(),
    admin_note = $2,
    last_seen_at = NOW()
WHERE activation_id = $1
RETURNING
    id,
    install_id_hash,
    activation_id,
    trial_expires_at,
    lifetime_active,
    activated_at,
    admin_note,
    last_seen_at,
    created_at,
    (lifetime_active OR trial_expires_at > NOW()) AS active;
