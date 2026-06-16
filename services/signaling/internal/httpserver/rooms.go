package httpserver

import (
	"errors"
	"sync"

	"github.com/coder/websocket"
)

type wsParticipant struct {
	participantID string
	role          string
}

type roomJoinError struct {
	code    string
	message string
}

func (e roomJoinError) Error() string {
	return e.message
}

type roomManager struct {
	mu    sync.Mutex
	rooms map[string]*room
}

func newRoomManager() *roomManager {
	return &roomManager{
		rooms: make(map[string]*room),
	}
}

func (m *roomManager) join(sessionID string, participant wsParticipant, conn *websocket.Conn) (*roomMembership, error) {
	m.mu.Lock()
	room := m.rooms[sessionID]
	if room == nil {
		room = newRoom(m, sessionID)
		m.rooms[sessionID] = room
	}
	m.mu.Unlock()

	return room.join(participant, conn)
}

func (m *roomManager) removeIfEmpty(sessionID string, candidate *room) {
	m.mu.Lock()
	defer m.mu.Unlock()

	room := m.rooms[sessionID]
	if room != candidate {
		return
	}

	if !room.isEmpty() {
		return
	}

	delete(m.rooms, sessionID)
}

type room struct {
	manager   *roomManager
	sessionID string
	mu        sync.Mutex
	host      *roomMembership
	guest     *roomMembership
}

func newRoom(manager *roomManager, sessionID string) *room {
	return &room{
		manager:   manager,
		sessionID: sessionID,
	}
}

func (r *room) join(participant wsParticipant, conn *websocket.Conn) (*roomMembership, error) {
	membership := &roomMembership{
		room:        r,
		participant: participant,
		conn:        conn,
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	switch participant.role {
	case hostRole:
		if r.host != nil {
			return nil, roomJoinError{
				code:    "duplicate_participant",
				message: "Host is already connected.",
			}
		}
		r.host = membership
	case guestRole:
		if r.guest != nil {
			return nil, roomJoinError{
				code:    "duplicate_participant",
				message: "Guest is already connected.",
			}
		}
		r.guest = membership
	default:
		return nil, errors.New("unsupported participant role")
	}

	return membership, nil
}

func (r *room) leave(membership *roomMembership) {
	r.mu.Lock()
	switch membership.participant.role {
	case hostRole:
		if r.host == membership {
			r.host = nil
		}
	case guestRole:
		if r.guest == membership {
			r.guest = nil
		}
	}
	empty := r.host == nil && r.guest == nil
	r.mu.Unlock()

	if empty {
		r.manager.removeIfEmpty(r.sessionID, r)
	}
}

func (r *room) peer(role string) *roomMembership {
	r.mu.Lock()
	defer r.mu.Unlock()

	switch role {
	case hostRole:
		if r.guest != nil {
			return r.guest
		}
	case guestRole:
		if r.host != nil {
			return r.host
		}
	}

	return nil
}

func (r *room) isEmpty() bool {
	return r.host == nil && r.guest == nil
}

type roomMembership struct {
	room        *room
	participant wsParticipant
	conn        *websocket.Conn
}

func (m *roomMembership) leave() {
	if m == nil || m.room == nil {
		return
	}

	m.room.leave(m)
}

func (m *roomMembership) peer() *roomMembership {
	if m == nil || m.room == nil {
		return nil
	}

	return m.room.peer(m.participant.role)
}
