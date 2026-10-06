package persistence

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// Reset archives the database and WAL together while holding the same
// exclusive lock as the game server. Existing periodic backups are retained.
func Reset(path string) (string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", err
	}

	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)

	if err != nil {
		return "", err
	}

	defer lock.Close()

	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return "", fmt.Errorf("stop the game server before resetting %s: %w", path, err)
	}

	archive, err := os.MkdirTemp(filepath.Dir(path), filepath.Base(path)+".reset-")

	if err != nil {
		return "", err
	}

	moved := []string{}

	for _, suffix := range []string{"", "-wal", "-shm"} {
		original := path + suffix
		err := os.Rename(original, filepath.Join(archive, filepath.Base(original)))

		if errors.Is(err, os.ErrNotExist) {
			continue
		}

		if err != nil {
			for _, previous := range moved {
				err = errors.Join(err, os.Rename(filepath.Join(archive, filepath.Base(previous)), previous))
			}

			return archive, err
		}

		moved = append(moved, original)
	}

	return archive, nil
}
