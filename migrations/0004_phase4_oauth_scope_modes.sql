ALTER TABLE oauth_states ADD COLUMN requested_scopes_json TEXT NOT NULL DEFAULT '["listings_r","listings_w","shops_r"]' CHECK (json_valid(requested_scopes_json));
