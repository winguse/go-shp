package domain

// CheckRequest request
type CheckRequest struct {
	Token string
}

// CheckResponse response
type CheckResponse struct {
	Email string
	TTL   int64
}

// StateInfo for authentication
type StateInfo struct {
	SignTime int64
}

// UserInfo from Google
type UserInfo struct {
	Sub            string
	Picture        string
	Email          string
	Email_Verified bool
	Hd             string
}

// LoginResponse response of success login
type LoginResponse struct {
	Token        string
	Email        string
	ExpireTime   int64
	ServerList   []string
	TriggerToken string
}
