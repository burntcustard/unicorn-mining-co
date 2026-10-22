//go:build !linux

package network

import "net"

type directSender struct{}

func newDirectSender(net.Conn) *directSender { return nil }

func (*directSender) send([]byte) (int, error) { return 0, nil }
